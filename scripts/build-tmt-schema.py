from pathlib import Path
import re,json
root=Path(__file__).resolve().parents[1]
source=(root/'lib/backend/tmt-roster.ts').read_text()
rows=json.loads(source[source.index('\n[')+1:source.index('.map(')])
assert len(rows)==18 and len(set(n for n,t in rows))==18
text=(root/'supabase/ax-schema.sql').read_text().replace('ax_lunch_','tmt_lunch_')
checks=' or\n    '.join(f"(name='{name}' and class_name='{team}' and default_status='unset')" for name,team in rows)
text=re.sub(r"constraint tmt_lunch_roster_allowed check \(.*?\n \)", 'constraint tmt_lunch_roster_allowed check (\n    '+checks+'\n )',text,flags=re.S)
text=re.sub(r"name not in \([^)]*\)", "name not in ("+','.join("'"+name+"'" for name,team in rows)+')',text)
seeds=',\n'.join(f"('20000000-0000-4000-8000-{i:012d}'::uuid,'{name}','{team}','unset')" for i,(name,team) in enumerate(rows,1))
text=re.sub(r"from \(values\n.*?\) as seed\(id,name,class_name,default_status\)", 'from (values\n'+seeds+') as seed(id,name,class_name,default_status)',text,flags=re.S)
text=text.replace('-- Fixed roster: 8 in class 4, 9 in class 5, 3 December hires.','-- Fixed TMT roster: 8 Tech and 10 ICT, all initially unset.')
text=text.replace('610230902','610270901').replace("('ax','global')","('ax','tmt')").replace('<>20','<>18').replace('20 listed participants','18 listed participants').replace('등록된 20명','등록된 18명')
# Apply first-day settings once; rerunning never changes saved dates or choices.
text=text.replace("notify pgrst, 'reload schema';", """update public.tmt_lunch_settings set tenant_key='tmt',end_date='2026-11-30',start_date=(
 select d::date from generate_series(
 (case when (clock_timestamp() at time zone 'Asia/Seoul')::time<time '11:00' then (clock_timestamp() at time zone 'Asia/Seoul')::date else (clock_timestamp() at time zone 'Asia/Seoul')::date+1 end)::timestamp,
 '2026-11-30'::timestamp,interval '1 day') d where extract(isodow from d)<6 order by d limit 1
) where id=1 and tenant_key='ax';
notify pgrst, 'reload schema';""")
assert not re.search(r'public\.(?:ax|global)_lunch_',text)
assert '12월 입사자' not in re.sub(r'--[^\n]*','',text)
(root/'supabase/tmt-schema.sql').write_text('-- TMT ONLY. Generated from audited Lunch RPCs; no AX/Global data copied.\n'+text)
# Group Node extension changes constraints and actor/roster helpers, never meeting data.
group=(root/'supabase/migrations/20261026124241_group_node.sql').read_text()
actor=group[group.index('create function group_node_private.actor'):group.index('create function group_node_private.render')]
actor=actor.replace('create function','create or replace function').replace(" else raise exception", " elsif p_tenant='tmt' then return public.tmt_lunch_require_session(p_hash);\n else raise exception")
actor=actor.replace("from public.global_lunch_roster) r", "from public.global_lunch_roster\n union all select id,name,class_name,'tmt' from public.tmt_lunch_roster) r")
constraints='\n'.join(f"alter table public.{table} drop constraint {constraint};\nalter table public.{table} add constraint {constraint} check({column} in ('ax','global','tmt'));" for table,constraint,column in [
 ('group_node_meetups','group_node_meetups_created_by_tenant_check','created_by_tenant'),('group_node_participants','group_node_participants_tenant_check','tenant'),('group_node_comments','group_node_comments_tenant_check','tenant')])
(root/'supabase/tmt-group-node.sql').write_text("begin;\n"+constraints+'\n'+actor+"\nrevoke all on function group_node_private.actor(text,text),group_node_private.person(text,uuid) from public,anon,authenticated,service_role;\nnotify pgrst, 'reload schema';\ncommit;\n")

# Preserve the CLI-generated migration version while checking its generated body.
for migration in (root/'supabase/migrations').glob('*_tmt_headquarters.sql'):
 bodies=[(root/'supabase'/name).read_text() for name in ['tmt-schema.sql','tmt-group-node.sql']]
 body='\n'.join(re.sub(r'(?m)^(begin;|commit;)\s*$','',part) for part in bodies)
 migration.write_text('begin;\n'+body+'\ncommit;\n')
