from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
# Keep the AX standalone schema current; never use it on the Global DB.
migrations=sorted((root/'supabase/migrations').glob('*.sql'))
(root/'supabase/schema.sql').write_text('\n'.join(p.read_text() for p in migrations))
# Produce a fresh-install-only Global script using the same audited server RPCs.
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
guard="""-- GLOBAL ONLY. Refuses to run on any existing LunchNode database.
-- Use a NEW, SEPARATE Supabase project. Never run this file on AX Node.
begin;
do $$begin if to_regclass('public.lunch_settings') is not null or to_regclass('public.lunch_users') is not null or to_regclass('public.lunch_roster') is not null then raise exception 'Global installation requires an empty LunchNode database. AX Node data was not changed.'; end if; end$$;
"""
# One transaction: any failure rolls back the entire fresh installation.
text=re.sub(r'(?m)^begin;\s*$', '', text);text=re.sub(r'(?m)^commit;\s*$', '',text)
# Default tenant is AX while creating shared migrations; switch only after a complete fresh install.
text+="""
update public.lunch_settings set tenant_key='global',end_date='2026-11-30',start_date=(
 select d::date from generate_series(
  (case when (clock_timestamp() at time zone 'Asia/Seoul')::time<time '11:00' then (clock_timestamp() at time zone 'Asia/Seoul')::date else (clock_timestamp() at time zone 'Asia/Seoul')::date+1 end)::timestamp,
  '2026-11-30'::timestamp,interval '1 day') d where extract(isodow from d)<6 order by d limit 1
) where id=1;
commit;
"""
(root/'supabase/global-schema.sql').write_text(guard+text)
