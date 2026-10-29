begin;
create table if not exists public.ax35_group_users(
 id uuid primary key default gen_random_uuid(),name text not null unique,
 class_name text not null default '35사번' check(class_name='35사번'),pin_hash text not null,
 created_at timestamptz not null default now(),
 check(char_length(btrim(name)) between 2 and 40 and name not in ('관리자','운영자'))
);
create table if not exists public.ax35_group_sessions(
 token_hash text primary key,user_id uuid not null references public.ax35_group_users(id) on delete cascade,expires_at timestamptz not null
);
create index if not exists ax35_group_sessions_user on public.ax35_group_sessions(user_id);
create index if not exists ax35_group_sessions_expiry on public.ax35_group_sessions(expires_at);
create table if not exists public.ax35_group_auth_buckets(key text primary key,attempts integer not null,window_start timestamptz not null);
alter table public.ax35_group_users enable row level security;
alter table public.ax35_group_sessions enable row level security;
alter table public.ax35_group_auth_buckets enable row level security;
revoke all on public.ax35_group_users,public.ax35_group_sessions,public.ax35_group_auth_buckets from public,anon,authenticated,service_role;
create or replace function public.ax35_group_user_json(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'name',name,'className',class_name,'defaultStatus','unset','cohort','35','isAdmin',false) from public.ax35_group_users where id=p_id;
$$;
create or replace function public.ax35_group_register(p_name text,p_pin_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
 if p_name is null or p_name<>btrim(p_name) or char_length(p_name) not between 2 and 40 or p_name in ('관리자','운영자') then raise exception using errcode='LN400',message='이름을 확인해 주세요.';end if;
 if p_pin_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid credential format';end if;
 begin insert into public.ax35_group_users(name,pin_hash) values(p_name,p_pin_hash) returning id into uid;
 exception when unique_violation then raise exception using errcode='LN409',message='이미 등록된 이름입니다. 로그인해 주세요.';end;
 insert into public.ax35_group_sessions values(p_token_hash,uid,clock_timestamp()+interval '21 days');
 return public.ax35_group_user_json(uid);
end;
$$;
create or replace function public.ax35_group_health() returns boolean language sql security definer set search_path=public as $$ select true; $$;

create or replace function public.ax35_group_identity(p_token_hash text)
returns jsonb language sql stable security definer set search_path=public as $$
 select public.ax35_group_user_json(user_id) from public.ax35_group_sessions
 where token_hash=p_token_hash and expires_at>now();
$$;
create or replace function public.ax35_group_credentials(p_name text)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',id,'pin_hash',pin_hash,'user',public.ax35_group_user_json(id))
 from public.ax35_group_users where name=p_name;
$$;
create or replace function public.ax35_group_open_session(p_user_id uuid,p_expected_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare stored text;
begin
 select pin_hash into stored from public.ax35_group_users where id=p_user_id for update;
 if stored is null or stored<>p_expected_hash then raise exception using errcode='LN401',message='PIN이 변경되었습니다. 다시 로그인해 주세요.'; end if;
 if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token format'; end if;
 insert into public.ax35_group_sessions(token_hash,user_id,expires_at) values(p_token_hash,p_user_id,clock_timestamp()+interval '21 days');
 return public.ax35_group_user_json(p_user_id);
end;
$$;
create or replace function public.ax35_group_end_session(p_token_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 delete from public.ax35_group_sessions where token_hash=p_token_hash;
 return true;
end;
$$;
create or replace function public.ax35_group_change_pin(p_token_hash text,p_expected_hash text,p_new_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; stored text;
begin
 select user_id into uid from public.ax35_group_sessions where token_hash=p_token_hash;
 select pin_hash into stored from public.ax35_group_users where id=uid for update;
 perform public.ax35_group_require_session(p_token_hash);
 if stored is null or stored<>p_expected_hash then raise exception using errcode='LN401',message='현재 PIN을 다시 확인해 주세요.'; end if;
 if p_new_hash !~ '^[a-f0-9]{32}:[a-f0-9]{128}$' then raise exception 'Invalid PIN hash'; end if;
 update public.ax35_group_users set pin_hash=p_new_hash where id=uid;
 delete from public.ax35_group_sessions where user_id=uid;
 return true;
end;
$$;
create or replace function public.ax35_group_rate_limit(p_key text,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_attempts integer;
begin
 if p_limit<1 or p_limit>200 then raise exception 'Invalid rate limit'; end if;
 insert into public.ax35_group_auth_buckets(key,attempts,window_start) values(p_key,1,clock_timestamp())
 on conflict(key) do update set
 attempts=case when ax35_group_auth_buckets.window_start<clock_timestamp()-interval '15 minutes' then 1 else least(ax35_group_auth_buckets.attempts+1,1000000) end,
 window_start=case when ax35_group_auth_buckets.window_start<clock_timestamp()-interval '15 minutes' then clock_timestamp() else ax35_group_auth_buckets.window_start end
 returning attempts into current_attempts;
 return current_attempts<=p_limit;
end;
$$;
create or replace function public.ax35_group_require_session(p_token_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
 select user_id into uid from public.ax35_group_sessions where token_hash=p_token_hash;
 if uid is null then raise exception using errcode='LN401',message='로그인이 필요합니다.'; end if;
 -- All credential/session mutations lock account first, then session.
 perform 1 from public.ax35_group_users where id=uid for share;
 perform 1 from public.ax35_group_sessions where token_hash=p_token_hash and expires_at>clock_timestamp() for share;
 if not found then raise exception using errcode='LN401',message='로그인이 필요합니다.'; end if;
 return uid;
end;
$$;
revoke all on function public.ax35_group_user_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.ax35_group_register(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ax35_group_register(text,text,text) to service_role;
revoke all on function public.ax35_group_health() from public,anon,authenticated,service_role;
grant execute on function public.ax35_group_health() to service_role;
revoke all on function public.ax35_group_identity(text) from public,anon,authenticated,service_role;
grant execute on function public.ax35_group_identity(text) to service_role;
revoke all on function public.ax35_group_credentials(text) from public,anon,authenticated,service_role;
grant execute on function public.ax35_group_credentials(text) to service_role;
revoke all on function public.ax35_group_open_session(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ax35_group_open_session(uuid,text,text) to service_role;
revoke all on function public.ax35_group_end_session(text) from public,anon,authenticated,service_role;
grant execute on function public.ax35_group_end_session(text) to service_role;
revoke all on function public.ax35_group_change_pin(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ax35_group_change_pin(text,text,text) to service_role;
revoke all on function public.ax35_group_rate_limit(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.ax35_group_rate_limit(text,integer) to service_role;
revoke all on function public.ax35_group_require_session(text) from public,anon,authenticated,service_role;

alter table public.group_node_meetups drop constraint if exists group_node_meetups_visibility_check;
alter table public.group_node_meetups add constraint group_node_meetups_visibility_check check(visibility in ('all','cohort','headquarters'));
alter table public.group_node_meetups drop constraint if exists group_node_meetups_created_by_tenant_check;
alter table public.group_node_meetups add constraint group_node_meetups_created_by_tenant_check check(created_by_tenant in ('ax','global','tmt','ax35'));
alter table public.group_node_participants drop constraint if exists group_node_participants_tenant_check;
alter table public.group_node_participants add constraint group_node_participants_tenant_check check(tenant in ('ax','global','tmt','ax35'));
alter table public.group_node_comments drop constraint if exists group_node_comments_tenant_check;
alter table public.group_node_comments add constraint group_node_comments_tenant_check check(tenant in ('ax','global','tmt','ax35'));
create or replace function group_node_private.cohort(p_tenant text) returns text language sql immutable set search_path='' as $$select case when p_tenant='ax35' then '35' else '36' end;$$;
create or replace function group_node_private.headquarters(p_tenant text) returns text language sql immutable set search_path='' as $$select case when p_tenant='ax35' then 'ax' else p_tenant end;$$;
create or replace function group_node_private.visible(p_visibility text,p_owner_tenant text,p_viewer_tenant text) returns boolean language sql immutable set search_path='' as $$
 select p_visibility='all' or (p_visibility='cohort' and group_node_private.cohort(p_owner_tenant)=group_node_private.cohort(p_viewer_tenant)) or (p_visibility='headquarters' and p_owner_tenant=p_viewer_tenant);
$$;
create or replace function group_node_private.members() returns table(id uuid,name text,class_name text,is_admin boolean,tenant text) language sql stable set search_path='' as $$
 select id,name,class_name,is_admin,'ax' from public.ax_lunch_roster
 union all select id,name,class_name,is_admin,'global' from public.global_lunch_roster
 union all select id,name,class_name,is_admin,'tmt' from public.tmt_lunch_roster
 union all select id,name,class_name,false,'ax35' from public.ax35_group_users;
$$;
create or replace function group_node_private.person(p_tenant text,p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'tenant',r.tenant,'name',r.name,'className',r.class_name,'cohort',group_node_private.cohort(r.tenant)) from group_node_private.members() r where r.id=p_id and r.tenant=p_tenant;
$$;
create or replace function group_node_private.actor(p_tenant text,p_hash text) returns uuid language plpgsql set search_path='' as $$
begin
 if p_tenant='ax' then return public.ax_lunch_require_session(p_hash);
 elsif p_tenant='global' then return public.global_lunch_require_session(p_hash);
 elsif p_tenant='tmt' then return public.tmt_lunch_require_session(p_hash);
 elsif p_tenant='ax35' then return public.ax35_group_require_session(p_hash);
 else raise exception using errcode='LN401',message='로그인이 필요합니다.';end if;
end $$;

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
   where (moderator or group_node_private.visible(item.visibility,item.created_by_tenant,p_tenant))
   and (coalesce(p_payload->>'category','')='' or item.category=p_payload->>'category')
   and (coalesce(p_payload->>'q','')='' or item.title ilike '%'||(p_payload->>'q')||'%')
   and (not coalesce((p_payload->>'onlyHeadquarters')::boolean,false) or group_node_private.headquarters(item.created_by_tenant)=group_node_private.headquarters(p_tenant))
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
  if not found or (not moderator and not group_node_private.visible(m.visibility,m.created_by_tenant,p_tenant)) then raise exception using errcode='LN404',message='모임을 찾을 수 없습니다.';end if;
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
  return jsonb_build_object('people',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'tenant',r.tenant,'name',r.name,'className',r.class_name,'cohort',group_node_private.cohort(r.tenant)) order by r.tenant,r.class_name,r.name)
   from group_node_private.members() r
   where not r.is_admin and group_node_private.visible(m.visibility,m.created_by_tenant,r.tenant)
    and not exists(select 1 from public.group_node_participants p where p.meetup_id=m.id and p.tenant=r.tenant and p.user_id=r.id)),'[]'::jsonb));
 end if;
 if p_action in ('create','update') then
  if coalesce(p_payload->>'kind',m.kind)='one_off' and jsonb_array_length(p_payload->'dates')=0 then raise exception using errcode='LN400',message='1회성 모임은 후보 날짜가 필요합니다.';end if;
  if p_action='update' then
   if p_payload->>'visibility' is distinct from m.visibility and (
    exists(select 1 from public.group_node_participants where meetup_id=m.id and not group_node_private.visible(p_payload->>'visibility',m.created_by_tenant,tenant))
    or exists(select 1 from public.group_node_comments where meetup_id=m.id and not group_node_private.visible(p_payload->>'visibility',m.created_by_tenant,tenant))) then
    raise exception using errcode='LN409',message='공개 범위 밖의 참여나 댓글이 있어 모집 범위를 줄일 수 없습니다.';
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
  if not group_node_private.visible(m.visibility,m.created_by_tenant,p_payload->>'tenant') then raise exception using errcode='LN403',message='모집 범위에 해당하는 인원만 추가할 수 있습니다.';end if;
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





revoke all on function group_node_private.cohort(text) from public,anon,authenticated,service_role;
revoke all on function group_node_private.headquarters(text) from public,anon,authenticated,service_role;
revoke all on function group_node_private.visible(text,text,text) from public,anon,authenticated,service_role;
revoke all on function group_node_private.members() from public,anon,authenticated,service_role;
revoke all on function group_node_private.person(text,uuid) from public,anon,authenticated,service_role;
revoke all on function group_node_private.actor(text,text) from public,anon,authenticated,service_role;
revoke all on function group_node_private.request(text,text,text,jsonb) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
