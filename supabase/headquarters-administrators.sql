begin;
create schema if not exists lunch_admin_private;
revoke all on schema lunch_admin_private from public,anon,authenticated,service_role;
create table if not exists lunch_admin_private.events(
 id bigint generated always as identity primary key,
 tenant text not null,actor_id uuid not null,entity_id uuid,action text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table lunch_admin_private.events enable row level security;
revoke all on lunch_admin_private.events from public,anon,authenticated,service_role;
create or replace function lunch_admin_private.is_admin(p_tenant text,p_id uuid)
returns boolean language plpgsql stable set search_path='' as $$
declare answer boolean;
begin
 if p_tenant not in ('ax','global','tmt') then return false;end if;
 execute format('select is_admin from public.%I where id=$1',p_tenant||'_lunch_roster') into answer using p_id;
 return coalesce(answer,false);
end $$;
revoke all on function lunch_admin_private.is_admin(text,uuid) from public,anon,authenticated,service_role;

alter table public.ax_lunch_roster add column if not exists is_admin boolean not null default false;
do $guard$ declare expression text;begin
 if not exists(select 1 from public.ax_lunch_roster where is_admin) then
  select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='public.ax_lunch_roster'::regclass and conname='ax_lunch_roster_allowed';
  if expression is null then raise exception 'Missing canonical roster constraint';end if;
  alter table public.ax_lunch_roster drop constraint ax_lunch_roster_allowed;
  execute 'alter table public.ax_lunch_roster add constraint ax_lunch_roster_allowed check (('||expression||') or (name=''관리자'' and class_name=''운영자'' and default_status=''absent''))';
 end if;
end $guard$;
alter table public.ax_lunch_roster drop constraint if exists ax_lunch_roster_role_check;
alter table public.ax_lunch_roster add constraint ax_lunch_roster_role_check check((name='관리자')=is_admin);
insert into public.ax_lunch_roster(id,name,class_name,default_status,is_admin)
 values(gen_random_uuid(),'관리자','운영자','absent',true) on conflict(name) do nothing;
-- Disabled until a server-generated salted PIN hash is provisioned. No plaintext PIN in source.
insert into public.ax_lunch_users(id,name,class_name,pin_hash)
 select id,name,class_name,'!uninitialized!' from public.ax_lunch_roster where is_admin on conflict(name) do nothing;

create or replace function public.ax_lunch_user_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'className',class_name,'defaultStatus',default_status,'isAdmin',is_admin)
 from public.ax_lunch_roster where id=p_id;
$$;
create or replace function public.ax_lunch_register(p_name text,p_pin_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare person public.ax_lunch_roster%rowtype;
begin
 select * into person from public.ax_lunch_roster where name=p_name;
 if not found then raise exception using errcode='LN400',message='등록된 20명만 이용할 수 있습니다.'; end if;
 if person.is_admin then raise exception using errcode='LN403',message='관리자 계정은 직접 등록할 수 없습니다.';end if;
 if p_pin_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential format'; end if;
 begin
  insert into public.ax_lunch_users(id,name,class_name,pin_hash) values(person.id,person.name,person.class_name,p_pin_hash);
 exception when unique_violation then
  raise exception using errcode='LN409',message='이미 등록된 이름입니다. 로그인해 주세요.';
 end;
 insert into public.ax_lunch_sessions(token_hash,user_id,expires_at) values(p_token_hash,person.id,clock_timestamp()+interval '21 days');
 return public.ax_lunch_user_json(person.id);
end;
$$;
create or replace function public.ax_lunch_health()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.ax_lunch_settings where id=1 and schema_version=2)
 or (select count(*) from public.ax_lunch_roster where not is_admin)<>20
 or not exists(select 1 from public.ax_lunch_state where id=1) then raise exception using errcode='LN503',message='DB 설정을 확인해 주세요.'; end if;
 return true;
