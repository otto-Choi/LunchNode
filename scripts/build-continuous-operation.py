from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
# Additive upgrade; historical migrations and installers remain immutable.
parts=["""begin;
create schema if not exists lunch_operation_private;
revoke all on schema lunch_operation_private from public,anon,authenticated,service_role;
create or replace function lunch_operation_private.calendar_dates(p_start date,p_end date,p_now timestamptz)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(to_char(d,'YYYY-MM-DD') order by d),'[]'::jsonb)
 from generate_series(p_start::timestamp,
 least(coalesce(p_end,'infinity'::date),(date_trunc('month',p_now at time zone 'Asia/Seoul')+interval '3 months'-interval '1 day')::date)::timestamp,
 interval '1 day') d where extract(isodow from d)<6;
$$;
revoke all on function lunch_operation_private.calendar_dates(date,date,timestamptz) from public,anon,authenticated,service_role;
"""]
for tenant in ['ax','global','tmt']:
 prefix=tenant+'_lunch_'
 source=(root/'supabase'/f'{tenant}-schema.sql').read_text()
 parts.append(f"""alter table public.{prefix}settings alter column end_date drop not null;
alter table public.{prefix}settings drop constraint if exists {prefix}settings_check;
alter table public.{prefix}settings drop constraint if exists {prefix}settings_period_check;
alter table public.{prefix}settings add constraint {prefix}settings_period_check check(end_date is null or end_date>=start_date);
update public.{prefix}settings set end_date=null where id=1;
""")
 for suffix in ['snapshot','commit_state','admin_rematch','admin_initial_match']:
  pattern=r'create or replace function public\.'+prefix+suffix+r'\(.*?\n\$\$;'
  matches=re.findall(pattern,source,re.S)
  assert len(matches)==1,(tenant,suffix,len(matches))
  sql=matches[0]
  if suffix=='snapshot':
   before="""'dates',(select jsonb_agg(to_char(d,'YYYY-MM-DD') order by d) from public."""+prefix+"""settings c,
   lateral generate_series(c.start_date::timestamp,c.end_date::timestamp,interval '1 day') d
   where c.id=1 and extract(isodow from d)<6)"""
   assert before in sql
   sql=sql.replace(before,"'dates',(select lunch_operation_private.calendar_dates(c.start_date,c.end_date,clock_timestamp()) from public."+prefix+"settings c where c.id=1)")
  sql=sql.replace('day_text::date>settings.end_date','(settings.end_date is not null and day_text::date>settings.end_date)')
  sql=sql.replace('p_date::date between start_date and end_date','p_date::date>=start_date and (end_date is null or p_date::date<=end_date)')
  parts.append(sql)
 parts.append(f"""-- Existing RPC grants stay unchanged; no new public endpoint.
revoke all on function public.{prefix}snapshot(text,boolean),public.{prefix}commit_state(text,integer,jsonb,text[],boolean),public.{prefix}admin_rematch(text,integer,text,jsonb),public.{prefix}admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;
""")
 parts.append(f"create index if not exists {prefix}admin_actor on public.{prefix}admin_events(actor_id);\ncreate index if not exists {prefix}admin_target on public.{prefix}admin_events(target_id);")
parts.append("create index if not exists group_node_votes_date on public.group_node_votes(meetup_id,date_id);")
parts.append("notify pgrst, 'reload schema';\ncommit;\n")
text='\n'.join(parts)
(root/'supabase/continuous-operation.sql').write_text(text)
for migration in (root/'supabase/migrations').glob('*_continuous_operation.sql'):
 migration.write_text(text)
