from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
parts=["""begin;
create schema if not exists lunch_admin_private;
revoke all on schema lunch_admin_private from public,anon,authenticated,service_role;
create table if not exists lunch_admin_private.events(
 id bigint generated always as identity primary key,
 tenant text not null,actor_id uuid not null,entity_id uuid,action text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table lunch_admin_private.events enable row level security;
revoke all on lunch_admin_private.events from public,anon,authenticated,service_role;
create or replace function lunch_admin_private.is_admin(p_tenant text,p_id uuid)
returns boolean language plpgsql stable set search_path='' as $$
declare answer boolean;
begin
 if p_tenant not in ('ax','global','tmt') then return false;end if;
 execute format('select is_admin from public.%I where id=$1',p_tenant||'_lunch_roster') into answer using p_id;
 return coalesce(answer,false);
end $$;
revoke all on function lunch_admin_private.is_admin(text,uuid) from public,anon,authenticated,service_role;
"""]
continuous=(root/'supabase/continuous-operation.sql').read_text()
for tenant in ['ax','global','tmt']:
 prefix=tenant+'_lunch_'
 parts.append(f"""alter table public.{prefix}roster add column if not exists is_admin boolean not null default false;
do $guard$ declare expression text;begin
 if not exists(select 1 from public.{prefix}roster where is_admin) then
  select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='public.{prefix}roster'::regclass and conname='{prefix}roster_allowed';
  if expression is null then raise exception 'Missing canonical roster constraint';end if;
  alter table public.{prefix}roster drop constraint {prefix}roster_allowed;
  execute 'alter table public.{prefix}roster add constraint {prefix}roster_allowed check (('||expression||') or (name=''관리자'' and class_name=''운영자'' and default_status=''absent''))';
 end if;
end $guard$;
-- Older Global installers have additional affiliation/default checks. Preserve
-- their original restrictions for employees while allowing the reserved admin row.
do $checks$ declare item record;expression text;begin
 for item in select conname,pg_get_expr(conbin,conrelid) as body from pg_constraint
 where conrelid='public.{prefix}roster'::regclass and contype='c'
 and conname in ('{prefix}roster_class_name_check','{prefix}roster_default_status_check') loop
  if strpos(item.body,'is_admin')=0 then
   execute format('alter table public.{prefix}roster drop constraint %I',item.conname);
   execute format('alter table public.{prefix}roster add constraint %I check (is_admin or (%s))',item.conname,item.body);
  end if;
 end loop;
end $checks$;
alter table public.{prefix}roster drop constraint if exists {prefix}roster_role_check;
alter table public.{prefix}roster add constraint {prefix}roster_role_check check((name='관리자')=is_admin);
insert into public.{prefix}roster(id,name,class_name,default_status,is_admin)
 values(gen_random_uuid(),'관리자','운영자','absent',true) on conflict(name) do nothing;
-- Disabled until a server-generated salted PIN hash is provisioned. No plaintext PIN in source.
insert into public.{prefix}users(id,name,class_name,pin_hash)
 select id,name,class_name,'!uninitialized!' from public.{prefix}roster where is_admin on conflict(name) do nothing;
""")
 source=(root/'supabase'/f'{tenant}-schema.sql').read_text()
 def function(text,name):
  matches=re.findall(r'(?m)^create or replace function public\.'+prefix+name+r'\(.*?\n\$\$;',text,re.S)
  assert len(matches)==1,(tenant,name,len(matches))
  return matches[0]
 user=function(source,'user_json').replace("'defaultStatus',default_status)","'defaultStatus',default_status,'isAdmin',is_admin)")
 register=function(source,'register').replace(' if p_pin_hash !~'," if person.is_admin then raise exception using errcode='LN403',message='관리자 계정은 직접 등록할 수 없습니다.';end if;\n if p_pin_hash !~",1)
 health=function(source,'health').replace(f'from public.{prefix}roster)',f'from public.{prefix}roster where not is_admin)')
 snapshot=function(continuous,'snapshot').replace(f'from public.{prefix}roster r)',f'from public.{prefix}roster r where not r.is_admin)')
 commit=function(continuous,'commit_state').replace(' if current_row.version<>', f" if not p_cron and exists(select 1 from public.{prefix}roster where id=public.{prefix}require_session(p_token_hash) and is_admin) and cardinality(p_write_dates)>0 then raise exception using errcode='LN403',message='관리자 계정은 점심 신청 대상이 아닙니다.';end if;\n if current_row.version<>",1)
 info=function(source,'tenant_info').replace("'capabilities',3)","'capabilities',3,'adminAccountsRevision',1)")
 if tenant=='global':
  # Keep the deployed Global roster-correction rollout marker.
  info=info.replace("'capabilities',3,", "'globalRosterRevision',1,'capabilities',3,")
 status=function(source,'system_status').replace(f'(select count(*) from public.{prefix}users)', f'(select count(*) from public.{prefix}users u join public.{prefix}roster r on r.id=u.id where not r.is_admin)').replace(f'(select count(*) from public.{prefix}roster)', f'(select count(*) from public.{prefix}roster where not is_admin)')
 parts.extend([user,register,health,snapshot,commit,info,status])
 parts.append(f"revoke all on function public.{prefix}user_json(uuid) from public,anon,authenticated,service_role;")