end;
$$;
create or replace function public.ax_lunch_snapshot(p_token_hash text,p_cron boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; result jsonb;
begin
 if not p_cron then uid:=public.ax_lunch_require_session(p_token_hash); end if;
 select jsonb_build_object(
  'version',s.version,'state',s.data,'user',public.ax_lunch_user_json(uid),'now',clock_timestamp(),
  'people',(select jsonb_agg(public.ax_lunch_user_json(r.id) order by r.class_name,r.name) from public.ax_lunch_roster r where not r.is_admin),
  'dates',(select lunch_operation_private.calendar_dates(c.start_date,c.end_date,clock_timestamp()) from public.ax_lunch_settings c where c.id=1)
 ) into result from public.ax_lunch_state s where s.id=1;
 if result is null then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 return result;
end;
$$;
create or replace function public.ax_lunch_commit_state(
 p_token_hash text,p_expected_version integer,p_data jsonb,p_write_dates text[],p_cron boolean default false
) returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.ax_lunch_state%rowtype; settings public.ax_lunch_settings%rowtype; day_text text; closed_day record;
begin
 select * into current_row from public.ax_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 if not p_cron then perform public.ax_lunch_require_session(p_token_hash); end if;
 if not p_cron and exists(select 1 from public.ax_lunch_roster where id=public.ax_lunch_require_session(p_token_hash) and is_admin) and cardinality(p_write_dates)>0 then raise exception using errcode='LN403',message='관리자 계정은 점심 신청 대상이 아닙니다.';end if;
 if current_row.version<>p_expected_version then return false; end if;
 if jsonb_typeof(p_data->'choices') is distinct from 'object' or jsonb_typeof(p_data->'days') is distinct from 'object' or jsonb_typeof(p_data->'events') is distinct from 'array' then raise exception 'Invalid state'; end if;
 select * into settings from public.ax_lunch_settings where id=1;
 if not found then raise exception using errcode='LN503',message='운영 기간 설정이 필요합니다.'; end if;
 foreach day_text in array p_write_dates loop
  if day_text::date<settings.start_date or (settings.end_date is not null and day_text::date>settings.end_date) or extract(isodow from day_text::date)>5 then raise exception using errcode='LN400',message='운영 기간의 평일만 신청할 수 있습니다.'; end if;
  -- This check runs AFTER lock acquisition, even when a request waited across 11:00.
  if clock_timestamp()>=(day_text||'T11:00:00+09:00')::timestamptz then raise exception using errcode='LN409',message='오전 11시 마감 이후에는 변경할 수 없습니다.'; end if;
 end loop;
 -- No caller, including recovery cron, can rewrite an already finalized snapshot.
 for closed_day in select key,value from jsonb_each(current_row.data->'days') loop
  if closed_day.value->>'phase'='final' and p_data->'days'->closed_day.key is distinct from closed_day.value then raise exception using errcode='LN409',message='확정된 기록은 변경할 수 없습니다.'; end if;
 end loop;
 update public.ax_lunch_state set data=p_data,version=version+1 where id=1;
 return true;
end;
$$;
create or replace function public.ax_lunch_tenant_info()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',tenant_key,'startDate',start_date,'endDate',end_date,'capabilities',3,'adminAccountsRevision',1) from public.ax_lunch_settings where id=1;
$$;
create or replace function public.ax_lunch_system_status()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',s.tenant_key,'startDate',s.start_date,'endDate',s.end_date,'now',clock_timestamp(),'lastAttemptAt',j.last_attempt_at,'lastSuccessAt',j.last_success_at,'lastOk',j.last_ok,'lastCode',j.last_code,'registered',(select count(*) from public.ax_lunch_users u join public.ax_lunch_roster r on r.id=u.id where not r.is_admin),'rosterCount',(select count(*) from public.ax_lunch_roster where not is_admin)) from public.ax_lunch_settings s left join public.ax_lunch_job_runs j on j.id=s.id where s.id=1;
$$;
revoke all on function public.ax_lunch_user_json(uuid) from public,anon,authenticated,service_role;
alter table public.global_lunch_roster add column if not exists is_admin boolean not null default false;
do $guard$ declare expression text;begin
 if not exists(select 1 from public.global_lunch_roster where is_admin) then
  select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='public.global_lunch_roster'::regclass and conname='global_lunch_roster_allowed';
  if expression is null then raise exception 'Missing canonical roster constraint';end if;
  alter table public.global_lunch_roster drop constraint global_lunch_roster_allowed;
  execute 'alter table public.global_lunch_roster add constraint global_lunch_roster_allowed check (('||expression||') or (name=''관리자'' and class_name=''운영자'' and default_status=''absent''))';
 end if;
end $guard$;
alter table public.global_lunch_roster drop constraint if exists global_lunch_roster_role_check;
alter table public.global_lunch_roster add constraint global_lunch_roster_role_check check((name='관리자')=is_admin);
insert into public.global_lunch_roster(id,name,class_name,default_status,is_admin)
 values(gen_random_uuid(),'관리자','운영자','absent',true) on conflict(name) do nothing;
-- Disabled until a server-generated salted PIN hash is provisioned. No plaintext PIN in source.
insert into public.global_lunch_users(id,name,class_name,pin_hash)
 select id,name,class_name,'!uninitialized!' from public.global_lunch_roster where is_admin on conflict(name) do nothing;

create or replace function public.global_lunch_user_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'className',class_name,'defaultStatus',default_status,'isAdmin',is_admin)
 from public.global_lunch_roster where id=p_id;
