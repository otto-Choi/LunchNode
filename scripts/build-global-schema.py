from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
# Generate Global tables/RPCs alongside AX inside the SAME public schema.
migrations=[p for p in sorted((root/'supabase/migrations').glob('*.sql')) if p.name<'20261023090100']
(root/'supabase/schema.sql').write_text('\n'.join(p.read_text() for p in migrations))
# Produce rerunnable, namespaced Global tables using the same audited server RPCs.
axnames=['권도영','김서영','손규영','김민국','김상규','안소이','유태상','최철원','김주연','박서연','박진홍','양우진','장은영','김영탁','부유경','서유빈','오성현','김범준','박대원','박진영']
rows=[('류지환','IOA'),('박인홍','IOA'),('백재호','IOA'),('이상원','IOA'),('이윤서','IOA'),('최유정','IOA'),('김현태','IOA'),('유영채','IOA'),('유한혁','IOA'),('이다혜','IOA'),('이시연','IOA'),('정지우','IOA'),('강준현','IPO'),('고수현','IPO'),('김혜진','IPO'),('마승희','IPO'),('문채윤','IPO'),('윤두하','IPO'),('곽종우','IPO'),('이기하','IPO')]
text=(root/'supabase/schema.sql').read_text()
# Replace each per-person canonical seed/constraint row based on its canonical name.
for i,(old,(name,group)) in enumerate(zip(axnames,rows),1):
 text=text.replace(f"name='{old}' and class_name='",f"name='{name}' and class_name='")
 # Constraint rows and VALUES rows are independent; normalize each affected line below.
 text=re.sub(r"(name='"+re.escape(name)+r"' and class_name=)'[^']+' and default_status='[^']+'",lambda m:m.group(1)+f"'{group}' and default_status='unset'",text)
 text=re.sub(r"\('00000000-0000-4000-8000-"+f'{i:012d}'+r"'::uuid,'"+re.escape(old)+r"','[^']+','[^']+'\)",f"('10000000-0000-4000-8000-{i:012d}'::uuid,'{name}','{group}','unset')",text)
for old,(name,_) in zip(axnames,rows):
 text=text.replace("'"+old+"'","'"+name+"'")
# Old fixed-roster migration builds updates with quoted column aliases too; seeds above cover actual statements.
# Namespace every table, FK, index, trigger, function, sequence and privilege selector.
text=re.sub(r'\blunch_', 'global_lunch_', text)
text=text.replace('pg_advisory_xact_lock(610210903)', 'pg_advisory_xact_lock(610230901)')
# Intermediate historical constraints must allow current audit records on reapplication.
text=text.replace("check(action in ('reset_pin','revoke','recover','rematch'))", "check(action in ('reset_pin','revoke','recover','rematch','initial_match'))")
guard="""-- SAME SUPABASE PROJECT AS AX NODE. Adds public.global_lunch_* tables and RPCs.
-- Rerunnable: preserves both headquarters' accounts, sessions, choices and history.
begin;
do $$begin
 if to_regprocedure('public.lunch_tenant_info()') is null then raise exception 'Apply the AX headquarters operations update first.'; end if;
 if public.lunch_tenant_info()->>'tenant' is distinct from 'ax' then raise exception 'This installer requires the existing AX Node project.'; end if;
end$$;
"""
# One transaction: any failure rolls back the entire fresh installation.
text=re.sub(r'(?m)^begin;\s*$', '', text);text=re.sub(r'(?m)^commit;\s*$', '',text)
# Default tenant is AX while creating shared migrations; switch only after a complete fresh install.
text+="""
update public.global_lunch_settings set tenant_key='global',end_date='2026-11-30',start_date=(
 select d::date from generate_series(
  (case when (clock_timestamp() at time zone 'Asia/Seoul')::time<time '11:00' then (clock_timestamp() at time zone 'Asia/Seoul')::date else (clock_timestamp() at time zone 'Asia/Seoul')::date+1 end)::timestamp,
  '2026-11-30'::timestamp,interval '1 day') d where extract(isodow from d)<6 order by d limit 1
) where id=1 and tenant_key='ax';
notify pgrst, 'reload schema';
commit;
"""
assert not re.search(r'public\.lunch_',text), 'Global body must never touch AX tables or RPCs'
(root/'supabase/global-schema.sql').write_text(guard+text)
(root/'supabase/migrations/20261023090100_global_tables.sql').write_text(guard+text)

# Final AX namespace. Original historical migrations remain available for legacy installations.
ax_text='\n'.join(p.read_text() for p in migrations)
ax_text=re.sub(r'(?m)^begin;\s*$', '', ax_text)
ax_text=re.sub(r'(?m)^commit;\s*$', '', ax_text)
ax_text=ax_text.replace("check(action in ('reset_pin','revoke','recover','rematch'))", "check(action in ('reset_pin','revoke','recover','rematch','initial_match'))")
ax_text=re.sub(r'\blunch_', 'ax_lunch_', ax_text)
ax_text=ax_text.replace('pg_advisory_xact_lock(610210903)', 'pg_advisory_xact_lock(610230902)')
(root/'supabase/ax-schema.sql').write_text('begin;\n'+ax_text+"\nnotify pgrst, 'reload schema';\ncommit;\n")
# New Global standalone installer accepts either supported AX namespace.
new_guard="""-- SAME SUPABASE PROJECT. Global-only installer; preserves saved records.
begin;
do $guard$ begin
 if to_regprocedure('public.ax_lunch_tenant_info()') is not null then
  if public.ax_lunch_tenant_info()->>'tenant' is distinct from 'ax' then raise exception 'AX tenant configuration mismatch'; end if;
 elsif to_regprocedure('public.lunch_tenant_info()') is not null then
  if public.lunch_tenant_info()->>'tenant' is distinct from 'ax' then raise exception 'AX tenant configuration mismatch'; end if;
 else raise exception 'Apply the AX setup first';
 end if;
end $guard$;
"""
(root/'supabase/global-schema.sql').write_text(new_guard+text)
rename=(root/'supabase/ax-rename.sql').read_text()
# One transaction: rename existing objects, refresh all namespaced functions, add Global.
body=new_guard+text
body=re.sub(r'(?m)^begin;\s*$','',body)
body=re.sub(r'(?m)^commit;\s*$','',body)
upgrade='-- ONE EXISTING SUPABASE PROJECT: rename AX objects and add Global atomically.\nbegin;\n'+rename+'\n'+ax_text+'\n'+body+"\nnotify pgrst, 'reload schema';\ncommit;\n"
(root/'supabase/upgrade-shared-db.sql').write_text(upgrade)
(root/'supabase/schema.sql').write_text('begin;\n'+ax_text+'\n'+body+"\nnotify pgrst, 'reload schema';\ncommit;\n")

(root/'CUTOVER_GUIDE.md').write_text((root/'scripts/cutover-guide-template.md').read_text().replace('<!-- CUTOVER_SQL -->','```sql\n'+upgrade+'```'))
