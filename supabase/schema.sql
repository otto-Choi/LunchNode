begin;
-- Baseline for fresh and existing databases. Never deletes participant data.

-- Fixed roster: 8 in class 4, 9 in class 5, 3 December hires.
create table if not exists public.ax_lunch_roster (
 id uuid primary key,
 name text not null unique,
 class_name text not null,
 default_status text not null check(default_status in ('unset','absent')),
 constraint ax_lunch_roster_allowed check (
    (name='권도영' and class_name='4반' and default_status='unset') or
    (name='김서영' and class_name='4반' and default_status='unset') or
    (name='손규영' and class_name='4반' and default_status='unset') or
    (name='김민국' and class_name='4반' and default_status='unset') or
    (name='김상규' and class_name='4반' and default_status='unset') or
    (name='안소이' and class_name='4반' and default_status='unset') or
    (name='유태상' and class_name='4반' and default_status='unset') or
    (name='최철원' and class_name='4반' and default_status='unset') or
    (name='김주연' and class_name='5반' and default_status='unset') or
    (name='박서연' and class_name='5반' and default_status='unset') or
    (name='박진홍' and class_name='5반' and default_status='unset') or
    (name='양우진' and class_name='5반' and default_status='unset') or
    (name='장은영' and class_name='5반' and default_status='unset') or
    (name='김영탁' and class_name='5반' and default_status='unset') or
    (name='부유경' and class_name='5반' and default_status='unset') or
    (name='서유빈' and class_name='5반' and default_status='unset') or
    (name='오성현' and class_name='5반' and default_status='unset') or
    (name='김범준' and class_name='12월 입사자' and default_status='absent') or
    (name='박대원' and class_name='12월 입사자' and default_status='absent') or
    (name='박진영' and class_name='12월 입사자' and default_status='absent')
 )
);

create table if not exists public.ax_lunch_users (
 id uuid primary key, name text not null unique,
 class_name text not null default '', pin_hash text not null,
 created_at timestamptz not null default now()
);
-- Existing pre-roster installations keep their account UUIDs.
insert into public.ax_lunch_roster(id,name,class_name,default_status)
select coalesce(u.id,seed.id),seed.name,seed.class_name,seed.default_status
from (values
('00000000-0000-4000-8000-000000000001'::uuid,'권도영','4반','unset'),
('00000000-0000-4000-8000-000000000002'::uuid,'김서영','4반','unset'),
('00000000-0000-4000-8000-000000000003'::uuid,'손규영','4반','unset'),
('00000000-0000-4000-8000-000000000004'::uuid,'김민국','4반','unset'),
('00000000-0000-4000-8000-000000000005'::uuid,'김상규','4반','unset'),
('00000000-0000-4000-8000-000000000006'::uuid,'안소이','4반','unset'),
('00000000-0000-4000-8000-000000000007'::uuid,'유태상','4반','unset'),
('00000000-0000-4000-8000-000000000008'::uuid,'최철원','4반','unset'),
('00000000-0000-4000-8000-000000000009'::uuid,'김주연','5반','unset'),
('00000000-0000-4000-8000-000000000010'::uuid,'박서연','5반','unset'),
('00000000-0000-4000-8000-000000000011'::uuid,'박진홍','5반','unset'),
('00000000-0000-4000-8000-000000000012'::uuid,'양우진','5반','unset'),
('00000000-0000-4000-8000-000000000013'::uuid,'장은영','5반','unset'),
('00000000-0000-4000-8000-000000000014'::uuid,'김영탁','5반','unset'),
('00000000-0000-4000-8000-000000000015'::uuid,'부유경','5반','unset'),
('00000000-0000-4000-8000-000000000016'::uuid,'서유빈','5반','unset'),
('00000000-0000-4000-8000-000000000017'::uuid,'오성현','5반','unset'),
('00000000-0000-4000-8000-000000000018'::uuid,'김범준','12월 입사자','absent'),
('00000000-0000-4000-8000-000000000019'::uuid,'박대원','12월 입사자','absent'),
('00000000-0000-4000-8000-000000000020'::uuid,'박진영','12월 입사자','absent')) as seed(id,name,class_name,default_status)
left join public.ax_lunch_users u on u.name=seed.name
on conflict(name) do nothing;
create table if not exists public.ax_lunch_sessions (
 token_hash text primary key,user_id uuid not null references public.ax_lunch_users(id) on delete cascade,expires_at timestamptz not null
);
create index if not exists ax_lunch_sessions_user on public.ax_lunch_sessions(user_id);
create table if not exists public.ax_lunch_state (
 id integer primary key check(id=1),version integer not null default 0,
 data jsonb not null default '{"choices":{},"days":{},"events":[]}'::jsonb
);
insert into public.ax_lunch_state(id) values(1) on conflict(id) do nothing;
create table if not exists public.ax_lunch_auth_buckets(key text primary key,attempts integer not null,window_start timestamptz not null);
alter table public.ax_lunch_users enable row level security;
alter table public.ax_lunch_sessions enable row level security;
alter table public.ax_lunch_state enable row level security;
alter table public.ax_lunch_auth_buckets enable row level security;
grant usage on schema public to anon,authenticated,service_role;

-- Apply after baseline. Preserve existing accounts and request history.
-- Transactional: stop without deleting anything if accounts outside the roster exist.