$$;
create or replace function public.global_lunch_register(p_name text,p_pin_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare person public.global_lunch_roster%rowtype;
begin
 select * into person from public.global_lunch_roster where name=p_name;
 if not found then raise exception using errcode='LN400',message='등록된 20명만 이용할 수 있습니다.'; end if;
 if person.is_admin then raise exception using errcode='LN403',message='관리자 계정은 직접 등록할 수 없습니다.';end if;
 if p_pin_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential format'; end if;
 begin
  insert into public.global_lunch_users(id,name,class_name,pin_hash) values(person.id,person.name,person.class_name,p_pin_hash);
 exception when unique_violation then
  raise exception using errcode='LN409',message='이미 등록된 이름입니다. 로그인해 주세요.';
 end;
 insert into public.global_lunch_sessions(token_hash,user_id,expires_at) values(p_token_hash,person.id,clock_timestamp()+interval '21 days');
 return public.global_lunch_user_json(person.id);
end;
$$;
create or replace function public.global_lunch_health()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.global_lunch_settings where id=1 and schema_version=2)
 or (select count(*) from public.global_lunch_roster where not is_admin)<>20
 or not exists(select 1 from public.global_lunch_state where id=1) then raise exception using errcode='LN503',message='DB 설정을 확인해 주세요.'; end if;
 return true;
