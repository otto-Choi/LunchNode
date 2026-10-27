from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
admin=(root/'supabase/headquarters-administrators.sql').read_text()
previous=(root/'supabase/continuous-operation.sql').read_text()
parts=['begin;\n-- Preserve all saved choices, accounts and historical groups. Only changed/new groups are capped.']
for tenant in ['ax','global','tmt']:
 prefix=tenant+'_lunch_'
 def function(source,name):
  matches=re.findall(r'(?m)^create or replace function public\.'+prefix+name+r'\(.*?\n\$\$;',source,re.S)
  assert len(matches)==1,(tenant,name,len(matches))
  return matches[0]
 commit=function(admin,'commit_state').replace('closed_day record;', 'closed_day record; proposed_day record; proposed_group jsonb;')
 needle=' -- No caller, including recovery cron, can rewrite an already finalized snapshot.'
 guard=""" -- Validate only changed group arrays. Historical five-person records stay intact.
 for proposed_day in select key,value from jsonb_each(p_data->'days') loop
  if proposed_day.value->'groups' is distinct from current_row.data->'days'->proposed_day.key->'groups' then
   if current_row.data->'days'->proposed_day.key is not null and clock_timestamp()>=(proposed_day.key||'T11:00:00+09:00')::timestamptz then
    raise exception using errcode='LN409',message='마감된 조는 변경할 수 없습니다.';
   end if;
   if jsonb_typeof(proposed_day.value->'groups') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
   for proposed_group in select value from jsonb_array_elements(proposed_day.value->'groups') loop
    if jsonb_typeof(proposed_group->'members') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
    if jsonb_array_length(proposed_group->'members') not between 1 and 5 then raise exception using errcode='LN400',message='일반 조는 최대 4명, 도시락만 조는 최대 5명입니다.';end if;
    if jsonb_array_length(proposed_group->'members')=5 and (proposed_group->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(proposed_group->'members') member where p_data->'choices'->proposed_day.key->(member->>'id')->>'meal' is distinct from 'lunchbox')) then raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
   end loop;
  end if;
 end loop;
"""
 assert needle in commit
 parts.append(commit.replace(needle,guard+needle))
 for suffix in ['admin_rematch','admin_initial_match']:
  fn=function(previous,suffix)
  guard=""" if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members')=5 and
 (g->>'meal' is distinct from 'lunchbox' or exists(select 1 from jsonb_array_elements(g->'members') member where current_row.data->'choices'->p_date->(member->>'id')->>'meal' is distinct from 'lunchbox'))) then
 raise exception using errcode='LN400',message='5인 조는 도시락만 신청자로만 구성할 수 있습니다.';end if;
"""
  needle=' select coalesce(array_agg(m->>'
  assert needle in fn
  fn=fn.replace(needle,guard+needle,1)
  parts.append(fn)

 parts.append(f"revoke all on function public.{prefix}commit_state(text,integer,jsonb,text[],boolean),public.{prefix}admin_rematch(text,integer,text,jsonb),public.{prefix}admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;")
parts.append("notify pgrst, 'reload schema';\ncommit;\n")
text='\n'.join(parts)
(root/'supabase/four-person-matching.sql').write_text(text)
for migration in (root/'supabase/migrations').glob('*_four_person_strict_meals.sql'):
 migration.write_text(text)
