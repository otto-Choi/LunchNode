begin;
set local lock_timeout = '30s';
do $check$ begin
 if to_regclass('public.lunch_users') is null
 or to_regclass('public.ax_lunch_users') is not null
 or to_regclass('public.global_lunch_users') is not null then
  raise exception 'Expected BEFORE_CUTOVER with no Global tables. No changes made.';
 end if;
 if to_regclass('public.lunch_roster') is null
 or to_regclass('public.lunch_settings') is null
 or to_regprocedure('public.lunch_snapshot(text,boolean)') is null then
  raise exception 'Existing AX backend tables or functions are missing. No changes made.';
 end if;
end $check$;
select pg_advisory_xact_lock(610230903);
do $rename$
declare item record; name text;
begin
 if to_regclass('public.lunch_users') is not null and to_regclass('public.ax_lunch_users') is not null then
  raise exception 'Both legacy and AX-prefixed user tables exist. Stop and review; no automatic merge.';
 end if;
 if to_regclass('public.lunch_users') is null and to_regclass('public.ax_lunch_users') is null then
  raise exception 'Existing AX Node tables were not found. Use schema.sql for a new installation.';
 end if;
 if to_regclass('public.lunch_users') is not null then
  foreach name in array array['roster','users','sessions','state','auth_buckets','settings','admin_events','job_runs'] loop
   if to_regclass('public.lunch_'||name) is not null then
    if to_regclass('public.ax_lunch_'||name) is not null then raise exception 'Conflicting AX table: %',name; end if;
    execute format('alter table public.%I rename to %I','lunch_'||name,'ax_lunch_'||name);
   end if;
  end loop;
  for item in select p.oid::regprocedure as signature,p.proname,p.proargtypes from pg_proc p where p.pronamespace='public'::regnamespace and starts_with(p.proname,'lunch_') loop
   if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='ax_'||item.proname and p.proargtypes=item.proargtypes) then raise exception 'Conflicting AX function: %',item.proname; end if;
   execute format('alter function %s rename to %I',item.signature,'ax_'||item.proname);
  end loop;
 end if;
 for item in select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and starts_with(p.proname,'ax_lunch_') loop
  execute regexp_replace(pg_get_functiondef(item.oid), '\mlunch_', 'ax_lunch_', 'g');
 end loop;
 for item in select c.conname,c.conrelid::regclass as tbl from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relnamespace='public'::regnamespace and starts_with(t.relname,'ax_lunch_') and starts_with(c.conname,'lunch_') loop
  execute format('alter table %s rename constraint %I to %I',item.tbl,item.conname,'ax_'||item.conname);
 end loop;
 for item in select c.relname,c.relkind from pg_class c where c.relnamespace='public'::regnamespace and starts_with(c.relname,'lunch_') and c.relkind in ('i','I','S') loop
  execute format('alter %s public.%I rename to %I',case when item.relkind='S' then 'sequence' else 'index' end,item.relname,'ax_'||item.relname);
 end loop;
 for item in select t.tgname,t.tgrelid::regclass as tbl from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and starts_with(c.relname,'ax_lunch_') and starts_with(t.tgname,'lunch_') and not t.tgisinternal loop
  execute format('alter trigger %I on %s rename to %I',item.tgname,item.tbl,'ax_'||item.tgname);
 end loop;
end $rename$;
create table if not exists public.ax_lunch_admin_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references public.ax_lunch_roster(id),
 target_id uuid references public.ax_lunch_roster(id),
 action text not null check(action in ('reset_pin','revoke','recover')),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.ax_lunch_admin_events enable row level security;