end;
$$;
create or replace function public.global_lunch_snapshot(p_token_hash text,p_cron boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; result jsonb;
begin
 if not p_cron then uid:=public.global_lunch_require_session(p_token_hash); end if;
 select jsonb_build_object(
  'version',s.version,'state',s.data,'user',public.global_lunch_user_json(uid),'now',clock_timestamp(),
  'people',(select jsonb_agg(public.global_lunch_user_json(r.id) order by r.class_name,r.name) from public.global_lunch_roster r where not r.is_admin),
  'dates',(select lunch_operation_private.calendar_dates(c.start_date,c.end_date,clock_timestamp()) from public.global_lunch_settings c where c.id=1)
 ) into result from public.global_lunch_state s where s.id=1;
 if result is null then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 return result;
end;
$$;
create or replace function public.global_lunch_commit_state(
 p_token_hash text,p_expected_version integer,p_data jsonb,p_write_dates text[],p_cron boolean default false
) returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.global_lunch_state%rowtype; settings public.global_lunch_settings%rowtype; day_text text; closed_day record;
begin
 select * into current_row from public.global_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 if not p_cron then perform public.global_lunch_require_session(p_token_hash); end if;
 if not p_cron and exists(select 1 from public.global_lunch_roster where id=public.global_lunch_require_session(p_token_hash) and is_admin) and cardinality(p_write_dates)>0 then raise exception using errcode='LN403',message='관리자 계정은 점심 신청 대상이 아닙니다.';end if;
 if current_row.version<>p_expected_version then return false; end if;
 if jsonb_typeof(p_data->'choices') is distinct from 'object' or jsonb_typeof(p_data->'days') is distinct from 'object' or jsonb_typeof(p_data->'events') is distinct from 'array' then raise exception 'Invalid state'; end if;
 select * into settings from public.global_lunch_settings where id=1;
 if not found then raise exception using errcode='LN503',message='운영 기간 설정이 필요합니다.'; end if;
 foreach day_text in array p_write_dates loop
  if day_text::date<settings.start_date or (settings.end_date is not null and day_text::date>settings.end_date) or extract(isodow from day_text::date)>5 then raise exception using errcode='LN400',message='운영 기간의 평일만 신청할 수 있습니다.'; end if;
  -- This check runs AFTER lock acquisition, even when a request waited across 11:00.
  if clock_timestamp()>=(day_text||'T11:00:00+09:00')::timestamptz then raise exception using errcode='LN409',message='오전 11시 마감 이후에는 변경할 수 없습니다.'; end if;
 end loop;
 -- No caller, including recovery cron, can rewrite an already finalized snapshot.
 for closed_day in select key,value from jsonb_each(current_row.data->'days') loop
  if closed_day.value->>'phase'='final' and p_data->'days'->closed_day.key is distinct from closed_day.value then raise exception using errcode='LN409',message='확정된 기록은 변경할 수 없습니다.'; end if;
 end loop;
 update public.global_lunch_state set data=p_data,version=version+1 where id=1;
 return true;
end;
$$;
create or replace function public.global_lunch_tenant_info()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',tenant_key,'startDate',start_date,'endDate',end_date,'globalRosterRevision',1,'capabilities',3,'adminAccountsRevision',1) from public.global_lunch_settings where id=1;
$$;
create or replace function public.global_lunch_system_status()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',s.tenant_key,'startDate',s.start_date,'endDate',s.end_date,'now',clock_timestamp(),'lastAttemptAt',j.last_attempt_at,'lastSuccessAt',j.last_success_at,'lastOk',j.last_ok,'lastCode',j.last_code,'registered',(select count(*) from public.global_lunch_users u join public.global_lunch_roster r on r.id=u.id where not r.is_admin),'rosterCount',(select count(*) from public.global_lunch_roster where not is_admin)) from public.global_lunch_settings s left join public.global_lunch_job_runs j on j.id=s.id where s.id=1;
$$;
revoke all on function public.global_lunch_user_json(uuid) from public,anon,authenticated,service_role;
alter table public.tmt_lunch_roster add column if not exists is_admin boolean not null default false;
do $guard$ declare expression text;begin
 if not exists(select 1 from public.tmt_lunch_roster where is_admin) then
  select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='public.tmt_lunch_roster'::regclass and conname='tmt_lunch_roster_allowed';
  if expression is null then raise exception 'Missing canonical roster constraint';end if;
  alter table public.tmt_lunch_roster drop constraint tmt_lunch_roster_allowed;
  execute 'alter table public.tmt_lunch_roster add constraint tmt_lunch_roster_allowed check (('||expression||') or (name=''관리자'' and class_name=''운영자'' and default_status=''absent''))';
 end if;
end $guard$;
alter table public.tmt_lunch_roster drop constraint if exists tmt_lunch_roster_role_check;
alter table public.tmt_lunch_roster add constraint tmt_lunch_roster_role_check check((name='관리자')=is_admin);
insert into public.tmt_lunch_roster(id,name,class_name,default_status,is_admin)
 values(gen_random_uuid(),'관리자','운영자','absent',true) on conflict(name) do nothing;
-- Disabled until a server-generated salted PIN hash is provisioned. No plaintext PIN in source.
insert into public.tmt_lunch_users(id,name,class_name,pin_hash)
 select id,name,class_name,'!uninitialized!' from public.tmt_lunch_roster where is_admin on conflict(name) do nothing;

create or replace function public.tmt_lunch_user_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'className',class_name,'defaultStatus',default_status,'isAdmin',is_admin)
 from public.tmt_lunch_roster where id=p_id;
$$;
create or replace function public.tmt_lunch_register(p_name text,p_pin_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare person public.tmt_lunch_roster%rowtype;
begin
 select * into person from public.tmt_lunch_roster where name=p_name;
 if not found then raise exception using errcode='LN400',message='등록된 18명만 이용할 수 있습니다.'; end if;
 if person.is_admin then raise exception using errcode='LN403',message='관리자 계정은 직접 등록할 수 없습니다.';end if;
 if p_pin_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential format'; end if;
 begin
  insert into public.tmt_lunch_users(id,name,class_name,pin_hash) values(person.id,person.name,person.class_name,p_pin_hash);
 exception when unique_violation then
  raise exception using errcode='LN409',message='이미 등록된 이름입니다. 로그인해 주세요.';
 end;
 insert into public.tmt_lunch_sessions(token_hash,user_id,expires_at) values(p_token_hash,person.id,clock_timestamp()+interval '21 days');
 return public.tmt_lunch_user_json(person.id);
end;
$$;
create or replace function public.tmt_lunch_health()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.tmt_lunch_settings where id=1 and schema_version=2)
 or (select count(*) from public.tmt_lunch_roster where not is_admin)<>18
 or not exists(select 1 from public.tmt_lunch_state where id=1) then raise exception using errcode='LN503',message='DB 설정을 확인해 주세요.'; end if;
 return true;
