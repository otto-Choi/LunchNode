-- Existing rows remain one-off meetups; no participant, vote or comment is removed.
begin;
alter table public.group_node_meetups add column if not exists kind text not null default 'one_off' check(kind in ('one_off','club'));
create index if not exists group_node_meetups_kind_created on public.group_node_meetups(kind,created_at desc,id);
create or replace function group_node_private.render(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',m.id,'title',m.title,'description',m.description,'category',m.category,
 'kind',m.kind,'minPeople',m.min_people,'visibility',m.visibility,'proposer',group_node_private.person(m.created_by_tenant,m.created_by),
 'status',m.status,'confirmedDateId',m.confirmed_date_id,'version',m.version,'createdAt',m.created_at,
 'participants',coalesce((select jsonb_agg(group_node_private.person(p.tenant,p.user_id) order by p.created_at,p.tenant,p.user_id) from public.group_node_participants p where p.meetup_id=m.id),'[]'::jsonb),
 'dates',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'date',d.date,'time',to_char(d.time,'HH24:MI'),
 'voters',coalesce((select jsonb_agg(group_node_private.person(v.tenant,v.user_id) order by v.tenant,v.user_id) from public.group_node_votes v where v.date_id=d.id),'[]'::jsonb)) order by d.date,d.time nulls first,d.id)
 from public.group_node_dates d where d.meetup_id=m.id),'[]'::jsonb)) from public.group_node_meetups m where m.id=p_id;
$$;


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
  insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_tenant,actor_id);
 else
  select * into m from public.group_node_meetups where id=(p_payload->>'id')::uuid for update;
  if not found or (m.visibility='headquarters' and m.created_by_tenant<>p_tenant) then raise exception using errcode='LN404',message='모임을 찾을 수 없습니다.';end if;
  -- Recheck after a lock wait, including a concurrent operator session revocation.
  if group_node_private.actor(p_tenant,p_token_hash) is distinct from actor_id then raise exception using errcode='LN401',message='로그인이 필요합니다.';end if;
 end if;
 owner:=m.created_by=actor_id and m.created_by_tenant=p_tenant;
 if p_action in ('update','delete','confirm','reopen','cancel','convert_to_club','add_participant','participant_roster') then
  if not owner then raise exception using errcode='LN403',message='모임장만 실행할 수 있습니다.';end if;
  if p_action<>'participant_roster' and m.version is distinct from (p_payload->>'version')::int then raise exception using errcode='LN409',message='모임이 변경되었습니다. 다시 불러온 후 시도해 주세요.';end if;
 end if;
 select m.status='cancelled' or (m.kind='one_off' and coalesce(max(date) filter(where id=m.confirmed_date_id),max(date))<today) into is_past from public.group_node_dates where meetup_id=m.id;
 if p_action in ('join','leave','vote','unvote') and coalesce(is_past,false) then raise exception using errcode='LN409',message='종료되거나 취소된 모임입니다.';end if;
 if p_action='participant_roster' then
  if m.kind<>'club' then raise exception using errcode='LN400',message='소모임에서만 참여자를 추가할 수 있습니다.';end if;
  return jsonb_build_object('people',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'tenant',r.tenant,'name',r.name,'className',r.class_name) order by r.tenant,r.class_name,r.name)
   from (select id,name,class_name,'ax'::text as tenant from public.ax_lunch_roster
    union all select id,name,class_name,'global' from public.global_lunch_roster
    union all select id,name,class_name,'tmt' from public.tmt_lunch_roster) r
   where (m.visibility='all' or r.tenant=m.created_by_tenant)
    and not exists(select 1 from public.group_node_participants p where p.meetup_id=m.id and p.tenant=r.tenant and p.user_id=r.id)),'[]'::jsonb));
 end if;
 if p_action in ('create','update') then
  if coalesce(p_payload->>'kind',m.kind)='one_off' and jsonb_array_length(p_payload->'dates')=0 then raise exception using errcode='LN400',message='1회성 모임은 후보 날짜가 필요합니다.';end if;
  if p_action='update' then
   if p_payload->>'visibility'='headquarters' and m.visibility='all' and (
    exists(select 1 from public.group_node_participants where meetup_id=m.id and tenant<>p_tenant)
    or exists(select 1 from public.group_node_comments where meetup_id=m.id and tenant<>p_tenant)) then
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



revoke all on function group_node_private.render(uuid) from public,anon,authenticated,service_role;
revoke all on function group_node_private.request(text,text,text,jsonb) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