lock table public.ax_lunch_users, public.ax_lunch_state in exclusive mode;
-- Fixed roster: 8 in class 4, 9 in class 5, 3 December hires.
create table if not exists public.ax_lunch_roster (
 id uuid primary key,
 name text not null unique,
 class_name text not null,
 default_status text not null check(default_status in ('unset','absent')),
 constraint ax_lunch_roster_allowed check (
    (name='권도영' and class_name='4반' and default_status='unset') or
    (name='김서영' and class_name='4반' and default_status='unset') or
    (name='손규영' and class_name='4반' and default_status='unset') or
    (name='김민국' and class_name='4반' and default_status='unset') or
    (name='김상규' and class_name='4반' and default_status='unset') or
    (name='안소이' and class_name='4반' and default_status='unset') or
    (name='유태상' and class_name='4반' and default_status='unset') or
    (name='최철원' and class_name='4반' and default_status='unset') or
    (name='김주연' and class_name='5반' and default_status='unset') or
    (name='박서연' and class_name='5반' and default_status='unset') or
    (name='박진홍' and class_name='5반' and default_status='unset') or
    (name='양우진' and class_name='5반' and default_status='unset') or
    (name='장은영' and class_name='5반' and default_status='unset') or
    (name='김영탁' and class_name='5반' and default_status='unset') or
    (name='부유경' and class_name='5반' and default_status='unset') or
    (name='서유빈' and class_name='5반' and default_status='unset') or
    (name='오성현' and class_name='5반' and default_status='unset') or
    (name='김범준' and class_name='12월 입사자' and default_status='absent') or
    (name='박대원' and class_name='12월 입사자' and default_status='absent') or
    (name='박진영' and class_name='12월 입사자' and default_status='absent')
 )
);
do $$ begin
 if exists(select 1 from public.ax_lunch_users where name not in ('권도영','김서영','손규영','김민국','김상규','안소이','유태상','최철원','김주연','박서연','박진홍','양우진','장은영','김영탁','부유경','서유빈','오성현','김범준','박대원','박진영')) then
   raise exception 'Existing accounts outside the approved roster: review before applying this migration';
 end if;
end; $$;
insert into public.ax_lunch_roster(id,name,class_name,default_status)
select coalesce(u.id,seed.id),seed.name,seed.class_name,seed.default_status from (values
('00000000-0000-4000-8000-000000000001'::uuid,'권도영','4반','unset'),
('00000000-0000-4000-8000-000000000002'::uuid,'김서영','4반','unset'),
('00000000-0000-4000-8000-000000000003'::uuid,'손규영','4반','unset'),
('00000000-0000-4000-8000-000000000004'::uuid,'김민국','4반','unset'),
('00000000-0000-4000-8000-000000000005'::uuid,'김상규','4반','unset'),
('00000000-0000-4000-8000-000000000006'::uuid,'안소이','4반','unset'),
('00000000-0000-4000-8000-000000000007'::uuid,'유태상','4반','unset'),
('00000000-0000-4000-8000-000000000008'::uuid,'최철원','4반','unset'),
('00000000-0000-4000-8000-000000000009'::uuid,'김주연','5반','unset'),
('00000000-0000-4000-8000-000000000010'::uuid,'박서연','5반','unset'),
('00000000-0000-4000-8000-000000000011'::uuid,'박진홍','5반','unset'),
('00000000-0000-4000-8000-000000000012'::uuid,'양우진','5반','unset'),
('00000000-0000-4000-8000-000000000013'::uuid,'장은영','5반','unset'),
('00000000-0000-4000-8000-000000000014'::uuid,'김영탁','5반','unset'),
('00000000-0000-4000-8000-000000000015'::uuid,'부유경','5반','unset'),
('00000000-0000-4000-8000-000000000016'::uuid,'서유빈','5반','unset'),
('00000000-0000-4000-8000-000000000017'::uuid,'오성현','5반','unset'),
('00000000-0000-4000-8000-000000000018'::uuid,'김범준','12월 입사자','absent'),
('00000000-0000-4000-8000-000000000019'::uuid,'박대원','12월 입사자','absent'),
('00000000-0000-4000-8000-000000000020'::uuid,'박진영','12월 입사자','absent')) as seed(id,name,class_name,default_status)
left join public.ax_lunch_users u on u.name=seed.name
on conflict(name) do update set class_name=excluded.class_name, default_status=excluded.default_status;
update public.ax_lunch_users u set class_name=r.class_name from public.ax_lunch_roster r where u.id=r.id;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='ax_lunch_users_roster_id') then
   alter table public.ax_lunch_users add constraint ax_lunch_users_roster_id foreign key(id) references public.ax_lunch_roster(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='ax_lunch_users_roster_name') then
   alter table public.ax_lunch_users add constraint ax_lunch_users_roster_name foreign key(name) references public.ax_lunch_roster(name);
 end if;
end; $$;
alter table public.ax_lunch_roster enable row level security;
revoke all on public.ax_lunch_roster from public, anon, authenticated, service_role;
grant select on public.ax_lunch_roster to service_role;

-- Account identity and affiliation always come from the fixed roster.
create or replace function public.ax_lunch_check_identity()
returns trigger language plpgsql security definer set search_path=public as $$
declare person public.ax_lunch_roster%rowtype;
begin
 select * into person from public.ax_lunch_roster where id=new.id and name=new.name;
 if not found then raise exception 'Only the 20 listed participants may register'; end if;
 new.class_name := person.class_name;
 return new;
end;
$$;
revoke all on function public.ax_lunch_check_identity() from public, anon, authenticated;
drop trigger if exists ax_lunch_identity on public.ax_lunch_users;
create trigger ax_lunch_identity before insert or update on public.ax_lunch_users
for each row execute function public.ax_lunch_check_identity();


-- Apply after schema.sql (fresh installations already include this migration).

create table if not exists public.ax_lunch_settings (
 id integer primary key check(id=1),
 start_date date not null, end_date date not null,
 schema_version integer not null default 2,
 check(end_date>=start_date and end_date-start_date<=140)
);
insert into public.ax_lunch_settings(id,start_date,end_date) values(1,'2026-10-22','2026-11-03') on conflict(id) do nothing;
alter table public.ax_lunch_settings enable row level security;

