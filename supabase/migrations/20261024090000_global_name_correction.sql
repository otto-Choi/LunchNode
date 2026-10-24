-- Global roster spelling correction. Preserve IDs, PINs, sessions and choices.
-- Safe to rerun; no-op when Global has not been installed yet.
begin;
set local lock_timeout = '15s';
do $correction$
declare
 person_id uuid; fk record; definition text; saved_fks jsonb='[]'::jsonb;
 current_data jsonb; corrected_data jsonb; member record;
begin
 if to_regclass('public.global_lunch_roster') is null then return; end if;
 perform pg_advisory_xact_lock(610230901);
 lock table public.global_lunch_state,public.global_lunch_users,public.global_lunch_roster in access exclusive mode;
 if exists(select 1 from public.global_lunch_roster where name='이윤서')
 and exists(select 1 from public.global_lunch_roster where name='이은서') then
  raise exception 'Both spellings exist. No changes made; review identities first.';
 end if;
 select id into person_id from public.global_lunch_roster where name in ('이윤서','이은서') and class_name='IOA';
 if person_id is null then raise exception 'Expected Global IOA participant was not found. No changes made.'; end if;
 select pg_get_constraintdef(oid) into definition from pg_constraint
 where conrelid='public.global_lunch_roster'::regclass and conname='global_lunch_roster_allowed';
 if definition is null then raise exception 'Global roster constraint was not found. No changes made.'; end if;
 if strpos(definition,'이윤서')>0 then
  alter table public.global_lunch_roster drop constraint global_lunch_roster_allowed;
 end if;
 -- The name FK is not ON UPDATE CASCADE. Restore every name FK in this transaction.
 for fk in select c.conname,pg_get_constraintdef(c.oid) as body from pg_constraint c
 where c.conrelid='public.global_lunch_users'::regclass and c.confrelid='public.global_lunch_roster'::regclass
 and c.contype='f' and c.conkey=array[(select attnum from pg_attribute where attrelid='public.global_lunch_users'::regclass and attname='name')]::smallint[]
 loop
  saved_fks:=saved_fks||jsonb_build_array(jsonb_build_object('name',fk.conname,'body',fk.body));
  execute format('alter table public.global_lunch_users drop constraint %I',fk.conname);
 end loop;
 update public.global_lunch_roster set name='이은서' where id=person_id and name='이윤서';
 update public.global_lunch_users set name='이은서' where id=person_id and name='이윤서';
 if strpos(definition,'이윤서')>0 then
   execute 'alter table public.global_lunch_roster add constraint global_lunch_roster_allowed '||replace(definition,'이윤서','이은서');
 end if;
 for fk in select value->>'name' as name,value->>'body' as body from jsonb_array_elements(saved_fks) loop
  execute format('alter table public.global_lunch_users add constraint %I %s',fk.name,fk.body);
 end loop;
 -- Correct the same person's display name in provisional and final group snapshots.
 select data into current_data from public.global_lunch_state where id=1;
 corrected_data:=current_data;
 for member in
  select d.key as day,(g.ordinality-1)::text as group_index,(m.ordinality-1)::text as member_index
  from jsonb_each(coalesce(current_data->'days','{}'::jsonb)) d
  cross join lateral jsonb_array_elements(coalesce(d.value->'groups','[]'::jsonb)) with ordinality g(value,ordinality)
  cross join lateral jsonb_array_elements(coalesce(g.value->'members','[]'::jsonb)) with ordinality m(value,ordinality)
  where m.value->>'id'=person_id::text and m.value->>'name'='이윤서'
 loop
  corrected_data:=jsonb_set(corrected_data,array['days',member.day,'groups',member.group_index,'members',member.member_index,'name'],to_jsonb('이은서'::text),false);
 end loop;
 if corrected_data is distinct from current_data then
  update public.global_lunch_state set data=corrected_data,version=version+1 where id=1;
 end if;
 -- The application uses this revision to stay compatible before this SQL is applied.
 execute $ddl$create or replace function public.global_lunch_tenant_info()
 returns jsonb language sql stable security definer set search_path=public as $body$
 select jsonb_build_object('tenant',tenant_key,'startDate',start_date,'endDate',end_date,'capabilities',3,'globalRosterRevision',1)
 from public.global_lunch_settings where id=1;
 $body$;$ddl$;
 revoke all on function public.global_lunch_tenant_info() from public,anon,authenticated;
 grant execute on function public.global_lunch_tenant_info() to service_role;
end $correction$;
notify pgrst,'reload schema';
commit;
