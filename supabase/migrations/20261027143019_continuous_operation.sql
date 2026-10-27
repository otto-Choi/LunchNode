begin;
create schema if not exists lunch_operation_private;
revoke all on schema lunch_operation_private from public,anon,authenticated,service_role;
create or replace function lunch_operation_private.calendar_dates(p_start date,p_end date,p_now timestamptz)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(to_char(d,'YYYY-MM-DD') order by d),'[]'::jsonb)
 from generate_series(p_start::timestamp,
 least(coalesce(p_end,'infinity'::date),(date_trunc('month',p_now at time zone 'Asia/Seoul')+interval '3 months'-interval '1 day')::date)::timestamp,
 interval '1 day') d where extract(isodow from d)<6;
$$;
revoke all on function lunch_operation_private.calendar_dates(date,date,timestamptz) from public,anon,authenticated,service_role;

alter table public.ax_lunch_settings alter column end_date drop not null;
alter table public.ax_lunch_settings drop constraint if exists ax_lunch_settings_check;
alter table public.ax_lunch_settings drop constraint if exists ax_lunch_settings_period_check;
alter table public.ax_lunch_settings add constraint ax_lunch_settings_period_check check(end_date is null or end_date>=start_date);
update public.ax_lunch_settings set end_date=null where id=1;