# Extend the existing authenticated Group Node entry point. All administrator checks
# derive from the database roster AFTER verifying the caller's live HQ-bound session.
source=(root/'supabase/persistent-clubs.sql').read_text()
a=source.index('create or replace function group_node_private.request')
b=source.index('revoke all on function group_node_private.render',a)
request=source[a:b]
request=request.replace('is_past boolean; owner boolean;', 'is_past boolean; owner boolean; moderator boolean; old_comment text;')
request=request.replace(' actor_id:=group_node_private.actor(p_tenant,p_token_hash);', " actor_id:=group_node_private.actor(p_tenant,p_token_hash);\n moderator:=lunch_admin_private.is_admin(p_tenant,actor_id);")
request=request.replace("(item.visibility='all' or item.created_by_tenant=p_tenant)", "(moderator or item.visibility='all' or item.created_by_tenant=p_tenant)")
request=request.replace("(m.visibility='headquarters' and m.created_by_tenant<>p_tenant)", "(not moderator and m.visibility='headquarters' and m.created_by_tenant<>p_tenant)")
request=request.replace('owner:=m.created_by=actor_id and m.created_by_tenant=p_tenant;', 'owner:=moderator or (m.created_by=actor_id and m.created_by_tenant=p_tenant);')
request=request.replace("  insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_tenant,actor_id);", "  if not moderator then insert into public.group_node_participants(meetup_id,tenant,user_id) values(m.id,p_tenant,actor_id);end if;")
request=request.replace(" if p_action in ('join','leave','vote','unvote') and", " if moderator and p_action in ('join','leave','vote','unvote') then raise exception using errcode='LN403',message='관리자 계정은 참여자 관리 기능을 이용해 주세요.';end if;\n if p_action in ('join','leave','vote','unvote') and")
request=request.replace("where (m.visibility='all' or r.tenant=m.created_by_tenant)","where not r.is_admin and (m.visibility='all' or r.tenant=m.created_by_tenant)")
request=request.replace("select id,name,class_name,'ax'::text", "select id,name,class_name,is_admin,'ax'::text").replace("select id,name,class_name,'global'", "select id,name,class_name,is_admin,'global'").replace("select id,name,class_name,'tmt'", "select id,name,class_name,is_admin,'tmt'")
request=request.replace('and tenant<>p_tenant)', 'and tenant<>m.created_by_tenant)')
request=request.replace("  if m.visibility='headquarters' and p_payload", "  if lunch_admin_private.is_admin(p_payload->>'tenant',(p_payload->>'userId')::uuid) then raise exception using errcode='LN400',message='관리자 계정은 참여자로 추가할 수 없습니다.';end if;\n  if m.visibility='headquarters' and p_payload")
request=request.replace('and tenant=p_tenant and user_id=actor_id;\n  if not found', 'and (moderator or (tenant=p_tenant and user_id=actor_id));\n  if not found')
needle=" elsif p_action='delete_comment' then"
replacement=""" elsif p_action='edit_comment' then
  select body into old_comment from public.group_node_comments where id=(p_payload->>'commentId')::uuid and meetup_id=m.id and (moderator or (tenant=p_tenant and user_id=actor_id)) for update;
  if not found then raise exception using errcode='LN403',message='댓글을 수정할 권한이 없습니다.';end if;
  if old_comment is distinct from p_payload->>'expectedBody' then raise exception using errcode='LN409',message='댓글이 변경되었습니다. 다시 불러와 주세요.';end if;
  update public.group_node_comments set body=btrim(p_payload->>'body') where id=(p_payload->>'commentId')::uuid and meetup_id=m.id;
 elsif p_action='delete_comment' then"""
assert needle in request
request=request.replace(needle,replacement)
request=request.replace(" if p_action='participant_roster' then", " if moderator and p_action in ('update','delete','confirm','reopen','cancel','convert_to_club','add_participant','edit_comment','delete_comment') then insert into lunch_admin_private.events(tenant,actor_id,entity_id,action) values(p_tenant,actor_id,m.id,p_action);end if;\n if p_action='participant_roster' then",1)
parts.append(request)
parts.append("revoke all on function group_node_private.request(text,text,text,jsonb) from public,anon,authenticated;\nnotify pgrst, 'reload schema';\ncommit;\n")
text='\n'.join(parts)
(root/'supabase/headquarters-administrators.sql').write_text(text)
for migration in (root/'supabase/migrations').glob('*_headquarters_administrators.sql'):
 migration.write_text(text)
