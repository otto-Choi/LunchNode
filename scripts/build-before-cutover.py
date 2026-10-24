from pathlib import Path
import re
r=Path(__file__).resolve().parents[1]
rename=(r/'supabase/ax-rename.sql').read_text()
ops='\n'.join((r/'supabase/migrations'/f).read_text() for f in ['20261021090300_admin_tools.sql','20261021090400_admin_rematch.sql','20261023090000_headquarters_operations.sql'])
ops=re.sub(r'(?m)^begin;\s*$','',ops);ops=re.sub(r'(?m)^commit;\s*$','',ops)
ops=re.sub(r'\blunch_','ax_lunch_',ops)
ops=ops.replace("check(action in ('reset_pin','revoke','recover','rematch'))","check(action in ('reset_pin','revoke','recover','rematch','initial_match'))").replace('pg_advisory_xact_lock(610210903)','pg_advisory_xact_lock(610230902)')
start='''begin;
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
'''
global_sql='''
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
notify pgrst,'reload schema';
commit;
'''
correction=(r/'supabase/migrations/20261024090000_global_name_correction.sql').read_text()
correction=re.sub(r'(?m)^(begin;|commit;)\s*$','',correction)
global_sql=global_sql.replace("notify pgrst,'reload schema';",correction+"\nnotify pgrst,'reload schema';")
s=start+rename+'\n'+ops+'\n'+global_sql
# Remove comments and blank lines only; keep all executable text intact.
s='\n'.join(line for line in s.splitlines() if line.strip() and not line.lstrip().startswith('--'))+'\n'
(r/'supabase/upgrade-before-cutover.sql').write_text(s)
print(len(s.splitlines()),len(s.encode()))
