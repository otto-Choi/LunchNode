from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
source=(root/'supabase/ax-schema.sql').read_text()
parts=["""begin;
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
create or replace function public.ax35_group_cleanup() returns boolean language plpgsql security definer set search_path=public as $$begin delete from public.ax35_group_sessions where expires_at<clock_timestamp();delete from public.ax35_group_auth_buckets where window_start<clock_timestamp()-interval '1 day';return true;end;$$;
create or replace function public.ax35_group_health() returns boolean language sql security definer set search_path=public as $$ select true; $$;
"""]
names=['identity','credentials','open_session','end_session','change_pin','rate_limit','require_session']
for name in names:
 fn=re.search(r'(?m)^create or replace function public.ax_lunch_'+name+r'\(.*?\n\$\$;',source,re.S).group(0).replace('ax_lunch_','ax35_group_')
 parts.append(fn)
for name,args in [('user_json','uuid'),('register','text,text,text'),('health',''),('cleanup',''),('identity','text'),('credentials','text'),('open_session','uuid,text,text'),('end_session','text'),('change_pin','text,text,text'),('rate_limit','text,integer'),('require_session','text')]:
 parts.append(f'revoke all on function public.ax35_group_{name}({args}) from public,anon,authenticated,service_role;')
 if name not in ['user_json','require_session']:
  parts.append(f'grant execute on function public.ax35_group_{name}({args}) to service_role;')
parts.append("""
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
""")
src=(root/'supabase/headquarters-administrators.sql').read_text()
a=src.index('create or replace function group_node_private.request');b=src.index('revoke all on function group_node_private.request',a)
request=src[a:b]
request=request.replace("moderator or item.visibility='all' or item.created_by_tenant=p_tenant",'moderator or group_node_private.visible(item.visibility,item.created_by_tenant,p_tenant)')
request=request.replace("not moderator and m.visibility='headquarters' and m.created_by_tenant<>p_tenant",'not moderator and not group_node_private.visible(m.visibility,m.created_by_tenant,p_tenant)')
request=request.replace("or item.created_by_tenant=p_tenant)","or group_node_private.headquarters(item.created_by_tenant)=group_node_private.headquarters(p_tenant))")
roster="""(select id,name,class_name,is_admin,'ax'::text as tenant from public.ax_lunch_roster
    union all select id,name,class_name,is_admin,'global' from public.global_lunch_roster
    union all select id,name,class_name,is_admin,'tmt' from public.tmt_lunch_roster) r"""
assert roster in request
request=request.replace(roster,'group_node_private.members() r').replace("(m.visibility='all' or r.tenant=m.created_by_tenant)",'group_node_private.visible(m.visibility,m.created_by_tenant,r.tenant)')
request=request.replace("'className',r.class_name) order by", "'className',r.class_name,'cohort',group_node_private.cohort(r.tenant)) order by")
old="""if p_payload->>'visibility'='headquarters' and m.visibility='all' and (
    exists(select 1 from public.group_node_participants where meetup_id=m.id and tenant<>m.created_by_tenant)
    or exists(select 1 from public.group_node_comments where meetup_id=m.id and tenant<>m.created_by_tenant)) then"""
new="""if p_payload->>'visibility' is distinct from m.visibility and (
    exists(select 1 from public.group_node_participants where meetup_id=m.id and not group_node_private.visible(p_payload->>'visibility',m.created_by_tenant,tenant))
    or exists(select 1 from public.group_node_comments where meetup_id=m.id and not group_node_private.visible(p_payload->>'visibility',m.created_by_tenant,tenant))) then"""
assert old in request;request=request.replace(old,new).replace('다른 본부의 참여나 댓글이 있어 모집 범위를 줄일 수 없습니다.','공개 범위 밖의 참여나 댓글이 있어 모집 범위를 줄일 수 없습니다.')
request=request.replace("m.visibility='headquarters' and p_payload->>'tenant' is distinct from m.created_by_tenant", "not group_node_private.visible(m.visibility,m.created_by_tenant,p_payload->>'tenant')").replace('우리 본부 인원만 추가할 수 있습니다.','모집 범위에 해당하는 인원만 추가할 수 있습니다.')
parts.append(request)
for name,args in [('cohort','text'),('headquarters','text'),('visible','text,text,text'),('members',''),('person','text,uuid'),('actor','text,text')]:
 parts.append(f'revoke all on function group_node_private.{name}({args}) from public,anon,authenticated,service_role;')
parts.append("revoke all on function group_node_private.request(text,text,text,jsonb) from public,anon,authenticated;\nnotify pgrst, 'reload schema';\ncommit;\n")
text='\n'.join(parts)
(root/'supabase/cohorts.sql').write_text(text)
for migration in (root/'supabase/migrations').glob('*_cohort_group_access.sql'):
 migration.write_text(text)
