begin;
alter table public.lunch_settings add column if not exists tenant_key text not null default 'ax' check(tenant_key in ('ax','global'));
-- Preserve accounts, choices, group history and the original start date.
update public.lunch_settings set end_date=greatest(end_date,'2026-11-30'::date) where id=1 and tenant_key='ax';
create table if not exists public.lunch_job_runs (
 id integer primary key check(id=1),last_attempt_at timestamptz,last_success_at timestamptz,last_ok boolean,last_code text
);
insert into public.lunch_job_runs(id) values(1) on conflict(id) do nothing;
alter table public.lunch_job_runs enable row level security;
revoke all on public.lunch_job_runs from public,anon,authenticated,service_role;
alter table public.lunch_admin_events drop constraint if exists lunch_admin_events_action_check;
alter table public.lunch_admin_events add constraint lunch_admin_events_action_check check(action in ('reset_pin','revoke','recover','rematch','initial_match'));
create or replace function public.lunch_tenant_info()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',tenant_key,'startDate',start_date,'endDate',end_date,'capabilities',3) from public.lunch_settings where id=1;
$$;
create or replace function public.lunch_record_job(p_ok boolean,p_code text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.lunch_job_runs set last_attempt_at=clock_timestamp(),last_ok=p_ok,last_code=case when p_ok then null else left(p_code,40) end,last_success_at=case when p_ok then clock_timestamp() else last_success_at end where id=1;
 return true;
end;
$$;
create or replace function public.lunch_system_status()
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('tenant',s.tenant_key,'startDate',s.start_date,'endDate',s.end_date,'now',clock_timestamp(),'lastAttemptAt',j.last_attempt_at,'lastSuccessAt',j.last_success_at,'lastOk',j.last_ok,'lastCode',j.last_code,'registered',(select count(*) from public.lunch_users),'rosterCount',(select count(*) from public.lunch_roster)) from public.lunch_settings s left join public.lunch_job_runs j on j.id=s.id where s.id=1;
$$;
revoke all on function public.lunch_tenant_info(),public.lunch_record_job(boolean,text),public.lunch_system_status() from public,anon,authenticated;
grant execute on function public.lunch_tenant_info(),public.lunch_record_job(boolean,text),public.lunch_system_status() to service_role;
create or replace function public.lunch_admin_initial_match(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.lunch_settings where id=1 and p_date::date between start_date and end_date and extract(isodow from p_date::date)<6) then
  raise exception using errcode='LN400',message='운영 기간의 평일만 재편성할 수 있습니다.';
 end if;
 check_time:=clock_timestamp();
 current_day:=current_row.data->'days'->p_date;
 if p_date::date<>(select start_date from public.lunch_settings where id=1) then raise exception using errcode='LN400',message='운영 첫날에만 최초 편성을 실행할 수 있습니다.'; end if;
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
  where not exists(select 1 from public.lunch_roster r where r.id::text=m->>'id' and r.name=m->>'name' and r.class_name=m->>'className')
   or (current_row.data->'choices'->p_date->(m->>'id')->>'meal' in ('lunchbox','outside') and current_row.data->'choices'->p_date->(m->>'id')->>'meal'<>g->>'meal')) then
  raise exception using errcode='LN400',message='참가자 정보와 필수 메뉴 조건을 확인해 주세요.';
 end if;
 next_day:=current_day||jsonb_build_object('groups',p_groups,'matchedAt',check_time);
 update public.lunch_state set data=jsonb_set(current_row.data,array['days',p_date],next_day),version=version+1 where id=1;
 insert into public.lunch_admin_events(actor_id,action,target_date) values(actor,'initial_match',p_date::date);
 return true;
end;
$$;
revoke all on function public.lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.lunch_admin_initial_match(text,integer,text,jsonb) to service_role;
commit;
