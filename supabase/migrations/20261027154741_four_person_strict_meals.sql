begin;
-- Preserve all saved choices, accounts and historical groups. Only changed/new groups are capped.
create or replace function public.ax_lunch_commit_state(
 p_token_hash text,p_expected_version integer,p_data jsonb,p_write_dates text[],p_cron boolean default false
) returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.ax_lunch_state%rowtype; settings public.ax_lunch_settings%rowtype; day_text text; closed_day record; proposed_day record; proposed_group jsonb;
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
 -- Validate only changed group arrays. Historical five-person records stay intact.
 for proposed_day in select key,value from jsonb_each(p_data->'days') loop
  if proposed_day.value->'groups' is distinct from current_row.data->'days'->proposed_day.key->'groups' then
   if current_row.data->'days'->proposed_day.key is not null and clock_timestamp()>=(proposed_day.key||'T11:00:00+09:00')::timestamptz then
    raise exception using errcode='LN409',message='마감된 조는 변경할 수 없습니다.';
   end if;
   if jsonb_typeof(proposed_day.value->'groups') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
   for proposed_group in select value from jsonb_array_elements(proposed_day.value->'groups') loop
    if jsonb_typeof(proposed_group->'members') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
    if jsonb_array_length(proposed_group->'members') not between 1 and 5 then raise exception using errcode='LN400',message='일반 조는 최대 4명, 도시락만 조는 최대 5명입니다.';end if;
    if jsonb_array_length(proposed_group->'members')=5 and (proposed_group->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(proposed_group->'members') member where p_data->'choices'->proposed_day.key->(member->>'id')->>'meal' is distinct from 'lunchbox')) then raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
   end loop;
  end if;
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
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members')=5 and
 (g->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(g->'members') member where current_row.data->'choices'->p_date->(member->>'id')->>'meal' is distinct from 'lunchbox'))) then
 raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
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
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members')=5 and
 (g->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(g->'members') member where current_row.data->'choices'->p_date->(member->>'id')->>'meal' is distinct from 'lunchbox'))) then
 raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
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
revoke all on function public.ax_lunch_commit_state(text,integer,jsonb,text[],boolean),public.ax_lunch_admin_rematch(text,integer,text,jsonb),public.ax_lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;
create or replace function public.global_lunch_commit_state(
 p_token_hash text,p_expected_version integer,p_data jsonb,p_write_dates text[],p_cron boolean default false
) returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.global_lunch_state%rowtype; settings public.global_lunch_settings%rowtype; day_text text; closed_day record; proposed_day record; proposed_group jsonb;
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
 -- Validate only changed group arrays. Historical five-person records stay intact.
 for proposed_day in select key,value from jsonb_each(p_data->'days') loop
  if proposed_day.value->'groups' is distinct from current_row.data->'days'->proposed_day.key->'groups' then
   if current_row.data->'days'->proposed_day.key is not null and clock_timestamp()>=(proposed_day.key||'T11:00:00+09:00')::timestamptz then
    raise exception using errcode='LN409',message='마감된 조는 변경할 수 없습니다.';
   end if;
   if jsonb_typeof(proposed_day.value->'groups') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
   for proposed_group in select value from jsonb_array_elements(proposed_day.value->'groups') loop
    if jsonb_typeof(proposed_group->'members') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
    if jsonb_array_length(proposed_group->'members') not between 1 and 5 then raise exception using errcode='LN400',message='일반 조는 최대 4명, 도시락만 조는 최대 5명입니다.';end if;
    if jsonb_array_length(proposed_group->'members')=5 and (proposed_group->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(proposed_group->'members') member where p_data->'choices'->proposed_day.key->(member->>'id')->>'meal' is distinct from 'lunchbox')) then raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
   end loop;
  end if;
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
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members')=5 and
 (g->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(g->'members') member where current_row.data->'choices'->p_date->(member->>'id')->>'meal' is distinct from 'lunchbox'))) then
 raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
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
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members')=5 and
 (g->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(g->'members') member where current_row.data->'choices'->p_date->(member->>'id')->>'meal' is distinct from 'lunchbox'))) then
 raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
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
revoke all on function public.global_lunch_commit_state(text,integer,jsonb,text[],boolean),public.global_lunch_admin_rematch(text,integer,text,jsonb),public.global_lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;
create or replace function public.tmt_lunch_commit_state(
 p_token_hash text,p_expected_version integer,p_data jsonb,p_write_dates text[],p_cron boolean default false
) returns boolean language plpgsql security definer set search_path=public as $$
declare current_row public.tmt_lunch_state%rowtype; settings public.tmt_lunch_settings%rowtype; day_text text; closed_day record; proposed_day record; proposed_group jsonb;
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
 -- Validate only changed group arrays. Historical five-person records stay intact.
 for proposed_day in select key,value from jsonb_each(p_data->'days') loop
  if proposed_day.value->'groups' is distinct from current_row.data->'days'->proposed_day.key->'groups' then
   if current_row.data->'days'->proposed_day.key is not null and clock_timestamp()>=(proposed_day.key||'T11:00:00+09:00')::timestamptz then
    raise exception using errcode='LN409',message='마감된 조는 변경할 수 없습니다.';
   end if;
   if jsonb_typeof(proposed_day.value->'groups') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
   for proposed_group in select value from jsonb_array_elements(proposed_day.value->'groups') loop
    if jsonb_typeof(proposed_group->'members') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
    if jsonb_array_length(proposed_group->'members') not between 1 and 5 then raise exception using errcode='LN400',message='일반 조는 최대 4명, 도시락만 조는 최대 5명입니다.';end if;
    if jsonb_array_length(proposed_group->'members')=5 and (proposed_group->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(proposed_group->'members') member where p_data->'choices'->proposed_day.key->(member->>'id')->>'meal' is distinct from 'lunchbox')) then raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
   end loop;
  end if;
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
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members')=5 and
 (g->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(g->'members') member where current_row.data->'choices'->p_date->(member->>'id')->>'meal' is distinct from 'lunchbox'))) then
 raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
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
 if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members')=5 and
 (g->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(g->'members') member where current_row.data->'choices'->p_date->(member->>'id')->>'meal' is distinct from 'lunchbox'))) then
 raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
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
revoke all on function public.tmt_lunch_commit_state(text,integer,jsonb,text[],boolean),public.tmt_lunch_admin_rematch(text,integer,text,jsonb),public.tmt_lunch_admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