end;
$$;
create or replace function public.tmt_lunch_snapshot(p_token_hash text,p_cron boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; result jsonb;
begin
 if not p_cron then uid:=public.tmt_lunch_require_session(p_token_hash); end if;
 select jsonb_build_object(
  'version',s.version,'state',s.data,'user',public.tmt_lunch_user_json(uid),'now',clock_timestamp(),
  'people',(select jsonb_agg(public.tmt_lunch_user_json(r.id) order by r.class_name,r.name) from public.tmt_lunch_roster r where not r.is_admin),
  'dates',(select lunch_operation_private.calendar_dates(c.start_date,c.end_date,clock_timestamp()) from public.tmt_lunch_settings c where c.id=1)
 ) into result from public.tmt_lunch_state s where s.id=1;
 if result is null then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 return result;
end;
$$;
create or replace function public.tmt_lunch_commit_state(
 p_token_hash text,p_expected_version integer,p_data jsonb,p_write_dates text[],p_cron boolean default false
) returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.tmt_lunch_state%rowtype; settings public.tmt_lunch_settings%rowtype; day_text text; closed_day record;
begin
 select * into current_row from public.tmt_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 if not p_cron then perform public.tmt_lunch_require_session(p_token_hash); end if;
 if not p_cron and exists(select 1 from public.tmt_lunch_roster where id=public.tmt_lunch_require_session(p_token_hash) and is_admin) and cardinality(p_write_dates)>0 then raise exception using errcode='LN403',message='관리자 계정은 점심 신청 대상이 아닙니다.';end if;
 if current_row.version<>p_expected_version then return false; end if;
 if jsonb_typeof(p_data->'choices') is distinct from 'object' or jsonb_typeof(p_data->'days') is distinct from 'object' or jsonb_typeof(p_data->'events') is distinct from 'array' then raise exception 'Invalid state'; end if;
 select * into settings from public.tmt_lunch_settings where id=1;
 if not found then raise exception using errcode='LN503',message='운영 기간 설정이 필요합니다.'; end if;
 foreach day_text in array p_write_dates loop
  if day_text::date<settings.start_date or (settings.end_date is not null and day_text::date>settings.end_date) or extract(isodow from day_text::date)>5 then raise exception using errcode='LN400',message='운영 기간의 평일만 신청할 수 있습니다.'; end if;
  -- This check runs AFTER lock acquisition, even when a request waited across 11:00.
  if clock_timestamp()>=(day_text||'T11:00:00+09:00')::timestamptz then raise exception using errcode='LN409',message='오전 11시 마감 이후에는 변경할 수 없습니다.'; end if;
 end loop;
 -- No caller, including recovery cron, can rewrite an already finalized snapshot.
 for closed_day in select key,value from jsonb_each(current_row.data->'days') loop
  if closed_day.value->>'phase'='final' and p_data->'days'->closed_day.key is distinct from closed_day.value then raise exception using errcode='LN409',message='확정된 기록은 변경할 수 없습니다.'; end if;
 end loop;
 update public.tmt_lunch_state set data=p_data,version=version+1 where id=1;
 return true;
end;
$$;
create or replace function public.tmt_lunch_tenant_info()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',tenant_key,'startDate',start_date,'endDate',end_date,'capabilities',3,'adminAccountsRevision',1) from public.tmt_lunch_settings where id=1;
$$;
create or replace function public.tmt_lunch_system_status()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',s.tenant_key,'startDate',s.start_date,'endDate',s.end_date,'now',clock_timestamp(),'lastAttemptAt',j.last_attempt_at,'lastSuccessAt',j.last_success_at,'lastOk',j.last_ok,'lastCode',j.last_code,'registered',(select count(*) from public.tmt_lunch_users u join public.tmt_lunch_roster r on r.id=u.id where not r.is_admin),'rosterCount',(select count(*) from public.tmt_lunch_roster where not is_admin)) from public.tmt_lunch_settings s left join public.tmt_lunch_job_runs j on j.id=s.id where s.id=1;
$$;
revoke all on function public.tmt_lunch_user_json(uuid) from public,anon,authenticated,service_role;
create or replace function group_node_private.request(p_tenant text,p_token_hash text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid; m public.group_node_meetups%rowtype; c jsonb; date_id uuid; candidate_ids uuid[]='{}';
 result jsonb; all_rows jsonb; today date=(clock_timestamp() at time zone 'Asia/Seoul')::date;
 is_past boolean; owner boolean; moderator boolean; old_comment text; changed boolean=false; previous public.group_node_dates%rowtype; total integer;
begin
 actor_id:=group_node_private.actor(p_tenant,p_token_hash);
 moderator:=lunch_admin_private.is_admin(p_tenant,actor_id);
 if p_action='list' then
  with filtered as materialized (
   select item.id,item.created_at from public.group_node_meetups item
   where (moderator or item.visibility='all' or item.created_by_tenant=p_tenant)
   and (coalesce(p_payload->>'category','')='' or item.category=p_payload->>'category')
   and (coalesce(p_payload->>'q','')='' or item.title ilike '%'||(p_payload->>'q')||'%')
   and (not coalesce((p_payload->>'onlyHeadquarters')::boolean,false) or item.created_by_tenant=p_tenant)
   and (case when p_payload->>'view'='past' then (item.status='cancelled' or (item.kind='one_off' and (select coalesce(max(date) filter(where id=item.confirmed_date_id),max(date)) from public.group_node_dates where meetup_id=item.id)<today))
    else item.status<>'cancelled' and (item.kind='club' or (select coalesce(max(date) filter(where id=item.confirmed_date_id),max(date)) from public.group_node_dates where meetup_id=item.id)>=today) end)
   and (coalesce(p_payload->>'view','browse')<>'clubs' or item.kind='club')
   and (coalesce(p_payload->>'view','browse')<>'mine' or (item.created_by_tenant=p_tenant and item.created_by=actor_id)
    or exists(select 1 from public.group_node_participants p where p.meetup_id=item.id and p.tenant=p_tenant and p.user_id=actor_id))
  )
  select coalesce((select jsonb_agg(group_node_private.render(page.id) order by page.created_at desc,page.id)
   from (select id,created_at from filtered order by created_at desc,id
    offset greatest(0,coalesce((p_payload->>'offset')::int,0)) limit 20) page),'[]'::jsonb),
   (select count(*) from filtered) into all_rows,total;
  return jsonb_build_object('meetups',all_rows,'total',total,'now',clock_timestamp());
 end if;
 if p_action='create' or p_action='update' then
  if jsonb_typeof(p_payload->'dates') is distinct from 'array' or jsonb_array_length(p_payload->'dates') not between 0 and 5 then raise exception using errcode='LN400',message='후보 날짜는 최대 5개입니다.';end if;
 end if;
 if p_action='create' then
  insert into public.group_node_meetups(title,description,category,min_people,visibility,created_by_tenant,created_by,kind)
  values(btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),p_payload->>'category',(p_payload->>'minPeople')::int,p_payload->>'visibility',p_tenant,actor_id,coalesce(p_payload->>'kind','one_off')) returning * into m;
  if not moderator then insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_tenant,actor_id);end if;
 else
  select * into m from public.group_node_meetups where id=(p_payload->>'id')::uuid for update;
  if not found or (not moderator and m.visibility='headquarters' and m.created_by_tenant<>p_tenant) then raise exception using errcode='LN404',message='모임을 찾을 수 없습니다.';end if;
  -- Recheck after a lock wait, including a concurrent operator session revocation.
  if group_node_private.actor(p_tenant,p_token_hash) is distinct from actor_id then raise exception using errcode='LN401',message='로그인이 필요합니다.';end if;
 end if;
 owner:=moderator or (m.created_by=actor_id and m.created_by_tenant=p_tenant);
 if p_action in ('update','delete','confirm','reopen','cancel','convert_to_club','add_participant','participant_roster') then
  if not owner then raise exception using errcode='LN403',message='모임장만 실행할 수 있습니다.';end if;
  if p_action<>'participant_roster' and m.version is distinct from (p_payload->>'version')::int then raise exception using errcode='LN409',message='모임이 변경되었습니다. 다시 불러온 후 시도해 주세요.';end if;
 end if;
 select m.status='cancelled' or (m.kind='one_off' and coalesce(max(date) filter(where id=m.confirmed_date_id),max(date))<today) into is_past from public.group_node_dates where meetup_id=m.id;
 if moderator and p_action in ('join','leave','vote','unvote') then raise exception using errcode='LN403',message='관리자 계정은 참여자 관리 기능을 이용해 주세요.';end if;
 if p_action in ('join','leave','vote','unvote') and coalesce(is_past,false) then raise exception using errcode='LN409',message='종료되거나 취소된 모임입니다.';end if;
 if moderator and p_action in ('update','delete','confirm','reopen','cancel','convert_to_club','add_participant','edit_comment','delete_comment') then insert into lunch_admin_private.events(tenant,actor_id,entity_id,action) values(p_tenant,actor_id,m.id,p_action);end if;
 if p_action='participant_roster' then
  if m.kind<>'club' then raise exception using errcode='LN400',message='소모임에서만 참여자를 추가할 수 있습니다.';end if;
  return jsonb_build_object('people',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'tenant',r.tenant,'name',r.name,'className',r.class_name) order by r.tenant,r.class_name,r.name)
   from (select id,name,class_name,is_admin,'ax'::text as tenant from public.ax_lunch_roster
    union all select id,name,class_name,is_admin,'global' from public.global_lunch_roster
    union all select id,name,class_name,is_admin,'tmt' from public.tmt_lunch_roster) r
   where not r.is_admin and (m.visibility='all' or r.tenant=m.created_by_tenant)
    and not exists(select 1 from public.group_node_participants p where p.meetup_id=m.id and p.tenant=r.tenant and p.user_id=r.id)),'[]'::jsonb));
 end if;
 if p_action in ('create','update') then
  if coalesce(p_payload->>'kind',m.kind)='one_off' and jsonb_array_length(p_payload->'dates')=0 then raise exception using errcode='LN400',message='1회성 모임은 후보 날짜가 필요합니다.';end if;
  if p_action='update' then
   if p_payload->>'visibility'='headquarters' and m.visibility='all' and (
    exists(select 1 from public.group_node_participants where meetup_id=m.id and tenant<>m.created_by_tenant)
    or exists(select 1 from public.group_node_comments where meetup_id=m.id and tenant<>m.created_by_tenant)) then
    raise exception using errcode='LN409',message='다른 본부의 참여나 댓글이 있어 모집 범위를 줄일 수 없습니다.';
   end if;
   update public.group_node_meetups set title=btrim(p_payload->>'title'),description=coalesce(p_payload->>'description',''),category=p_payload->>'category',
    kind=coalesce(p_payload->>'kind',m.kind),min_people=(p_payload->>'minPeople')::int,visibility=p_payload->>'visibility',version=version+1 where id=m.id;
  end if;
  for c in select value from jsonb_array_elements(p_payload->'dates') loop
   date_id:=null;previous:=null;
   if p_action='update' and c->>'id' is not null then
    select * into previous from public.group_node_dates where id=(c->>'id')::uuid and meetup_id=m.id;
    if not found then raise exception using errcode='LN400',message='후보 날짜가 변경되었습니다.';end if;
    date_id:=previous.id;
   end if;
   if (c->>'date')::date<today and (date_id is null or previous.date is distinct from (c->>'date')::date or previous.time is distinct from nullif(c->>'time','')::time) then
    raise exception using errcode='LN400',message='새 후보 날짜는 오늘 이후로 선택해 주세요.';
   end if;
   if date_id is null then
    insert into public.group_node_dates(meetup_id,date,time) values(m.id,(c->>'date')::date,nullif(c->>'time','')::time) returning id into date_id;
    changed:=true;
   elsif previous.date is distinct from (c->>'date')::date or previous.time is distinct from nullif(c->>'time','')::time then
    delete from public.group_node_votes where group_node_votes.date_id=previous.id;
    update public.group_node_dates set date=(c->>'date')::date,time=nullif(c->>'time','')::time where id=previous.id;
    changed:=true;
   end if;
   candidate_ids:=array_append(candidate_ids,date_id);
  end loop;
  if exists(select 1 from public.group_node_dates where meetup_id=m.id and not(id=any(candidate_ids))) then changed:=true;end if;
  if changed then update public.group_node_meetups set status='open',confirmed_date_id=null where id=m.id;end if;
  delete from public.group_node_dates where meetup_id=m.id and not(id=any(candidate_ids));
 elsif p_action='convert_to_club' then
  update public.group_node_meetups set kind='club',version=version+1 where id=m.id and kind<>'club';
 elsif p_action='add_participant' then
  if m.kind<>'club' then raise exception using errcode='LN400',message='소모임에서만 참여자를 추가할 수 있습니다.';end if;
  if m.status='cancelled' then raise exception using errcode='LN409',message='취소된 소모임입니다.';end if;
  if group_node_private.person(p_payload->>'tenant',(p_payload->>'userId')::uuid) is null then raise exception using errcode='LN400',message='본부 명단에 등록된 참여자를 선택해 주세요.';end if;
  if lunch_admin_private.is_admin(p_payload->>'tenant',(p_payload->>'userId')::uuid) then raise exception using errcode='LN400',message='관리자 계정은 참여자로 추가할 수 없습니다.';end if;
  if m.visibility='headquarters' and p_payload->>'tenant' is distinct from m.created_by_tenant then raise exception using errcode='LN403',message='우리 본부 인원만 추가할 수 있습니다.';end if;
  insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_payload->>'tenant',(p_payload->>'userId')::uuid) on conflict do nothing;
  get diagnostics total=row_count;
  if total>0 then update public.group_node_meetups set version=version+1 where id=m.id;end if;
 elsif p_action='delete' then
  delete from public.group_node_meetups where id=m.id;return jsonb_build_object('ok',true);
 elsif p_action='join' then
  insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_tenant,actor_id) on conflict do nothing;
 elsif p_action='leave' then
  delete from public.group_node_participants where meetup_id=m.id and tenant=p_tenant and user_id=actor_id;
 elsif p_action in ('vote','unvote') then
  if not exists(select 1 from public.group_node_participants where meetup_id=m.id and tenant=p_tenant and user_id=actor_id) then raise exception using errcode='LN409',message='모임 참여 후 투표해 주세요.';end if;
  if not exists(select 1 from public.group_node_dates where id=(p_payload->>'dateId')::uuid and meetup_id=m.id) then raise exception using errcode='LN404',message='후보 날짜를 찾을 수 없습니다.';end if;
  if m.kind='club' and exists(select 1 from public.group_node_dates where id=(p_payload->>'dateId')::uuid and date<today) then raise exception using errcode='LN409',message='지난 일정의 투표는 변경할 수 없습니다.';end if;
  if p_action='vote' then insert into public.group_node_votes(meetup_id,date_id,tenant,user_id) values(m.id,(p_payload->>'dateId')::uuid,p_tenant,actor_id) on conflict do nothing;
  else delete from public.group_node_votes v where v.date_id=(p_payload->>'dateId')::uuid and tenant=p_tenant and user_id=actor_id;end if;
 elsif p_action='comment' then
  insert into public.group_node_comments(meetup_id,tenant,user_id,body) values(m.id,p_tenant,actor_id,btrim(p_payload->>'body'));
 elsif p_action='edit_comment' then
  select body into old_comment from public.group_node_comments where id=(p_payload->>'commentId')::uuid and meetup_id=m.id and (moderator or (tenant=p_tenant and user_id=actor_id)) for update;
  if not found then raise exception using errcode='LN403',message='댓글을 수정할 권한이 없습니다.';end if;
  if old_comment is distinct from p_payload->>'expectedBody' then raise exception using errcode='LN409',message='댓글이 변경되었습니다. 다시 불러와 주세요.';end if;
  update public.group_node_comments set body=btrim(p_payload->>'body') where id=(p_payload->>'commentId')::uuid and meetup_id=m.id;
 elsif p_action='delete_comment' then
  delete from public.group_node_comments where id=(p_payload->>'commentId')::uuid and meetup_id=m.id and (moderator or (tenant=p_tenant and user_id=actor_id));
  if not found then raise exception using errcode='LN403',message='내 댓글만 삭제할 수 있습니다.';end if;
 elsif p_action='confirm' then
  if (select count(*) from public.group_node_participants where meetup_id=m.id)<m.min_people then raise exception using errcode='LN409',message='최소 인원이 아직 모이지 않았습니다.';end if;
  if not exists(select 1 from public.group_node_dates where id=(p_payload->>'dateId')::uuid and meetup_id=m.id and date>=today) then raise exception using errcode='LN400',message='오늘 이후의 후보 날짜를 선택해 주세요.';end if;
  update public.group_node_meetups set status='confirmed',confirmed_date_id=(p_payload->>'dateId')::uuid,version=version+1 where id=m.id;
 elsif p_action in ('reopen','cancel') then
  update public.group_node_meetups set status=case when p_action='reopen' then 'open' else 'cancelled' end,confirmed_date_id=null,version=version+1 where id=m.id;
 elsif p_action<>'detail' then raise exception using errcode='LN400',message='잘못된 작업입니다.';
 end if;
 result:=group_node_private.render(m.id);
 select result||jsonb_build_object('comments',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'body',x.body,'createdAt',x.created_at,'member',group_node_private.person(x.tenant,x.user_id)) order by x.created_at,x.id),'[]'::jsonb)) into result
 from (select * from public.group_node_comments where meetup_id=m.id order by created_at desc,id desc limit 200) x;
 return result;
end $$;




revoke all on function group_node_private.request(text,text,text,jsonb) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
