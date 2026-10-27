from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
base=(root/'supabase/migrations/20261026124241_group_node.sql').read_text()
render=base[base.index('create function group_node_private.render'):base.index('-- The only privileged entry point')]
render=render.replace('create function','create or replace function',1).replace("'minPeople',m.min_people", "'kind',m.kind,'minPeople',m.min_people")
source=(root/'supabase/continuous-operation.sql').read_text()
a=source.index('create or replace function group_node_private.request')
b=source.index('revoke all on function group_node_private.request',a)
request=source[a:b]
request=request.replace("item.status='cancelled' or (select coalesce(max(date) filter(where id=item.confirmed_date_id),max(date)) from public.group_node_dates where meetup_id=item.id)<today", "item.status='cancelled' or (item.kind='one_off' and (select coalesce(max(date) filter(where id=item.confirmed_date_id),max(date)) from public.group_node_dates where meetup_id=item.id)<today)")
request=request.replace("else item.status<>'cancelled' and (select coalesce(max(date) filter(where id=item.confirmed_date_id),max(date)) from public.group_node_dates where meetup_id=item.id)>=today end)","else item.status<>'cancelled' and (item.kind='club' or (select coalesce(max(date) filter(where id=item.confirmed_date_id),max(date)) from public.group_node_dates where meetup_id=item.id)>=today) end)\n   and (coalesce(p_payload->>'view','browse')<>'clubs' or item.kind='club')")
request=request.replace("jsonb_array_length(p_payload->'dates') not between 1 and 5", "jsonb_array_length(p_payload->'dates') not between 0 and 5")
request=request.replace('候補','후보').replace("message='후보 날짜는 1~5개입니다.'","message='후보 날짜는 최대 5개입니다.'")
request=request.replace('visibility,created_by_tenant,created_by)','visibility,created_by_tenant,created_by,kind)')
request=request.replace("p_payload->>'visibility',p_tenant,actor_id) returning", "p_payload->>'visibility',p_tenant,actor_id,coalesce(p_payload->>'kind','one_off')) returning")
request=request.replace("('update','delete','confirm','reopen','cancel')", "('update','delete','confirm','reopen','cancel','convert_to_club','add_participant','participant_roster')")
# Only mutations use optimistic version checks. Reading an owner-only roster doesn't mutate.
request=request.replace("if m.version is distinct from (p_payload->>'version')::int then", "if p_action<>'participant_roster' and m.version is distinct from (p_payload->>'version')::int then")
request=request.replace("select m.status='cancelled' or coalesce(max(date) filter(where id=m.confirmed_date_id),max(date))<today", "select m.status='cancelled' or (m.kind='one_off' and coalesce(max(date) filter(where id=m.confirmed_date_id),max(date))<today)")
needle=" if p_action in ('create','update') then\n  if p_action='update' then"
replacement=""" if p_action='participant_roster' then
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
  if p_action='update' then"""
assert needle in request
request=request.replace(needle,replacement)
request=request.replace("min_people=(p_payload->>'minPeople')::int,visibility=", "kind=coalesce(p_payload->>'kind',m.kind),min_people=(p_payload->>'minPeople')::int,visibility=")
needle=" elsif p_action='delete' then"
replacement=""" elsif p_action='convert_to_club' then
  update public.group_node_meetups set kind='club',version=version+1 where id=m.id and kind<>'club';
 elsif p_action='add_participant' then
  if m.kind<>'club' then raise exception using errcode='LN400',message='소모임에서만 참여자를 추가할 수 있습니다.';end if;
  if m.status='cancelled' then raise exception using errcode='LN409',message='취소된 소모임입니다.';end if;
  if group_node_private.person(p_payload->>'tenant',(p_payload->>'userId')::uuid) is null then raise exception using errcode='LN400',message='본부 명단에 등록된 참여자를 선택해 주세요.';end if;
  if m.visibility='headquarters' and p_payload->>'tenant' is distinct from m.created_by_tenant then raise exception using errcode='LN403',message='우리 본부 인원만 추가할 수 있습니다.';end if;
  insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_payload->>'tenant',(p_payload->>'userId')::uuid) on conflict do nothing;
  get diagnostics total=row_count;
  if total>0 then update public.group_node_meetups set version=version+1 where id=m.id;end if;
 elsif p_action='delete' then"""
assert needle in request
request=request.replace(needle,replacement)
needle="  if p_action='vote' then insert"
replacement="""  if m.kind='club' and exists(select 1 from public.group_node_dates where id=(p_payload->>'dateId')::uuid and date<today) then raise exception using errcode='LN409',message='지난 일정의 투표는 변경할 수 없습니다.';end if;
  if p_action='vote' then insert"""
assert needle in request
request=request.replace(needle,replacement)
text="""-- Existing rows remain one-off meetups; no participant, vote or comment is removed.
begin;
alter table public.group_node_meetups add column if not exists kind text not null default 'one_off' check(kind in ('one_off','club'));
create index if not exists group_node_meetups_kind_created on public.group_node_meetups(kind,created_at desc,id);
"""+render+'\n'+request+"""
revoke all on function group_node_private.render(uuid) from public,anon,authenticated,service_role;
revoke all on function group_node_private.request(text,text,text,jsonb) from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
"""
(root/'supabase/persistent-clubs.sql').write_text(text)
for migration in (root/'supabase/migrations').glob('*_persistent_clubs.sql'):
 migration.write_text(text)