create or replace function public.ax_lunch_snapshot(p_token_hash text,p_cron boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; result jsonb;
begin
 if not p_cron then uid:=public.ax_lunch_require_session(p_token_hash); end if;
 select jsonb_build_object(
  'version',s.version,'state',s.data,'user',public.ax_lunch_user_json(uid),'now',clock_timestamp(),
  'people',(select jsonb_agg(public.ax_lunch_user_json(r.id) order by r.class_name,r.name) from public.ax_lunch_roster r),
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
create or replace function public.ax_lunch_admin_rematch(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.ax_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.ax_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.ax_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.ax_lunch_settings where id=1 and p_date::date>=start_date and (end_date is null or p_date::date<=end_date) and extract(isodow from p_date::date)<6) then
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
create or replace function public.ax_lunch_admin_initial_match(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.ax_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.ax_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.ax_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.ax_lunch_settings where id=1 and p_date::date>=start_date and (end_date is null or p_date::date<=end_date) and extract(isodow from p_date::date)<6) then
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
-- Existing RPC grants stay unchanged; no new public endpoint.
revoke all on function public.ax_lunch_snapshot(text,boolean),public.ax_lunch_commit_state(text,integer,jsonb,text[],boolean),public.ax_lunch_admin_rematch(text,integer,text,jsonb),public.ax_lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;

create index if not exists ax_lunch_admin_actor on public.ax_lunch_admin_events(actor_id);
create index if not exists ax_lunch_admin_target on public.ax_lunch_admin_events(target_id);
alter table public.global_lunch_settings alter column end_date drop not null;
alter table public.global_lunch_settings drop constraint if exists global_lunch_settings_check;
alter table public.global_lunch_settings drop constraint if exists global_lunch_settings_period_check;
alter table public.global_lunch_settings add constraint global_lunch_settings_period_check check(end_date is null or end_date>=start_date);
update public.global_lunch_settings set end_date=null where id=1;

create or replace function public.global_lunch_snapshot(p_token_hash text,p_cron boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; result jsonb;
begin
 if not p_cron then uid:=public.global_lunch_require_session(p_token_hash); end if;
 select jsonb_build_object(
  'version',s.version,'state',s.data,'user',public.global_lunch_user_json(uid),'now',clock_timestamp(),
  'people',(select jsonb_agg(public.global_lunch_user_json(r.id) order by r.class_name,r.name) from public.global_lunch_roster r),
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
create or replace function public.global_lunch_admin_rematch(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.global_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.global_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.global_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.global_lunch_settings where id=1 and p_date::date>=start_date and (end_date is null or p_date::date<=end_date) and extract(isodow from p_date::date)<6) then
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
create or replace function public.global_lunch_admin_initial_match(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.global_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.global_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.global_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.global_lunch_settings where id=1 and p_date::date>=start_date and (end_date is null or p_date::date<=end_date) and extract(isodow from p_date::date)<6) then
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
-- Existing RPC grants stay unchanged; no new public endpoint.
revoke all on function public.global_lunch_snapshot(text,boolean),public.global_lunch_commit_state(text,integer,jsonb,text[],boolean),public.global_lunch_admin_rematch(text,integer,text,jsonb),public.global_lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;

create index if not exists global_lunch_admin_actor on public.global_lunch_admin_events(actor_id);
create index if not exists global_lunch_admin_target on public.global_lunch_admin_events(target_id);
alter table public.tmt_lunch_settings alter column end_date drop not null;
alter table public.tmt_lunch_settings drop constraint if exists tmt_lunch_settings_check;
alter table public.tmt_lunch_settings drop constraint if exists tmt_lunch_settings_period_check;
alter table public.tmt_lunch_settings add constraint tmt_lunch_settings_period_check check(end_date is null or end_date>=start_date);
update public.tmt_lunch_settings set end_date=null where id=1;

create or replace function public.tmt_lunch_snapshot(p_token_hash text,p_cron boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid; result jsonb;
begin
 if not p_cron then uid:=public.tmt_lunch_require_session(p_token_hash); end if;
 select jsonb_build_object(
  'version',s.version,'state',s.data,'user',public.tmt_lunch_user_json(uid),'now',clock_timestamp(),
  'people',(select jsonb_agg(public.tmt_lunch_user_json(r.id) order by r.class_name,r.name) from public.tmt_lunch_roster r),
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
create or replace function public.tmt_lunch_admin_rematch(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.tmt_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.tmt_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.tmt_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.tmt_lunch_settings where id=1 and p_date::date>=start_date and (end_date is null or p_date::date<=end_date) and extract(isodow from p_date::date)<6) then
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
  where not exists(select 1 from public.tmt_lunch_roster r where r.id::text=m->>'id' and r.name=m->>'name' and r.class_name=m->>'className')
   or (current_row.data->'choices'->p_date->(m->>'id')->>'meal' in ('lunchbox','outside') and current_row.data->'choices'->p_date->(m->>'id')->>'meal'<>g->>'meal')) then
  raise exception using errcode='LN400',message='참가자 정보와 필수 메뉴 조건을 확인해 주세요.';
 end if;
 next_day:=current_day||jsonb_build_object('groups',p_groups,'rematchedAt',check_time);
 update public.tmt_lunch_state set data=jsonb_set(current_row.data,array['days',p_date],next_day),version=version+1 where id=1;
 insert into public.tmt_lunch_admin_events(actor_id,action,target_date) values(actor,'rematch',p_date::date);
 return true;
end;
$$;
create or replace function public.tmt_lunch_admin_initial_match(p_actor_token text,p_expected_version integer,p_date text,p_groups jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.tmt_lunch_state%rowtype; actor uuid; current_day jsonb; next_day jsonb; check_time timestamptz; actual_ids text[]; expected_ids text[];
begin
 select * into current_row from public.tmt_lunch_state where id=1 for update;
 if not found then raise exception using errcode='LN503',message='DB 초기화가 필요합니다.'; end if;
 actor:=public.tmt_lunch_require_session(p_actor_token);
 if current_row.version<>p_expected_version then return false; end if;
 if not exists(select 1 from public.tmt_lunch_settings where id=1 and p_date::date>=start_date and (end_date is null or p_date::date<=end_date) and extract(isodow from p_date::date)<6) then
  raise exception using errcode='LN400',message='운영 기간의 평일만 재편성할 수 있습니다.';
 end if;
 check_time:=clock_timestamp();
 current_day:=current_row.data->'days'->p_date;
 if p_date::date<>(select start_date from public.tmt_lunch_settings where id=1) then raise exception using errcode='LN400',message='운영 첫날에만 최초 편성을 실행할 수 있습니다.'; end if;
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
  where not exists(select 1 from public.tmt_lunch_roster r where r.id::text=m->>'id' and r.name=m->>'name' and r.class_name=m->>'className')
   or (current_row.data->'choices'->p_date->(m->>'id')->>'meal' in ('lunchbox','outside') and current_row.data->'choices'->p_date->(m->>'id')->>'meal'<>g->>'meal')) then
  raise exception using errcode='LN400',message='참가자 정보와 필수 메뉴 조건을 확인해 주세요.';
 end if;
 next_day:=current_day||jsonb_build_object('groups',p_groups,'matchedAt',check_time);
 update public.tmt_lunch_state set data=jsonb_set(current_row.data,array['days',p_date],next_day),version=version+1 where id=1;
 insert into public.tmt_lunch_admin_events(actor_id,action,target_date) values(actor,'initial_match',p_date::date);
 return true;
end;
$$;
-- Existing RPC grants stay unchanged; no new public endpoint.
revoke all on function public.tmt_lunch_snapshot(text,boolean),public.tmt_lunch_commit_state(text,integer,jsonb,text[],boolean),public.tmt_lunch_admin_rematch(text,integer,text,jsonb),public.tmt_lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;

create index if not exists tmt_lunch_admin_actor on public.tmt_lunch_admin_events(actor_id);
create index if not exists tmt_lunch_admin_target on public.tmt_lunch_admin_events(target_id);
create index if not exists group_node_votes_date on public.group_node_votes(meetup_id,date_id);
create or replace function group_node_private.request(p_tenant text,p_token_hash text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid; m public.group_node_meetups%rowtype; c jsonb; date_id uuid; candidate_ids uuid[]='{}';
 result jsonb; all_rows jsonb; today date=(clock_timestamp() at time zone 'Asia/Seoul')::date;
 is_past boolean; owner boolean; changed boolean=false; previous public.group_node_dates%rowtype; total integer;
begin
 actor_id:=group_node_private.actor(p_tenant,p_token_hash);
 if p_action='list' then
  with filtered as materialized (
   select item.id,item.created_at from public.group_node_meetups item
   where (item.visibility='all' or item.created_by_tenant=p_tenant)
   and (coalesce(p_payload->>'category','')='' or item.category=p_payload->>'category')
   and (coalesce(p_payload->>'q','')='' or item.title ilike '%'||(p_payload->>'q')||'%')
   and (not coalesce((p_payload->>'onlyHeadquarters')::boolean,false) or item.created_by_tenant=p_tenant)
   and (case when p_payload->>'view'='past' then (item.status='cancelled' or (select coalesce(max(date) filter(where id=item.confirmed_date_id),max(date)) from public.group_node_dates where meetup_id=item.id)<today)
    else item.status<>'cancelled' and (select coalesce(max(date) filter(where id=item.confirmed_date_id),max(date)) from public.group_node_dates where meetup_id=item.id)>=today end)
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
  if jsonb_typeof(p_payload->'dates') is distinct from 'array' or jsonb_array_length(p_payload->'dates') not between 1 and 5 then raise exception using errcode='LN400',message='후보 날짜는 1~5개입니다.';end if;
 end if;
 if p_action='create' then
  insert into public.group_node_meetups(title,description,category,min_people,visibility,created_by_tenant,created_by)
  values(btrim(p_payload->>'title'),coalesce(p_payload->>'description',''),p_payload->>'category',(p_payload->>'minPeople')::int,p_payload->>'visibility',p_tenant,actor_id) returning * into m;
  insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_tenant,actor_id);
 else
  select * into m from public.group_node_meetups where id=(p_payload->>'id')::uuid for update;
  if not found or (m.visibility='headquarters' and m.created_by_tenant<>p_tenant) then raise exception using errcode='LN404',message='모임을 찾을 수 없습니다.';end if;
  -- Recheck after a lock wait, including a concurrent operator session revocation.
  if group_node_private.actor(p_tenant,p_token_hash) is distinct from actor_id then raise exception using errcode='LN401',message='로그인이 필요합니다.';end if;
 end if;
 owner:=m.created_by=actor_id and m.created_by_tenant=p_tenant;
 if p_action in ('update','delete','confirm','reopen','cancel') then
  if not owner then raise exception using errcode='LN403',message='모임장만 실행할 수 있습니다.';end if;
  if m.version is distinct from (p_payload->>'version')::int then raise exception using errcode='LN409',message='모임이 변경되었습니다. 다시 불러온 후 시도해 주세요.';end if;
 end if;
 select m.status='cancelled' or coalesce(max(date) filter(where id=m.confirmed_date_id),max(date))<today into is_past from public.group_node_dates where meetup_id=m.id;
 if p_action in ('join','leave','vote','unvote') and coalesce(is_past,false) then raise exception using errcode='LN409',message='종료되거나 취소된 모임입니다.';end if;
 if p_action in ('create','update') then
  if p_action='update' then
   if p_payload->>'visibility'='headquarters' and m.visibility='all' and (
    exists(select 1 from public.group_node_participants where meetup_id=m.id and tenant<>p_tenant)
    or exists(select 1 from public.group_node_comments where meetup_id=m.id and tenant<>p_tenant)) then
    raise exception using errcode='LN409',message='다른 본부의 참여나 댓글이 있어 모집 범위를 줄일 수 없습니다.';
   end if;
   update public.group_node_meetups set title=btrim(p_payload->>'title'),description=coalesce(p_payload->>'description',''),category=p_payload->>'category',
    min_people=(p_payload->>'minPeople')::int,visibility=p_payload->>'visibility',version=version+1 where id=m.id;
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
 elsif p_action='delete' then
  delete from public.group_node_meetups where id=m.id;return jsonb_build_object('ok',true);
 elsif p_action='join' then
  insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_tenant,actor_id) on conflict do nothing;
 elsif p_action='leave' then
  delete from public.group_node_participants where meetup_id=m.id and tenant=p_tenant and user_id=actor_id;
 elsif p_action in ('vote','unvote') then
  if not exists(select 1 from public.group_node_participants where meetup_id=m.id and tenant=p_tenant and user_id=actor_id) then raise exception using errcode='LN409',message='모임 참여 후 투표해 주세요.';end if;
  if not exists(select 1 from public.group_node_dates where id=(p_payload->>'dateId')::uuid and meetup_id=m.id) then raise exception using errcode='LN404',message='후보 날짜를 찾을 수 없습니다.';end if;
  if p_action='vote' then insert into public.group_node_votes(meetup_id,date_id,tenant,user_id) values(m.id,(p_payload->>'dateId')::uuid,p_tenant,actor_id) on conflict do nothing;
  else delete from public.group_node_votes v where v.date_id=(p_payload->>'dateId')::uuid and tenant=p_tenant and user_id=actor_id;end if;
 elsif p_action='comment' then
  insert into public.group_node_comments(meetup_id,tenant,user_id,body) values(m.id,p_tenant,actor_id,btrim(p_payload->>'body'));
 elsif p_action='delete_comment' then
  delete from public.group_node_comments where id=(p_payload->>'commentId')::uuid and meetup_id=m.id and tenant=p_tenant and user_id=actor_id;
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
