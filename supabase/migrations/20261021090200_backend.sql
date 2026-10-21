-- Apply after schema.sql (fresh installations already include this migration).
begin;
create table if not exists public.lunch_settings (
 id integer primary key check(id=1),
 start_date date not null, end_date date not null,
 schema_version integer not null default 2,
 check(end_date>=start_date and end_date-start_date<=140)
);
insert into public.lunch_settings(id,start_date,end_date) values(1,'2026-10-22','2026-11-03') on conflict(id) do nothing;
alter table public.lunch_settings enable row level security;

create or replace function public.lunch_user_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'className',class_name,'defaultStatus',default_status)
 from public.lunch_roster where id=p_id;
$$;

create or replace function public.lunch_require_session(p_token_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
 select user_id into uid from public.lunch_sessions where token_hash=p_token_hash;
 if uid is null then raise exception using errcode='LN401',message='로그인이 필요합니다.'; end if;
 -- All credential/session mutations lock account first, then session.
 perform 1 from public.lunch_users where id=uid for share;
 perform 1 from public.lunch_sessions where token_hash=p_token_hash and expires_at>clock_timestamp() for share;
 if not found then raise exception using errcode='LN401',message='로그인이 필요합니다.'; end if;
 return uid;
end;
$$;

create or replace function public.lunch_identity(p_token_hash text)
returns jsonb language sql stable security definer set search_path=public as $$
 select public.lunch_user_json(user_id) from public.lunch_sessions
 where token_hash=p_token_hash and expires_at>now();
$$;

create or replace function public.lunch_rate_limit(p_key text,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_attempts integer;
begin
 if p_limit<1 or p_limit>200 then raise exception 'Invalid rate limit'; end if;
 insert into public.lunch_auth_buckets(key,attempts,window_start) values(p_key,1,clock_timestamp())
 on conflict(key) do update set
 attempts=case when lunch_auth_buckets.window_start<clock_timestamp()-interval '15 minutes' then 1 else least(lunch_auth_buckets.attempts+1,1000000) end,
 window_start=case when lunch_auth_buckets.window_start<clock_timestamp()-interval '15 minutes' then clock_timestamp() else lunch_auth_buckets.window_start end
 returning attempts into current_attempts;
 return current_attempts<=p_limit;
end;
$$;

create or replace function public.lunch_credentials(p_name text)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'pin_hash',pin_hash,'user',public.lunch_user_json(id))
 from public.lunch_users where name=p_name;
$$;

create or replace function public.lunch_register(p_name text,p_pin_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare person public.lunch_roster%rowtype;
begin
 select * into person from public.lunch_roster where name=p_name;
 if not found then raise exception using errcode='LN400',message='등록된 20명만 이용할 수 있습니다.'; end if;
 if p_pin_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential format'; end if;
 begin
  insert into public.lunch_users(id,name,class_name,pin_hash) values(person.id,person.name,person.class_name,p_pin_hash);
 exception when unique_violation then
  raise exception using errcode='LN409',message='이미 등록된 이름입니다. 로그인해 주세요.';
 end;
 insert into public.lunch_sessions(token_hash,user_id,expires_at) values(p_token_hash,person.id,clock_timestamp()+interval '21 days');
 return public.lunch_user_json(person.id);
end;
$$;

create or replace function public.lunch_open_session(p_user_id uuid,p_expected_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare stored text;
begin
 select pin_hash into stored from public.lunch_users where id=p_user_id for update;
 if stored is null or stored<>p_expected_hash then raise exception using errcode='LN401',message='PIN이 변경되었습니다. 다시 로그인해 주세요.'; end if;
 if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token format'; end if;
 insert into public.lunch_sessions(token_hash,user_id,expires_at) values(p_token_hash,p_user_id,clock_timestamp()+interval '21 days');
 return public.lunch_user_json(p_user_id);
end;
$$;

create or replace function public.lunch_change_pin(p_token_hash text,p_expected_hash text,p_new_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; stored text;
begin
 select user_id into uid from public.lunch_sessions where token_hash=p_token_hash;
 select pin_hash into stored from public.lunch_users where id=uid for update;
 perform public.lunch_require_session(p_token_hash);
 if stored is null or stored<>p_expected_hash then raise exception using errcode='LN401',message='현재 PIN을 다시 확인해 주세요.'; end if;
 if p_new_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' then raise exception 'Invalid PIN hash'; end if;
 update public.lunch_users set pin_hash=p_new_hash where id=uid;
 delete from public.lunch_sessions where user_id=uid;
 return true;
end;
$$;

create or replace function public.lunch_end_session(p_token_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 delete from public.lunch_sessions where token_hash=p_token_hash;
 return true;
end;
$$;

create or replace function public.lunch_snapshot(p_token_hash text,p_cron boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; result jsonb;
begin
 if not p_cron then uid:=public.lunch_require_session(p_token_hash); end if;
 select jsonb_build_object(
  'version',s.version,'state',s.data,'user',public.lunch_user_json(uid),'now',clock_timestamp(),
  'people',(select jsonb_agg(public.lunch_user_json(r.id) order by r.class_name,r.name) from public.lunch_roster r),
  'dates',(select jsonb_agg(to_char(d,'YYYY-MM-DD') order by d) from public.lunch_settings c,
   lateral generate_series(c.start_date::timestamp,c.end_date::timestamp,interval '1 day') d
   where c.id=1 and extract(isodow from d)<6)
 ) into result from public.lunch_state s where s.id=1;
 if result is null then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 return result;
end;
$$;

create or replace function public.lunch_commit_state(
 p_token_hash text,p_expected_version integer,p_data jsonb,p_write_dates text[],p_cron boolean default false
) returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.lunch_state%rowtype; settings public.lunch_settings%rowtype; day_text text; closed_day record;
begin
 select * into current_row from public.lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 if not p_cron then perform public.lunch_require_session(p_token_hash); end if;
 if current_row.version<>p_expected_version then return false; end if;
 if jsonb_typeof(p_data->'choices') is distinct from 'object' or jsonb_typeof(p_data->'days') is distinct from 'object' or jsonb_typeof(p_data->'events') is distinct from 'array' then raise exception 'Invalid state'; end if;
 select * into settings from public.lunch_settings where id=1;
 if not found then raise exception using errcode='LN503',message='운영 기간 설정이 필요합니다.'; end if;
 foreach day_text in array p_write_dates loop
  if day_text::date<settings.start_date or day_text::date>settings.end_date or extract(isodow from day_text::date)>5 then raise exception using errcode='LN400',message='운영 기간의 평일만 신청할 수 있습니다.'; end if;
  -- This check runs AFTER lock acquisition, even when a request waited across 11:00.
  if clock_timestamp()>=(day_text||'T11:00:00+09:00')::timestamptz then raise exception using errcode='LN409',message='오전 11시 마감 이후에는 변경할 수 없습니다.'; end if;
 end loop;
 -- No caller, including recovery cron, can rewrite an already finalized snapshot.
 for closed_day in select key,value from jsonb_each(current_row.data->'days') loop
  if closed_day.value->>'phase'='final' and p_data->'days'->closed_day.key is distinct from closed_day.value then raise exception using errcode='LN409',message='확정된 기록은 변경할 수 없습니다.'; end if;
 end loop;
 update public.lunch_state set data=p_data,version=version+1 where id=1;
 return true;
end;
$$;

create or replace function public.lunch_cleanup()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 delete from public.lunch_sessions where expires_at<=clock_timestamp();
 delete from public.lunch_auth_buckets where window_start<clock_timestamp()-interval '1 day';
 return true;
end;
$$;

create or replace function public.lunch_health()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.lunch_settings where id=1 and schema_version=2)
 or (select count(*) from public.lunch_roster)<>20
 or not exists(select 1 from public.lunch_state where id=1) then raise exception using errcode='LN503',message='DB 설정을 확인해 주세요.'; end if;
 return true;
end;
$$;

-- Only these service-only RPCs may access data. Browser roles have no table or RPC access.
revoke all on public.lunch_users,public.lunch_sessions,public.lunch_state,public.lunch_auth_buckets,public.lunch_settings from public,anon,authenticated,service_role;
revoke all on public.lunch_roster from public,anon,authenticated,service_role;
do $$ declare fn record; begin
 for fn in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'lunch_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
 end loop;
end; $$;
grant execute on function public.lunch_identity(text),public.lunch_rate_limit(text,integer),public.lunch_credentials(text),public.lunch_register(text,text,text),public.lunch_open_session(uuid,text,text),public.lunch_change_pin(text,text,text),public.lunch_end_session(text),public.lunch_snapshot(text,boolean),public.lunch_commit_state(text,integer,jsonb,text[],boolean),public.lunch_cleanup(),public.lunch_health() to service_role;
commit;