create or replace function public.ax_lunch_user_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'className',class_name,'defaultStatus',default_status)
 from public.ax_lunch_roster where id=p_id;
$$;

create or replace function public.ax_lunch_require_session(p_token_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
 select user_id into uid from public.ax_lunch_sessions where token_hash=p_token_hash;
 if uid is null then raise exception using errcode='LN401',message='로그인이 필요합니다.'; end if;
 -- All credential/session mutations lock account first, then session.
 perform 1 from public.ax_lunch_users where id=uid for share;
 perform 1 from public.ax_lunch_sessions where token_hash=p_token_hash and expires_at>clock_timestamp() for share;
 if not found then raise exception using errcode='LN401',message='로그인이 필요합니다.'; end if;
 return uid;
end;
$$;

create or replace function public.ax_lunch_identity(p_token_hash text)
returns jsonb language sql stable security definer set search_path=public as $$
 select public.ax_lunch_user_json(user_id) from public.ax_lunch_sessions
 where token_hash=p_token_hash and expires_at>now();
$$;

create or replace function public.ax_lunch_rate_limit(p_key text,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_attempts integer;
begin
 if p_limit<1 or p_limit>200 then raise exception 'Invalid rate limit'; end if;
 insert into public.ax_lunch_auth_buckets(key,attempts,window_start) values(p_key,1,clock_timestamp())
 on conflict(key) do update set
 attempts=case when ax_lunch_auth_buckets.window_start<clock_timestamp()-interval '15 minutes' then 1 else least(ax_lunch_auth_buckets.attempts+1,1000000) end,
 window_start=case when ax_lunch_auth_buckets.window_start<clock_timestamp()-interval '15 minutes' then clock_timestamp() else ax_lunch_auth_buckets.window_start end
 returning attempts into current_attempts;
 return current_attempts<=p_limit;
end;
$$;

create or replace function public.ax_lunch_credentials(p_name text)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'pin_hash',pin_hash,'user',public.ax_lunch_user_json(id))
 from public.ax_lunch_users where name=p_name;
$$;

create or replace function public.ax_lunch_register(p_name text,p_pin_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare person public.ax_lunch_roster%rowtype;
begin
 select * into person from public.ax_lunch_roster where name=p_name;
 if not found then raise exception using errcode='LN400',message='등록된 20명만 이용할 수 있습니다.'; end if;
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

create or replace function public.ax_lunch_open_session(p_user_id uuid,p_expected_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare stored text;
begin
 select pin_hash into stored from public.ax_lunch_users where id=p_user_id for update;
 if stored is null or stored<>p_expected_hash then raise exception using errcode='LN401',message='PIN이 변경되었습니다. 다시 로그인해 주세요.'; end if;
 if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token format'; end if;
 insert into public.ax_lunch_sessions(token_hash,user_id,expires_at) values(p_token_hash,p_user_id,clock_timestamp()+interval '21 days');
 return public.ax_lunch_user_json(p_user_id);
end;
$$;

create or replace function public.ax_lunch_change_pin(p_token_hash text,p_expected_hash text,p_new_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; stored text;
begin
 select user_id into uid from public.ax_lunch_sessions where token_hash=p_token_hash;
 select pin_hash into stored from public.ax_lunch_users where id=uid for update;
 perform public.ax_lunch_require_session(p_token_hash);
 if stored is null or stored<>p_expected_hash then raise exception using errcode='LN401',message='현재 PIN을 다시 확인해 주세요.'; end if;
 if p_new_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' then raise exception 'Invalid PIN hash'; end if;
 update public.ax_lunch_users set pin_hash=p_new_hash where id=uid;
 delete from public.ax_lunch_sessions where user_id=uid;
 return true;
end;
$$;

create or replace function public.ax_lunch_end_session(p_token_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 delete from public.ax_lunch_sessions where token_hash=p_token_hash;
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
  'people',(select jsonb_agg(public.ax_lunch_user_json(r.id) order by r.class_name,r.name) from public.ax_lunch_roster r),
  'dates',(select jsonb_agg(to_char(d,'YYYY-MM-DD') order by d) from public.ax_lunch_settings c,
   lateral generate_series(c.start_date::timestamp,c.end_date::timestamp,interval '1 day') d
   where c.id=1 and extract(isodow from d)<6)
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
 if current_row.version<>p_expected_version then return false; end if;
 if jsonb_typeof(p_data->'choices') is distinct from 'object' or jsonb_typeof(p_data->'days') is distinct from 'object' or jsonb_typeof(p_data->'events') is distinct from 'array' then raise exception 'Invalid state'; end if;
 select * into settings from public.ax_lunch_settings where id=1;
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
 update public.ax_lunch_state set data=p_data,version=version+1 where id=1;
 return true;
end;
$$;

create or replace function public.ax_lunch_cleanup()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 delete from public.ax_lunch_sessions where expires_at<=clock_timestamp();
 delete from public.ax_lunch_auth_buckets where window_start<clock_timestamp()-interval '1 day';
 return true;
end;
$$;

create or replace function public.ax_lunch_health()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.ax_lunch_settings where id=1 and schema_version=2)
 or (select count(*) from public.ax_lunch_roster)<>20
 or not exists(select 1 from public.ax_lunch_state where id=1) then raise exception using errcode='LN503',message='DB 설정을 확인해 주세요.'; end if;
 return true;
end;
$$;

-- Only these service-only RPCs may access data. Browser roles have no table or RPC access.
revoke all on public.ax_lunch_users,public.ax_lunch_sessions,public.ax_lunch_state,public.ax_lunch_auth_buckets,public.ax_lunch_settings from public,anon,authenticated,service_role;
revoke all on public.ax_lunch_roster from public,anon,authenticated,service_role;
do $$ declare fn record; begin
 for fn in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'ax_lunch_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
 end loop;
end; $$;
grant execute on function public.ax_lunch_identity(text),public.ax_lunch_rate_limit(text,integer),public.ax_lunch_credentials(text),public.ax_lunch_register(text,text,text),public.ax_lunch_open_session(uuid,text,text),public.ax_lunch_change_pin(text,text,text),public.ax_lunch_end_session(text),public.ax_lunch_snapshot(text,boolean),public.ax_lunch_commit_state(text,integer,jsonb,text[],boolean),public.ax_lunch_cleanup(),public.ax_lunch_health() to service_role;

create table if not exists public.ax_lunch_admin_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references public.ax_lunch_roster(id),
 target_id uuid references public.ax_lunch_roster(id),
 action text not null check(action in ('reset_pin','revoke','recover')),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.ax_lunch_admin_events enable row level security;
revoke all on public.ax_lunch_admin_events from public,anon,authenticated,service_role;

-- The application checks the separate ADMIN_SECRET before calling these service-only RPCs.
-- Never grant them to browser roles. PIN replacement and session revocation are one transaction.
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

-- The server checks ADMIN_SECRET. This service-only RPC atomically replaces one
-- provisional day, preserving choices and all finalized history. Old groups are
-- deliberately not archived as encounters; only final days count as meetings.
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
 -- Check time after lock acquisition, including requests delayed across cutoff.
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
-- Preserve accounts, choices, group history and the original start date.
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
 -- Check time after lock acquisition, including requests delayed across cutoff.
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

-- SAME SUPABASE PROJECT. Global-only installer; preserves saved records.

do $guard$ begin
 if to_regprocedure('public.ax_lunch_tenant_info()') is not null then
  if public.ax_lunch_tenant_info()->>'tenant' is distinct from 'ax' then raise exception 'AX tenant configuration mismatch'; end if;
 elsif to_regprocedure('public.lunch_tenant_info()') is not null then
  if public.lunch_tenant_info()->>'tenant' is distinct from 'ax' then raise exception 'AX tenant configuration mismatch'; end if;
 else raise exception 'Apply the AX setup first';
 end if;
end $guard$;
-- Baseline for fresh and existing databases. Never deletes participant data.

-- Fixed roster: 8 in class 4, 9 in class 5, 3 December hires.
create table if not exists public.global_lunch_roster (
 id uuid primary key,
 name text not null unique,
 class_name text not null,
 default_status text not null check(default_status in ('unset','absent')),
 constraint global_lunch_roster_allowed check (
    (name='류지환' and class_name='IOA' and default_status='unset') or
    (name='박인홍' and class_name='IOA' and default_status='unset') or
    (name='백재호' and class_name='IOA' and default_status='unset') or
    (name='이상원' and class_name='IOA' and default_status='unset') or
    (name='이윤서' and class_name='IOA' and default_status='unset') or
    (name='최유정' and class_name='IOA' and default_status='unset') or
    (name='김현태' and class_name='IOA' and default_status='unset') or
    (name='유영채' and class_name='IOA' and default_status='unset') or
    (name='유한혁' and class_name='IOA' and default_status='unset') or
    (name='이다혜' and class_name='IOA' and default_status='unset') or
    (name='이시연' and class_name='IOA' and default_status='unset') or
    (name='정지우' and class_name='IOA' and default_status='unset') or
    (name='강준현' and class_name='IPO' and default_status='unset') or
    (name='고수현' and class_name='IPO' and default_status='unset') or
    (name='김혜진' and class_name='IPO' and default_status='unset') or
    (name='마승희' and class_name='IPO' and default_status='unset') or
    (name='문채윤' and class_name='IPO' and default_status='unset') or
    (name='윤두하' and class_name='IPO' and default_status='unset') or
    (name='곽종우' and class_name='IPO' and default_status='unset') or
    (name='이기하' and class_name='IPO' and default_status='unset')
 )
);

create table if not exists public.global_lunch_users (
 id uuid primary key, name text not null unique,
 class_name text not null default '', pin_hash text not null,
 created_at timestamptz not null default now()
);
-- Existing pre-roster installations keep their account UUIDs.
insert into public.global_lunch_roster(id,name,class_name,default_status)
select coalesce(u.id,seed.id),seed.name,seed.class_name,seed.default_status
from (values
('10000000-0000-4000-8000-000000000001'::uuid,'류지환','IOA','unset'),
('10000000-0000-4000-8000-000000000002'::uuid,'박인홍','IOA','unset'),
('10000000-0000-4000-8000-000000000003'::uuid,'백재호','IOA','unset'),
('10000000-0000-4000-8000-000000000004'::uuid,'이상원','IOA','unset'),
('10000000-0000-4000-8000-000000000005'::uuid,'이윤서','IOA','unset'),
('10000000-0000-4000-8000-000000000006'::uuid,'최유정','IOA','unset'),
('10000000-0000-4000-8000-000000000007'::uuid,'김현태','IOA','unset'),
('10000000-0000-4000-8000-000000000008'::uuid,'유영채','IOA','unset'),
('10000000-0000-4000-8000-000000000009'::uuid,'유한혁','IOA','unset'),
('10000000-0000-4000-8000-000000000010'::uuid,'이다혜','IOA','unset'),
('10000000-0000-4000-8000-000000000011'::uuid,'이시연','IOA','unset'),
('10000000-0000-4000-8000-000000000012'::uuid,'정지우','IOA','unset'),
('10000000-0000-4000-8000-000000000013'::uuid,'강준현','IPO','unset'),
('10000000-0000-4000-8000-000000000014'::uuid,'고수현','IPO','unset'),
('10000000-0000-4000-8000-000000000015'::uuid,'김혜진','IPO','unset'),
('10000000-0000-4000-8000-000000000016'::uuid,'마승희','IPO','unset'),
('10000000-0000-4000-8000-000000000017'::uuid,'문채윤','IPO','unset'),
('10000000-0000-4000-8000-000000000018'::uuid,'윤두하','IPO','unset'),
('10000000-0000-4000-8000-000000000019'::uuid,'곽종우','IPO','unset'),
('10000000-0000-4000-8000-000000000020'::uuid,'이기하','IPO','unset')) as seed(id,name,class_name,default_status)
left join public.global_lunch_users u on u.name=seed.name
on conflict(name) do nothing;
create table if not exists public.global_lunch_sessions (
 token_hash text primary key,user_id uuid not null references public.global_lunch_users(id) on delete cascade,expires_at timestamptz not null
);
create index if not exists global_lunch_sessions_user on public.global_lunch_sessions(user_id);
create table if not exists public.global_lunch_state (
 id integer primary key check(id=1),version integer not null default 0,
 data jsonb not null default '{"choices":{},"days":{},"events":[]}'::jsonb
);
insert into public.global_lunch_state(id) values(1) on conflict(id) do nothing;
create table if not exists public.global_lunch_auth_buckets(key text primary key,attempts integer not null,window_start timestamptz not null);
alter table public.global_lunch_users enable row level security;
alter table public.global_lunch_sessions enable row level security;
alter table public.global_lunch_state enable row level security;
alter table public.global_lunch_auth_buckets enable row level security;
grant usage on schema public to anon,authenticated,service_role;

-- Apply after baseline. Preserve existing accounts and request history.
-- Transactional: stop without deleting anything if accounts outside the roster exist.

lock table public.global_lunch_users, public.global_lunch_state in exclusive mode;
-- Fixed roster: 8 in class 4, 9 in class 5, 3 December hires.
create table if not exists public.global_lunch_roster (
 id uuid primary key,
 name text not null unique,
 class_name text not null,
 default_status text not null check(default_status in ('unset','absent')),
 constraint global_lunch_roster_allowed check (
    (name='류지환' and class_name='IOA' and default_status='unset') or
    (name='박인홍' and class_name='IOA' and default_status='unset') or
    (name='백재호' and class_name='IOA' and default_status='unset') or
    (name='이상원' and class_name='IOA' and default_status='unset') or
    (name='이윤서' and class_name='IOA' and default_status='unset') or
    (name='최유정' and class_name='IOA' and default_status='unset') or
    (name='김현태' and class_name='IOA' and default_status='unset') or
    (name='유영채' and class_name='IOA' and default_status='unset') or
    (name='유한혁' and class_name='IOA' and default_status='unset') or
    (name='이다혜' and class_name='IOA' and default_status='unset') or
    (name='이시연' and class_name='IOA' and default_status='unset') or
    (name='정지우' and class_name='IOA' and default_status='unset') or
    (name='강준현' and class_name='IPO' and default_status='unset') or
    (name='고수현' and class_name='IPO' and default_status='unset') or
    (name='김혜진' and class_name='IPO' and default_status='unset') or
    (name='마승희' and class_name='IPO' and default_status='unset') or
    (name='문채윤' and class_name='IPO' and default_status='unset') or
    (name='윤두하' and class_name='IPO' and default_status='unset') or
    (name='곽종우' and class_name='IPO' and default_status='unset') or
    (name='이기하' and class_name='IPO' and default_status='unset')
 )
);
do $$ begin
 if exists(select 1 from public.global_lunch_users where name not in ('류지환','박인홍','백재호','이상원','이윤서','최유정','김현태','유영채','유한혁','이다혜','이시연','정지우','강준현','고수현','김혜진','마승희','문채윤','윤두하','곽종우','이기하')) then
   raise exception 'Existing accounts outside the approved roster: review before applying this migration';
 end if;
end; $$;
insert into public.global_lunch_roster(id,name,class_name,default_status)
select coalesce(u.id,seed.id),seed.name,seed.class_name,seed.default_status from (values
('10000000-0000-4000-8000-000000000001'::uuid,'류지환','IOA','unset'),
('10000000-0000-4000-8000-000000000002'::uuid,'박인홍','IOA','unset'),
('10000000-0000-4000-8000-000000000003'::uuid,'백재호','IOA','unset'),
('10000000-0000-4000-8000-000000000004'::uuid,'이상원','IOA','unset'),
('10000000-0000-4000-8000-000000000005'::uuid,'이윤서','IOA','unset'),
('10000000-0000-4000-8000-000000000006'::uuid,'최유정','IOA','unset'),
('10000000-0000-4000-8000-000000000007'::uuid,'김현태','IOA','unset'),
('10000000-0000-4000-8000-000000000008'::uuid,'유영채','IOA','unset'),
('10000000-0000-4000-8000-000000000009'::uuid,'유한혁','IOA','unset'),
('10000000-0000-4000-8000-000000000010'::uuid,'이다혜','IOA','unset'),
('10000000-0000-4000-8000-000000000011'::uuid,'이시연','IOA','unset'),
('10000000-0000-4000-8000-000000000012'::uuid,'정지우','IOA','unset'),
('10000000-0000-4000-8000-000000000013'::uuid,'강준현','IPO','unset'),
('10000000-0000-4000-8000-000000000014'::uuid,'고수현','IPO','unset'),
('10000000-0000-4000-8000-000000000015'::uuid,'김혜진','IPO','unset'),
('10000000-0000-4000-8000-000000000016'::uuid,'마승희','IPO','unset'),
('10000000-0000-4000-8000-000000000017'::uuid,'문채윤','IPO','unset'),
('10000000-0000-4000-8000-000000000018'::uuid,'윤두하','IPO','unset'),
('10000000-0000-4000-8000-000000000019'::uuid,'곽종우','IPO','unset'),
('10000000-0000-4000-8000-000000000020'::uuid,'이기하','IPO','unset')) as seed(id,name,class_name,default_status)
left join public.global_lunch_users u on u.name=seed.name
on conflict(name) do update set class_name=excluded.class_name, default_status=excluded.default_status;
update public.global_lunch_users u set class_name=r.class_name from public.global_lunch_roster r where u.id=r.id;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='global_lunch_users_roster_id') then
   alter table public.global_lunch_users add constraint global_lunch_users_roster_id foreign key(id) references public.global_lunch_roster(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='global_lunch_users_roster_name') then
   alter table public.global_lunch_users add constraint global_lunch_users_roster_name foreign key(name) references public.global_lunch_roster(name);
 end if;
end; $$;
alter table public.global_lunch_roster enable row level security;
revoke all on public.global_lunch_roster from public, anon, authenticated, service_role;
grant select on public.global_lunch_roster to service_role;

-- Account identity and affiliation always come from the fixed roster.
create or replace function public.global_lunch_check_identity()
returns trigger language plpgsql security definer set search_path=public as $$
declare person public.global_lunch_roster%rowtype;
begin
 select * into person from public.global_lunch_roster where id=new.id and name=new.name;
 if not found then raise exception 'Only the 20 listed participants may register'; end if;
 new.class_name := person.class_name;
 return new;
end;
$$;
revoke all on function public.global_lunch_check_identity() from public, anon, authenticated;
drop trigger if exists global_lunch_identity on public.global_lunch_users;
create trigger global_lunch_identity before insert or update on public.global_lunch_users
for each row execute function public.global_lunch_check_identity();


-- Apply after schema.sql (fresh installations already include this migration).

create table if not exists public.global_lunch_settings (
 id integer primary key check(id=1),
 start_date date not null, end_date date not null,
 schema_version integer not null default 2,
 check(end_date>=start_date and end_date-start_date<=140)
);
insert into public.global_lunch_settings(id,start_date,end_date) values(1,'2026-10-22','2026-11-03') on conflict(id) do nothing;
alter table public.global_lunch_settings enable row level security;

create or replace function public.global_lunch_user_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'className',class_name,'defaultStatus',default_status)
 from public.global_lunch_roster where id=p_id;
$$;

create or replace function public.global_lunch_require_session(p_token_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
 select user_id into uid from public.global_lunch_sessions where token_hash=p_token_hash;
 if uid is null then raise exception using errcode='LN401',message='로그인이 필요합니다.'; end if;
 -- All credential/session mutations lock account first, then session.
 perform 1 from public.global_lunch_users where id=uid for share;
 perform 1 from public.global_lunch_sessions where token_hash=p_token_hash and expires_at>clock_timestamp() for share;
 if not found then raise exception using errcode='LN401',message='로그인이 필요합니다.'; end if;
 return uid;
end;
$$;

create or replace function public.global_lunch_identity(p_token_hash text)
returns jsonb language sql stable security definer set search_path=public as $$
 select public.global_lunch_user_json(user_id) from public.global_lunch_sessions
 where token_hash=p_token_hash and expires_at>now();
$$;

create or replace function public.global_lunch_rate_limit(p_key text,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_attempts integer;
begin
 if p_limit<1 or p_limit>200 then raise exception 'Invalid rate limit'; end if;
 insert into public.global_lunch_auth_buckets(key,attempts,window_start) values(p_key,1,clock_timestamp())
 on conflict(key) do update set
 attempts=case when global_lunch_auth_buckets.window_start<clock_timestamp()-interval '15 minutes' then 1 else least(global_lunch_auth_buckets.attempts+1,1000000) end,
 window_start=case when global_lunch_auth_buckets.window_start<clock_timestamp()-interval '15 minutes' then clock_timestamp() else global_lunch_auth_buckets.window_start end
 returning attempts into current_attempts;
 return current_attempts<=p_limit;
end;
$$;

create or replace function public.global_lunch_credentials(p_name text)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'pin_hash',pin_hash,'user',public.global_lunch_user_json(id))
 from public.global_lunch_users where name=p_name;
$$;

create or replace function public.global_lunch_register(p_name text,p_pin_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare person public.global_lunch_roster%rowtype;
begin
 select * into person from public.global_lunch_roster where name=p_name;
 if not found then raise exception using errcode='LN400',message='등록된 20명만 이용할 수 있습니다.'; end if;
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

create or replace function public.global_lunch_open_session(p_user_id uuid,p_expected_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare stored text;
begin
 select pin_hash into stored from public.global_lunch_users where id=p_user_id for update;
 if stored is null or stored<>p_expected_hash then raise exception using errcode='LN401',message='PIN이 변경되었습니다. 다시 로그인해 주세요.'; end if;
 if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token format'; end if;
 insert into public.global_lunch_sessions(token_hash,user_id,expires_at) values(p_token_hash,p_user_id,clock_timestamp()+interval '21 days');
 return public.global_lunch_user_json(p_user_id);
end;
$$;

create or replace function public.global_lunch_change_pin(p_token_hash text,p_expected_hash text,p_new_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; stored text;
begin
 select user_id into uid from public.global_lunch_sessions where token_hash=p_token_hash;
 select pin_hash into stored from public.global_lunch_users where id=uid for update;
 perform public.global_lunch_require_session(p_token_hash);
 if stored is null or stored<>p_expected_hash then raise exception using errcode='LN401',message='현재 PIN을 다시 확인해 주세요.'; end if;
 if p_new_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' then raise exception 'Invalid PIN hash'; end if;
 update public.global_lunch_users set pin_hash=p_new_hash where id=uid;
 delete from public.global_lunch_sessions where user_id=uid;
 return true;
end;
$$;

create or replace function public.global_lunch_end_session(p_token_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 delete from public.global_lunch_sessions where token_hash=p_token_hash;
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
  'people',(select jsonb_agg(public.global_lunch_user_json(r.id) order by r.class_name,r.name) from public.global_lunch_roster r),
  'dates',(select jsonb_agg(to_char(d,'YYYY-MM-DD') order by d) from public.global_lunch_settings c,
   lateral generate_series(c.start_date::timestamp,c.end_date::timestamp,interval '1 day') d
   where c.id=1 and extract(isodow from d)<6)
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
 if current_row.version<>p_expected_version then return false; end if;
 if jsonb_typeof(p_data->'choices') is distinct from 'object' or jsonb_typeof(p_data->'days') is distinct from 'object' or jsonb_typeof(p_data->'events') is distinct from 'array' then raise exception 'Invalid state'; end if;
 select * into settings from public.global_lunch_settings where id=1;
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
 update public.global_lunch_state set data=p_data,version=version+1 where id=1;
 return true;
end;
$$;

create or replace function public.global_lunch_cleanup()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 delete from public.global_lunch_sessions where expires_at<=clock_timestamp();
 delete from public.global_lunch_auth_buckets where window_start<clock_timestamp()-interval '1 day';
 return true;
end;
$$;

create or replace function public.global_lunch_health()
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.global_lunch_settings where id=1 and schema_version=2)
 or (select count(*) from public.global_lunch_roster)<>20
 or not exists(select 1 from public.global_lunch_state where id=1) then raise exception using errcode='LN503',message='DB 설정을 확인해 주세요.'; end if;
 return true;
end;
$$;

-- Only these service-only RPCs may access data. Browser roles have no table or RPC access.
revoke all on public.global_lunch_users,public.global_lunch_sessions,public.global_lunch_state,public.global_lunch_auth_buckets,public.global_lunch_settings from public,anon,authenticated,service_role;
revoke all on public.global_lunch_roster from public,anon,authenticated,service_role;
do $$ declare fn record; begin
 for fn in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'global_lunch_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
 end loop;
end; $$;
grant execute on function public.global_lunch_identity(text),public.global_lunch_rate_limit(text,integer),public.global_lunch_credentials(text),public.global_lunch_register(text,text,text),public.global_lunch_open_session(uuid,text,text),public.global_lunch_change_pin(text,text,text),public.global_lunch_end_session(text),public.global_lunch_snapshot(text,boolean),public.global_lunch_commit_state(text,integer,jsonb,text[],boolean),public.global_lunch_cleanup(),public.global_lunch_health() to service_role;

create table if not exists public.global_lunch_admin_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references public.global_lunch_roster(id),
 target_id uuid references public.global_lunch_roster(id),
 action text not null check(action in ('reset_pin','revoke','recover')),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.global_lunch_admin_events enable row level security;
revoke all on public.global_lunch_admin_events from public,anon,authenticated,service_role;

-- The application checks the separate ADMIN_SECRET before calling these service-only RPCs.
-- Never grant them to browser roles. PIN replacement and session revocation are one transaction.
create or replace function public.global_lunch_admin_account(p_actor_token text,p_target_name text,p_new_hash text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare actor uuid; target uuid;
begin
 perform pg_advisory_xact_lock(610230901);
 select id into target from public.global_lunch_users where name=p_target_name for update;
 if target is null then raise exception using errcode='LN400',message='아직 등록하지 않은 사용자입니다.'; end if;
 actor:=public.global_lunch_require_session(p_actor_token);
 if p_new_hash is not null then
  if p_new_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' then raise exception 'Invalid PIN hash'; end if;
  update public.global_lunch_users set pin_hash=p_new_hash where id=target;
 end if;
 delete from public.global_lunch_sessions where user_id=target;
 insert into public.global_lunch_admin_events(actor_id,target_id,action) values(actor,target,case when p_new_hash is null then 'revoke' else 'reset_pin' end);
 return true;
end;
$$;
create or replace function public.global_lunch_admin_recover_log(p_actor_token text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.global_lunch_admin_events(actor_id,action) values(public.global_lunch_require_session(p_actor_token),'recover');
 return true;
end;
$$;
revoke all on function public.global_lunch_admin_account(text,text,text),public.global_lunch_admin_recover_log(text) from public,anon,authenticated;
grant execute on function public.global_lunch_admin_account(text,text,text),public.global_lunch_admin_recover_log(text) to service_role;

alter table public.global_lunch_admin_events add column if not exists target_date date;
alter table public.global_lunch_admin_events drop constraint if exists global_lunch_admin_events_action_check;
alter table public.global_lunch_admin_events add constraint global_lunch_admin_events_action_check check(action in ('reset_pin','revoke','recover','rematch','initial_match'));

-- The server checks ADMIN_SECRET. This service-only RPC atomically replaces one
-- provisional day, preserving choices and all finalized history. Old groups are
-- deliberately not archived as encounters; only final days count as meetings.
create or replace function public.global_lunch_admin_rematch(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.global_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.global_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.global_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.global_lunch_settings where id=1 and p_date::date between start_date and end_date and extract(isodow from p_date::date)<6) then
  raise exception using errcode='LN400',message='운영 기간의 평일만 재편성할 수 있습니다.';
 end if;
 check_time:=clock_timestamp();
 current_day:=current_row.data->'days'->p_date;
 -- Check time after lock acquisition, including requests delayed across cutoff.
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
  where not exists(select 1 from public.global_lunch_roster r where r.id::text=m->>'id' and r.name=m->>'name' and r.class_name=m->>'className')
   or (current_row.data->'choices'->p_date->(m->>'id')->>'meal' in ('lunchbox','outside') and current_row.data->'choices'->p_date->(m->>'id')->>'meal'<>g->>'meal')) then
  raise exception using errcode='LN400',message='참가자 정보와 필수 메뉴 조건을 확인해 주세요.';
 end if;
 next_day:=current_day||jsonb_build_object('groups',p_groups,'rematchedAt',check_time);
 update public.global_lunch_state set data=jsonb_set(current_row.data,array['days',p_date],next_day),version=version+1 where id=1;
 insert into public.global_lunch_admin_events(actor_id,action,target_date) values(actor,'rematch',p_date::date);
 return true;
end;
$$;
revoke all on function public.global_lunch_admin_rematch(text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.global_lunch_admin_rematch(text,integer,text,jsonb) to service_role;

alter table public.global_lunch_settings add column if not exists tenant_key text not null default 'ax' check(tenant_key in ('ax','global'));
-- Preserve accounts, choices, group history and the original start date.
update public.global_lunch_settings set end_date=greatest(end_date,'2026-11-30'::date) where id=1 and tenant_key='ax';
create table if not exists public.global_lunch_job_runs (
 id integer primary key check(id=1),last_attempt_at timestamptz,last_success_at timestamptz,last_ok boolean,last_code text
);
insert into public.global_lunch_job_runs(id) values(1) on conflict(id) do nothing;
alter table public.global_lunch_job_runs enable row level security;
revoke all on public.global_lunch_job_runs from public,anon,authenticated,service_role;
alter table public.global_lunch_admin_events drop constraint if exists global_lunch_admin_events_action_check;
alter table public.global_lunch_admin_events add constraint global_lunch_admin_events_action_check check(action in ('reset_pin','revoke','recover','rematch','initial_match'));
create or replace function public.global_lunch_tenant_info()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',tenant_key,'startDate',start_date,'endDate',end_date,'capabilities',3) from public.global_lunch_settings where id=1;
$$;
create or replace function public.global_lunch_record_job(p_ok boolean,p_code text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.global_lunch_job_runs set last_attempt_at=clock_timestamp(),last_ok=p_ok,last_code=case when p_ok then null else left(p_code,40) end,last_success_at=case when p_ok then clock_timestamp() else last_success_at end where id=1;
 return true;
end;
$$;
create or replace function public.global_lunch_system_status()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',s.tenant_key,'startDate',s.start_date,'endDate',s.end_date,'now',clock_timestamp(),'lastAttemptAt',j.last_attempt_at,'lastSuccessAt',j.last_success_at,'lastOk',j.last_ok,'lastCode',j.last_code,'registered',(select count(*) from public.global_lunch_users),'rosterCount',(select count(*) from public.global_lunch_roster)) from public.global_lunch_settings s left join public.global_lunch_job_runs j on j.id=s.id where s.id=1;
$$;
revoke all on function public.global_lunch_tenant_info(),public.global_lunch_record_job(boolean,text),public.global_lunch_system_status() from public,anon,authenticated;
grant execute on function public.global_lunch_tenant_info(),public.global_lunch_record_job(boolean,text),public.global_lunch_system_status() to service_role;
create or replace function public.global_lunch_admin_initial_match(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.global_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.global_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.global_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.global_lunch_settings where id=1 and p_date::date between start_date and end_date and extract(isodow from p_date::date)<6) then
  raise exception using errcode='LN400',message='운영 기간의 평일만 재편성할 수 있습니다.';
 end if;
 check_time:=clock_timestamp();
 current_day:=current_row.data->'days'->p_date;
 if p_date::date<>(select start_date from public.global_lunch_settings where id=1) then raise exception using errcode='LN400',message='운영 첫날에만 최초 편성을 실행할 수 있습니다.'; end if;
 if current_day->>'phase'='final' or coalesce(jsonb_array_length(current_day->'groups'),0)>0 then raise exception using errcode='LN409',message='이미 조가 있습니다. 전체 조 다시 편성을 사용해 주세요.'; end if;
 if current_day is null then current_day:=jsonb_build_object('phase','matched','groups','[]'::jsonb,'matchedAt',check_time); end if;
 -- Check time after lock acquisition, including requests delayed across cutoff.
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
  where not exists(select 1 from public.global_lunch_roster r where r.id::text=m->>'id' and r.name=m->>'name' and r.class_name=m->>'className')
   or (current_row.data->'choices'->p_date->(m->>'id')->>'meal' in ('lunchbox','outside') and current_row.data->'choices'->p_date->(m->>'id')->>'meal'<>g->>'meal')) then
  raise exception using errcode='LN400',message='참가자 정보와 필수 메뉴 조건을 확인해 주세요.';
 end if;
 next_day:=current_day||jsonb_build_object('groups',p_groups,'matchedAt',check_time);
 update public.global_lunch_state set data=jsonb_set(current_row.data,array['days',p_date],next_day),version=version+1 where id=1;
 insert into public.global_lunch_admin_events(actor_id,action,target_date) values(actor,'initial_match',p_date::date);
 return true;
end;
$$;
revoke all on function public.global_lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.global_lunch_admin_initial_match(text,integer,text,jsonb) to service_role;

update public.global_lunch_settings set tenant_key='global',end_date='2026-11-30',start_date=(
 select d::date from generate_series(
  (case when (clock_timestamp() at time zone 'Asia/Seoul')::time<time '11:00' then (clock_timestamp() at time zone 'Asia/Seoul')::date else (clock_timestamp() at time zone 'Asia/Seoul')::date+1 end)::timestamp,
  '2026-11-30'::timestamp,interval '1 day') d where extract(isodow from d)<6 order by d limit 1
) where id=1 and tenant_key='ax';
notify pgrst, 'reload schema';

notify pgrst, 'reload schema';
commit;