revoke all on public.ax_lunch_admin_events from public,anon,authenticated,service_role;
create or replace function public.ax_lunch_admin_account(p_actor_token text,p_target_name text,p_new_hash text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare actor uuid; target uuid;
begin
 perform pg_advisory_xact_lock(610230902);
 select id into target from public.ax_lunch_users where name=p_target_name for update;
 if target is null then raise exception using errcode='LN400',message='아직 등록하지 않은 사용자입니다.'; end if;
 actor:=public.ax_lunch_require_session(p_actor_token);
 if p_new_hash is not null then
  if p_new_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' then raise exception 'Invalid PIN hash'; end if;
  update public.ax_lunch_users set pin_hash=p_new_hash where id=target;
 end if;
 delete from public.ax_lunch_sessions where user_id=target;
 insert into public.ax_lunch_admin_events(actor_id,target_id,action) values(actor,target,case when p_new_hash is null then 'revoke' else 'reset_pin' end);
 return true;
end;
$$;
create or replace function public.ax_lunch_admin_recover_log(p_actor_token text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.ax_lunch_admin_events(actor_id,action) values(public.ax_lunch_require_session(p_actor_token),'recover');
 return true;
end;
$$;
revoke all on function public.ax_lunch_admin_account(text,text,text),public.ax_lunch_admin_recover_log(text) from public,anon,authenticated;
grant execute on function public.ax_lunch_admin_account(text,text,text),public.ax_lunch_admin_recover_log(text) to service_role;
alter table public.ax_lunch_admin_events add column if not exists target_date date;
alter table public.ax_lunch_admin_events drop constraint if exists ax_lunch_admin_events_action_check;
alter table public.ax_lunch_admin_events add constraint ax_lunch_admin_events_action_check check(action in ('reset_pin','revoke','recover','rematch','initial_match'));
create or replace function public.ax_lunch_admin_rematch(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.ax_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.ax_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.ax_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.ax_lunch_settings where id=1 and p_date::date between start_date and end_date and extract(isodow from p_date::date)<6) then
  raise exception using errcode='LN400',message='운영 기간의 평일만 재편성할 수 있습니다.';
 end if;
 check_time:=clock_timestamp();
 current_day:=current_row.data->'days'->p_date;
 if check_time>=(p_date||'T11:00:00+09:00')::timestamptz or current_day->>'phase'='final' then
  raise exception using errcode='LN409',message='오전 11시 마감 이후에는 재편성할 수 없습니다.';
 end if;
 if check_time<(p_date||'T00:00:00+09:00')::timestamptz-interval '2 hours' or current_day->>'phase' is distinct from 'matched' then
  raise exception using errcode='LN409',message='최초 편성 이후에만 재편성할 수 있습니다.';
 end if;
 if jsonb_typeof(p_groups) is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.'; end if;
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_typeof(g->'members') is distinct from 'array' or g->>'meal' is null or g->>'meal' not in ('lunchbox','outside')) then
  raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';
 end if;
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members') not between 1 and 5) then
  raise exception using errcode='LN400',message='조당 인원은 1~5명이어야 합니다.';
 end if;
 select coalesce(array_agg(m->>'id' order by m->>'id'),'{}'::text[]) into actual_ids
 from jsonb_array_elements(p_groups) g cross join lateral jsonb_array_elements(g->'members') m;
 select coalesce(array_agg(key order by key),'{}'::text[]) into expected_ids from jsonb_each(coalesce(current_row.data->'choices'->p_date,'{}'::jsonb)) where value->>'status'='join';
 if actual_ids is distinct from expected_ids then raise exception using errcode='LN409',message='참석자가 변경되었습니다. 다시 시도해 주세요.'; end if;
 if exists(select 1 from jsonb_array_elements(p_groups) g cross join lateral jsonb_array_elements(g->'members') m
  where not exists(select 1 from public.ax_lunch_roster r where r.id::text=m->>'id' and r.name=m->>'name' and r.class_name=m->>'className')
   or (current_row.data->'choices'->p_date->(m->>'id')->>'meal' in ('lunchbox','outside') and current_row.data->'choices'->p_date->(m->>'id')->>'meal'<>g->>'meal')) then
  raise exception using errcode='LN400',message='참가자 정보와 필수 메뉴 조건을 확인해 주세요.';
 end if;
 next_day:=current_day||jsonb_build_object('groups',p_groups,'rematchedAt',check_time);
 update public.ax_lunch_state set data=jsonb_set(current_row.data,array['days',p_date],next_day),version=version+1 where id=1;
 insert into public.ax_lunch_admin_events(actor_id,action,target_date) values(actor,'rematch',p_date::date);
 return true;
end;
$$;
revoke all on function public.ax_lunch_admin_rematch(text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.ax_lunch_admin_rematch(text,integer,text,jsonb) to service_role;
alter table public.ax_lunch_settings add column if not exists tenant_key text not null default 'ax' check(tenant_key in ('ax','global'));
update public.ax_lunch_settings set end_date=greatest(end_date,'2026-11-30'::date) where id=1 and tenant_key='ax';
create table if not exists public.ax_lunch_job_runs (
 id integer primary key check(id=1),last_attempt_at timestamptz,last_success_at timestamptz,last_ok boolean,last_code text
);
insert into public.ax_lunch_job_runs(id) values(1) on conflict(id) do nothing;
alter table public.ax_lunch_job_runs enable row level security;
revoke all on public.ax_lunch_job_runs from public,anon,authenticated,service_role;
alter table public.ax_lunch_admin_events drop constraint if exists ax_lunch_admin_events_action_check;
alter table public.ax_lunch_admin_events add constraint ax_lunch_admin_events_action_check check(action in ('reset_pin','revoke','recover','rematch','initial_match'));
create or replace function public.ax_lunch_tenant_info()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',tenant_key,'startDate',start_date,'endDate',end_date,'capabilities',3) from public.ax_lunch_settings where id=1;
$$;
create or replace function public.ax_lunch_record_job(p_ok boolean,p_code text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.ax_lunch_job_runs set last_attempt_at=clock_timestamp(),last_ok=p_ok,last_code=case when p_ok then null else left(p_code,40) end,last_success_at=case when p_ok then clock_timestamp() else last_success_at end where id=1;
 return true;
end;
$$;
create or replace function public.ax_lunch_system_status()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',s.tenant_key,'startDate',s.start_date,'endDate',s.end_date,'now',clock_timestamp(),'lastAttemptAt',j.last_attempt_at,'lastSuccessAt',j.last_success_at,'lastOk',j.last_ok,'lastCode',j.last_code,'registered',(select count(*) from public.ax_lunch_users),'rosterCount',(select count(*) from public.ax_lunch_roster)) from public.ax_lunch_settings s left join public.ax_lunch_job_runs j on j.id=s.id where s.id=1;
$$;
revoke all on function public.ax_lunch_tenant_info(),public.ax_lunch_record_job(boolean,text),public.ax_lunch_system_status() from public,anon,authenticated;
grant execute on function public.ax_lunch_tenant_info(),public.ax_lunch_record_job(boolean,text),public.ax_lunch_system_status() to service_role;
create or replace function public.ax_lunch_admin_initial_match(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.ax_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.ax_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.ax_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.ax_lunch_settings where id=1 and p_date::date between start_date and end_date and extract(isodow from p_date::date)<6) then
  raise exception using errcode='LN400',message='운영 기간의 평일만 재편성할 수 있습니다.';
 end if;
 check_time:=clock_timestamp();
 current_day:=current_row.data->'days'->p_date;
 if p_date::date<>(select start_date from public.ax_lunch_settings where id=1) then raise exception using errcode='LN400',message='운영 첫날에만 최초 편성을 실행할 수 있습니다.'; end if;
 if current_day->>'phase'='final' or coalesce(jsonb_array_length(current_day->'groups'),0)>0 then raise exception using errcode='LN409',message='이미 조가 있습니다. 전체 조 다시 편성을 사용해 주세요.'; end if;
 if current_day is null then current_day:=jsonb_build_object('phase','matched','groups','[]'::jsonb,'matchedAt',check_time); end if;
 if check_time>=(p_date||'T11:00:00+09:00')::timestamptz or current_day->>'phase'='final' then
  raise exception using errcode='LN409',message='오전 11시 마감 이후에는 재편성할 수 없습니다.';
 end if;
 if check_time<(p_date||'T00:00:00+09:00')::timestamptz-interval '2 hours' or current_day->>'phase' is distinct from 'matched' then
  raise exception using errcode='LN409',message='최초 편성 이후에만 재편성할 수 있습니다.';
 end if;
 if jsonb_typeof(p_groups) is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.'; end if;
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_typeof(g->'members') is distinct from 'array' or g->>'meal' is null or g->>'meal' not in ('lunchbox','outside')) then
  raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';
 end if;
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members') not between 1 and 5) then
  raise exception using errcode='LN400',message='조당 인원은 1~5명이어야 합니다.';
 end if;
 select coalesce(array_agg(m->>'id' order by m->>'id'),'{}'::text[]) into actual_ids
 from jsonb_array_elements(p_groups) g cross join lateral jsonb_array_elements(g->'members') m;
 select coalesce(array_agg(key order by key),'{}'::text[]) into expected_ids from jsonb_each(coalesce(current_row.data->'choices'->p_date,'{}'::jsonb)) where value->>'status'='join';
 if actual_ids is distinct from expected_ids then raise exception using errcode='LN409',message='참석자가 변경되었습니다. 다시 시도해 주세요.'; end if;
 if exists(select 1 from jsonb_array_elements(p_groups) g cross join lateral jsonb_array_elements(g->'members') m
  where not exists(select 1 from public.ax_lunch_roster r where r.id::text=m->>'id' and r.name=m->>'name' and r.class_name=m->>'className')
   or (current_row.data->'choices'->p_date->(m->>'id')->>'meal' in ('lunchbox','outside') and current_row.data->'choices'->p_date->(m->>'id')->>'meal'<>g->>'meal')) then
  raise exception using errcode='LN400',message='참가자 정보와 필수 메뉴 조건을 확인해 주세요.';
 end if;
 next_day:=current_day||jsonb_build_object('groups',p_groups,'matchedAt',check_time);
 update public.ax_lunch_state set data=jsonb_set(current_row.data,array['days',p_date],next_day),version=version+1 where id=1;
 insert into public.ax_lunch_admin_events(actor_id,action,target_date) values(actor,'initial_match',p_date::date);
 return true;
end;
$$;
revoke all on function public.ax_lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.ax_lunch_admin_initial_match(text,integer,text,jsonb) to service_role;
create table public.global_lunch_roster (
 id uuid primary key, name text not null unique,
 class_name text not null check(class_name in ('IOA','IPO')),
 default_status text not null default 'unset' check(default_status='unset'),
 constraint global_lunch_roster_allowed check ((name,class_name) in (
 ('류지환','IOA'),('박인홍','IOA'),('백재호','IOA'),('이상원','IOA'),
 ('이은서','IOA'),('최유정','IOA'),('김현태','IOA'),('유영채','IOA'),
 ('유한혁','IOA'),('이다혜','IOA'),('이시연','IOA'),('정지우','IOA'),
 ('강준현','IPO'),('고수현','IPO'),('김혜진','IPO'),('마승희','IPO'),
 ('문채윤','IPO'),('윤두하','IPO'),('곽종우','IPO'),('이기하','IPO')))
);
insert into public.global_lunch_roster(id,name,class_name)
select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,name,division
from (values
 (1,'류지환','IOA'),(2,'박인홍','IOA'),(3,'백재호','IOA'),(4,'이상원','IOA'),
 (5,'이은서','IOA'),(6,'최유정','IOA'),(7,'김현태','IOA'),(8,'유영채','IOA'),
 (9,'유한혁','IOA'),(10,'이다혜','IOA'),(11,'이시연','IOA'),(12,'정지우','IOA'),
 (13,'강준현','IPO'),(14,'고수현','IPO'),(15,'김혜진','IPO'),(16,'마승희','IPO'),
 (17,'문채윤','IPO'),(18,'윤두하','IPO'),(19,'곽종우','IPO'),(20,'이기하','IPO')
) roster(n,name,division);
create table public.global_lunch_users (
 id uuid primary key references public.global_lunch_roster(id),
 name text not null unique references public.global_lunch_roster(name),
 class_name text not null default '', pin_hash text not null,
 created_at timestamptz not null default now()
);
create table public.global_lunch_sessions (
 token_hash text primary key,
 user_id uuid not null references public.global_lunch_users(id) on delete cascade,
 expires_at timestamptz not null
);
create index global_lunch_sessions_user on public.global_lunch_sessions(user_id);
create table public.global_lunch_state (
 id integer primary key check(id=1),version integer not null default 0,
 data jsonb not null default '{"choices":{},"days":{},"events":[]}'::jsonb
);
insert into public.global_lunch_state(id) values(1);
create table public.global_lunch_auth_buckets (
 key text primary key,attempts integer not null,window_start timestamptz not null
);
create table public.global_lunch_settings (
 id integer primary key check(id=1),start_date date not null,end_date date not null,
 schema_version integer not null default 2,
 tenant_key text not null default 'global' check(tenant_key='global'),
 check(end_date>=start_date and end_date-start_date<=140)
);
insert into public.global_lunch_settings(id,start_date,end_date)
select 1,d::date,'2026-11-30'::date
from generate_series(
 (case when (clock_timestamp() at time zone 'Asia/Seoul')::time<time '11:00'
  then (clock_timestamp() at time zone 'Asia/Seoul')::date
  else (clock_timestamp() at time zone 'Asia/Seoul')::date+1 end)::timestamp,
 '2026-11-30'::timestamp,interval '1 day'
) d where extract(isodow from d)<6 order by d limit 1;
do $date$ begin
 if not exists(select 1 from public.global_lunch_settings where id=1)
 then raise exception 'The operating period has ended. No changes committed.';end if;
end $date$;
create table public.global_lunch_admin_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references public.global_lunch_roster(id),
 target_id uuid references public.global_lunch_roster(id),target_date date,
 action text not null check(action in ('reset_pin','revoke','recover','rematch','initial_match')),
 created_at timestamptz not null default clock_timestamp()
);
create table public.global_lunch_job_runs (
 id integer primary key check(id=1),last_attempt_at timestamptz,
 last_success_at timestamptz,last_ok boolean,last_code text
);
insert into public.global_lunch_job_runs(id) values(1);
do $functions$
declare fn record; tbl text;
begin
 for fn in
  select oid from pg_proc where pronamespace='public'::regnamespace
  and starts_with(proname,'ax_lunch_')
  order by case when proname='ax_lunch_user_json' then 0 else 1 end,oid
 loop
  execute replace(
   replace(pg_get_functiondef(fn.oid),'ax_lunch_','global_lunch_'),
   'pg_advisory_xact_lock(610230902)','pg_advisory_xact_lock(610230901)'
  );
 end loop;
 foreach tbl in array array['roster','users','sessions','state','auth_buckets','settings','admin_events','job_runs'] loop
  execute format('alter table public.%I enable row level security','global_lunch_'||tbl);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role','global_lunch_'||tbl);
 end loop;
 for fn in
  select oid::regprocedure as signature from pg_proc
  where pronamespace='public'::regnamespace and starts_with(proname,'global_lunch_')
 loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
 end loop;
end $functions$;
create trigger global_lunch_identity before insert or update on public.global_lunch_users
for each row execute function public.global_lunch_check_identity();
grant execute on function
 public.global_lunch_identity(text),
 public.global_lunch_rate_limit(text,integer),
 public.global_lunch_credentials(text),
 public.global_lunch_register(text,text,text),
 public.global_lunch_open_session(uuid,text,text),
 public.global_lunch_change_pin(text,text,text),
 public.global_lunch_end_session(text),
 public.global_lunch_snapshot(text,boolean),
 public.global_lunch_commit_state(text,integer,jsonb,text[],boolean),
 public.global_lunch_cleanup(),public.global_lunch_health(),
 public.global_lunch_admin_account(text,text,text),
 public.global_lunch_admin_recover_log(text),
 public.global_lunch_admin_rematch(text,integer,text,jsonb),
 public.global_lunch_admin_initial_match(text,integer,text,jsonb),
 public.global_lunch_tenant_info(),
 public.global_lunch_record_job(boolean,text),
 public.global_lunch_system_status()
 to service_role;
set local lock_timeout = '15s';
do $correction$
declare
 person_id uuid; fk record; definition text; saved_fks jsonb='[]'::jsonb;
 current_data jsonb; corrected_data jsonb; member record;
begin
 if to_regclass('public.global_lunch_roster') is null then return; end if;
 perform pg_advisory_xact_lock(610230901);
 lock table public.global_lunch_state,public.global_lunch_users,public.global_lunch_roster in access exclusive mode;
 if exists(select 1 from public.global_lunch_roster where name='이윤서')
 and exists(select 1 from public.global_lunch_roster where name='이은서') then
  raise exception 'Both spellings exist. No changes made; review identities first.';
 end if;
 select id into person_id from public.global_lunch_roster where name in ('이윤서','이은서') and class_name='IOA';
 if person_id is null then raise exception 'Expected Global IOA participant was not found. No changes made.'; end if;
 select pg_get_constraintdef(oid) into definition from pg_constraint
 where conrelid='public.global_lunch_roster'::regclass and conname='global_lunch_roster_allowed';
 if definition is null then raise exception 'Global roster constraint was not found. No changes made.'; end if;
 if strpos(definition,'이윤서')>0 then
  alter table public.global_lunch_roster drop constraint global_lunch_roster_allowed;
 end if;
 for fk in select c.conname,pg_get_constraintdef(c.oid) as body from pg_constraint c
 where c.conrelid='public.global_lunch_users'::regclass and c.confrelid='public.global_lunch_roster'::regclass
 and c.contype='f' and c.conkey=array[(select attnum from pg_attribute where attrelid='public.global_lunch_users'::regclass and attname='name')]::smallint[]
 loop
  saved_fks:=saved_fks||jsonb_build_array(jsonb_build_object('name',fk.conname,'body',fk.body));
  execute format('alter table public.global_lunch_users drop constraint %I',fk.conname);
 end loop;
 update public.global_lunch_roster set name='이은서' where id=person_id and name='이윤서';
 update public.global_lunch_users set name='이은서' where id=person_id and name='이윤서';
 if strpos(definition,'이윤서')>0 then
   execute 'alter table public.global_lunch_roster add constraint global_lunch_roster_allowed '||replace(definition,'이윤서','이은서');
 end if;
 for fk in select value->>'name' as name,value->>'body' as body from jsonb_array_elements(saved_fks) loop
  execute format('alter table public.global_lunch_users add constraint %I %s',fk.name,fk.body);
 end loop;
 select data into current_data from public.global_lunch_state where id=1;
 corrected_data:=current_data;
 for member in
  select d.key as day,(g.ordinality-1)::text as group_index,(m.ordinality-1)::text as member_index
  from jsonb_each(coalesce(current_data->'days','{}'::jsonb)) d
  cross join lateral jsonb_array_elements(coalesce(d.value->'groups','[]'::jsonb)) with ordinality g(value,ordinality)
  cross join lateral jsonb_array_elements(coalesce(g.value->'members','[]'::jsonb)) with ordinality m(value,ordinality)
  where m.value->>'id'=person_id::text and m.value->>'name'='이윤서'
 loop
  corrected_data:=jsonb_set(corrected_data,array['days',member.day,'groups',member.group_index,'members',member.member_index,'name'],to_jsonb('이은서'::text),false);
 end loop;
 if corrected_data is distinct from current_data then
  update public.global_lunch_state set data=corrected_data,version=version+1 where id=1;
 end if;
 execute $ddl$create or replace function public.global_lunch_tenant_info()
 returns jsonb language sql stable security definer set search_path=public as $body$
 select jsonb_build_object('tenant',tenant_key,'startDate',start_date,'endDate',end_date,'capabilities',3,'globalRosterRevision',1)
 from public.global_lunch_settings where id=1;
 $body$;$ddl$;
 revoke all on function public.global_lunch_tenant_info() from public,anon,authenticated;
 grant execute on function public.global_lunch_tenant_info() to service_role;
end $correction$;
notify pgrst,'reload schema';
notify pgrst,'reload schema';
commit;
