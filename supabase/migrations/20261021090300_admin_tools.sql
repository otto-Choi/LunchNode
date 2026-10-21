begin;
create table if not exists public.lunch_admin_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null references public.lunch_roster(id),
 target_id uuid references public.lunch_roster(id),
 action text not null check(action in ('reset_pin','revoke','recover')),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.lunch_admin_events enable row level security;
revoke all on public.lunch_admin_events from public,anon,authenticated,service_role;

-- The application checks the separate ADMIN_SECRET before calling these service-only RPCs.
-- Never grant them to browser roles. PIN replacement and session revocation are one transaction.
create or replace function public.lunch_admin_account(p_actor_token text,p_target_name text,p_new_hash text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare actor uuid; target uuid;
begin
 perform pg_advisory_xact_lock(610210903);
 select id into target from public.lunch_users where name=p_target_name for update;
 if target is null then raise exception using errcode='LN400',message='아직 등록하지 않은 사용자입니다.'; end if;
 actor:=public.lunch_require_session(p_actor_token);
 if p_new_hash is not null then
  if p_new_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' then raise exception 'Invalid PIN hash'; end if;
  update public.lunch_users set pin_hash=p_new_hash where id=target;
 end if;
 delete from public.lunch_sessions where user_id=target;
 insert into public.lunch_admin_events(actor_id,target_id,action) values(actor,target,case when p_new_hash is null then 'revoke' else 'reset_pin' end);
 return true;
end;
$$;
create or replace function public.lunch_admin_recover_log(p_actor_token text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into public.lunch_admin_events(actor_id,action) values(public.lunch_require_session(p_actor_token),'recover');
 return true;
end;
$$;
revoke all on function public.lunch_admin_account(text,text,text),public.lunch_admin_recover_log(text) from public,anon,authenticated;
grant execute on function public.lunch_admin_account(text,text,text),public.lunch_admin_recover_log(text) to service_role;
commit;
