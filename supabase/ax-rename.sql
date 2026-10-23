-- Included by upgrade-shared-db.sql inside its transaction; not a standalone installer.
-- Metadata renames preserve table OIDs, account UUIDs, PIN hashes, sessions and JSON state.
select pg_advisory_xact_lock(610230903);
do $rename$
declare item record; name text;
begin
 if to_regclass('public.lunch_users') is not null and to_regclass('public.ax_lunch_users') is not null then
  raise exception 'Both legacy and AX-prefixed user tables exist. Stop and review; no automatic merge.';
 end if;
 if to_regclass('public.lunch_users') is null and to_regclass('public.ax_lunch_users') is null then
  raise exception 'Existing AX Node tables were not found. Use schema.sql for a new installation.';
 end if;
 if to_regclass('public.lunch_users') is not null then
  foreach name in array array['roster','users','sessions','state','auth_buckets','settings','admin_events','job_runs'] loop
   if to_regclass('public.lunch_'||name) is not null then
    if to_regclass('public.ax_lunch_'||name) is not null then raise exception 'Conflicting AX table: %',name; end if;
    execute format('alter table public.%I rename to %I','lunch_'||name,'ax_lunch_'||name);
   end if;
  end loop;
  -- Stored SQL/PLpgSQL bodies are refreshed by the following ax-schema definitions.
  for item in select p.oid::regprocedure as signature,p.proname,p.proargtypes from pg_proc p where p.pronamespace='public'::regnamespace and starts_with(p.proname,'lunch_') loop
   if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='ax_'||item.proname and p.proargtypes=item.proargtypes) then raise exception 'Conflicting AX function: %',item.proname; end if;
   execute format('alter function %s rename to %I',item.signature,'ax_'||item.proname);
  end loop;
 end if;
 -- Refresh existing trigger/function bodies before canonical roster updates can fire them.
 for item in select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and starts_with(p.proname,'ax_lunch_') loop
  execute regexp_replace(pg_get_functiondef(item.oid), '\mlunch_', 'ax_lunch_', 'g');
 end loop;
 -- Constraint renames also rename their backing primary/unique indexes.
 for item in select c.conname,c.conrelid::regclass as tbl from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relnamespace='public'::regnamespace and starts_with(t.relname,'ax_lunch_') and starts_with(c.conname,'lunch_') loop
  execute format('alter table %s rename constraint %I to %I',item.tbl,item.conname,'ax_'||item.conname);
 end loop;
 for item in select c.relname,c.relkind from pg_class c where c.relnamespace='public'::regnamespace and starts_with(c.relname,'lunch_') and c.relkind in ('i','I','S') loop
  execute format('alter %s public.%I rename to %I',case when item.relkind='S' then 'sequence' else 'index' end,item.relname,'ax_'||item.relname);
 end loop;
 for item in select t.tgname,t.tgrelid::regclass as tbl from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and starts_with(c.relname,'ax_lunch_') and starts_with(t.tgname,'lunch_') and not t.tgisinternal loop
  execute format('alter trigger %I on %s rename to %I',item.tgname,item.tbl,'ax_'||item.tgname);
 end loop;
end $rename$;
