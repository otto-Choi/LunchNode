begin;
alter table public.group_node_meetups drop constraint group_node_meetups_created_by_tenant_check;
alter table public.group_node_meetups add constraint group_node_meetups_created_by_tenant_check check(created_by_tenant in ('ax','global','tmt'));
alter table public.group_node_participants drop constraint group_node_participants_tenant_check;
alter table public.group_node_participants add constraint group_node_participants_tenant_check check(tenant in ('ax','global','tmt'));
alter table public.group_node_comments drop constraint group_node_comments_tenant_check;
alter table public.group_node_comments add constraint group_node_comments_tenant_check check(tenant in ('ax','global','tmt'));
create or replace function group_node_private.actor(p_tenant text,p_hash text) returns uuid
language plpgsql set search_path='' as $$
begin
 if p_tenant='ax' then return public.ax_lunch_require_session(p_hash);
 elsif p_tenant='global' then return public.global_lunch_require_session(p_hash);
 elsif p_tenant='tmt' then return public.tmt_lunch_require_session(p_hash);
 else raise exception using errcode='LN401',message='로그인이 필요합니다.';end if;
end $$;
create or replace function group_node_private.person(p_tenant text,p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',p_id,'tenant',p_tenant,'name',r.name,'className',r.class_name)
 from (select id,name,class_name,'ax' as tenant from public.ax_lunch_roster
 union all select id,name,class_name,'global' from public.global_lunch_roster
 union all select id,name,class_name,'tmt' from public.tmt_lunch_roster) r
 where r.id=p_id and r.tenant=p_tenant;
$$;

revoke all on function group_node_private.actor(text,text),group_node_private.person(text,uuid) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
