from pathlib import Path
import re

root=Path(__file__).resolve().parents[1]
source=(root/'supabase/four-person-matching.sql').read_text()
start='2026-10-29'
assert f"LUNCHBOX_POOL_START_DATE='{start}'" in (root/'lib/domain.ts').read_text()
helper="""begin;
create schema if not exists lunch_matching_private;
revoke all on schema lunch_matching_private from public,anon,authenticated;
create or replace function lunch_matching_private.validate_pool_groups(p_groups jsonb,p_choices jsonb)
returns void language plpgsql set search_path=public as $$
declare g jsonb; m jsonb; actual_ids text[]; expected_ids text[]; pools integer:=0;
begin
 if jsonb_typeof(p_groups) is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
 for g in select value from jsonb_array_elements(p_groups) loop
  if jsonb_typeof(g->'members') is distinct from 'array' then raise exception using errcode='LN400',message='조 편성 형식을 확인해 주세요.';end if;
  if g->>'meal' is null or g->>'meal' not in ('lunchbox','outside') or jsonb_array_length(g->'members')=0 then raise exception using errcode='LN400',message='식사 구성을 확인해 주세요.';end if;
  if g->>'kind'='lunchbox_pool' then
   pools:=pools+1;
   if pools>1 or g->>'meal'<>'lunchbox' then raise exception using errcode='LN400',message='도시락 묶음은 하나만 만들 수 있습니다.';end if;
  elsif jsonb_array_length(g->'members')>4 then raise exception using errcode='LN400',message='일반 조는 최대 4명입니다.';end if;
  for m in select value from jsonb_array_elements(g->'members') loop
   if m->>'id' is null or p_choices->(m->>'id')->>'status' is distinct from 'join' then raise exception using errcode='LN400',message='참석자 정보를 확인해 주세요.';end if;
   if g->>'kind'='lunchbox_pool' then
    if p_choices->(m->>'id')->>'meal' is distinct from 'lunchbox' then raise exception using errcode='LN400',message='도시락 묶음에는 도시락만 신청자만 포함할 수 있습니다.';end if;
   elsif p_choices->(m->>'id')->>'meal'='lunchbox' then raise exception using errcode='LN400',message='도시락만 신청자는 도시락 묶음에 포함해 주세요.';
   elsif p_choices->(m->>'id')->>'meal'='outside' and g->>'meal'<>'outside' then raise exception using errcode='LN400',message='외식만 조건을 확인해 주세요.';end if;
  end loop;
 end loop;
 select coalesce(array_agg(item_member.value->>'id' order by item_member.value->>'id'),'{}'::text[]) into actual_ids from jsonb_array_elements(p_groups) item_group cross join lateral jsonb_array_elements(item_group.value->'members') item_member;
 select coalesce(array_agg(key order by key),'{}'::text[]) into expected_ids from jsonb_each(coalesce(p_choices,'{}'::jsonb)) where value->>'status'='join';
 if actual_ids is distinct from expected_ids then raise exception using errcode='LN409',message='참석자가 누락되거나 중복되었습니다. 다시 시도해 주세요.';end if;
end;
$$;
revoke all on function lunch_matching_private.validate_pool_groups(jsonb,jsonb) from public,anon,authenticated;
"""
parts=[helper]
for tenant in ['ax','global','tmt']:
 prefix=tenant+'_lunch_'
 for name in ['commit_state','admin_rematch','admin_initial_match']:
  matches=re.findall(r'(?m)^create or replace function public\.'+prefix+name+r'\(.*?\n\$\$;',source,re.S)
  assert len(matches)==1,(tenant,name)
  fn=matches[0]
  if name=='commit_state':
   first="   for proposed_group in select value from jsonb_array_elements(proposed_day.value->'groups') loop"
   last="   end loop;"
   a=fn.index(first); b=fn.index(last,a)+len(last)
   original=fn[a:b]
   fn=fn[:a]+f"   if proposed_day.key>='{start}' then\n    perform lunch_matching_private.validate_pool_groups(proposed_day.value->'groups',p_data->'choices'->proposed_day.key);\n   else\n"+original+"\n   end if;"+fn[b:]
  else:
   a=fn.index(" if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'members') not between 1 and 5)")
   b=fn.index(' select coalesce(array_agg(m->>',a)
   original=fn[a:b]
   fn=fn[:a]+f" if p_date>='{start}' then\n  perform lunch_matching_private.validate_pool_groups(p_groups,current_row.data->'choices'->p_date);\n else\n"+original+" end if;\n"+fn[b:]
  parts.append(fn)
 parts.append(f"revoke all on function public.{prefix}commit_state(text,integer,jsonb,text[],boolean),public.{prefix}admin_rematch(text,integer,text,jsonb),public.{prefix}admin_initial_match(text,integer,text,jsonb) from public,anon,authenticated;")
parts.append("notify pgrst, 'reload schema';\ncommit;\n")
text='\n'.join(parts)
(root/'supabase/lunchbox-pool.sql').write_text(text)
for migration in (root/'supabase/migrations').glob('*_lunchbox_pool.sql'):
 migration.write_text(text)
