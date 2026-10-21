from pathlib import Path
import re
root=Path('/workspace/lunch-match')
rows=re.findall(r"\['([^']+)','([^']+)'\]",(root/'lib/roster.ts').read_text())
values=[]
for i,(name,group) in enumerate(rows,1):values.append(f"('00000000-0000-4000-8000-{i:012d}'::uuid,'{name}','{group}','{'absent' if group=='12월 입사자' else 'unset'}')")
checks=' or\n    '.join(f"(name='{n}' and class_name='{g}' and default_status='{'absent' if g=='12월 입사자' else 'unset'}')" for n,g in rows)
create=f'''-- Fixed roster: 8 in class 4, 9 in class 5, 3 December hires.
create table if not exists public.lunch_roster (
 id uuid primary key,
 name text not null unique,
 class_name text not null,
 default_status text not null check(default_status in ('unset','absent')),
 constraint lunch_roster_allowed check (
    {checks}
 )
);
'''
seed='insert into public.lunch_roster(id,name,class_name,default_status) values\n'+',\n'.join(values)+';\n'
security='''alter table public.lunch_roster enable row level security;
revoke all on public.lunch_roster from public, anon, authenticated, service_role;
grant select on public.lunch_roster to service_role;

-- Account identity and affiliation always come from the fixed roster.
create or replace function public.lunch_check_identity()
returns trigger language plpgsql security definer set search_path=public as $$
declare person public.lunch_roster%rowtype;
begin
 select * into person from public.lunch_roster where id=new.id and name=new.name;
 if not found then raise exception 'Only the 20 listed participants may register'; end if;
 new.class_name := person.class_name;
 return new;
end;
$$;
revoke all on function public.lunch_check_identity() from public, anon, authenticated;
drop trigger if exists lunch_identity on public.lunch_users;
create trigger lunch_identity before insert or update on public.lunch_users
for each row execute function public.lunch_check_identity();
'''
p=root/'supabase/schema.sql';s=p.read_text();s=s.replace('id uuid primary key default gen_random_uuid(),','id uuid primary key references public.lunch_roster(id),',1);s=s.replace('name text not null unique check(char_length(name) between 2 and 30),','name text not null unique references public.lunch_roster(name) check(char_length(name) between 2 and 30),',1)
p.write_text(create+seed+'\n'+s+'\n'+security)
migration='''-- Existing installations only. For a new DB, apply ../schema.sql instead.
-- Transactional: stop without deleting anything if accounts outside the roster exist.
begin;
lock table public.lunch_users, public.lunch_state in exclusive mode;
'''+create
migration+='''do $$ begin
 if exists(select 1 from public.lunch_users where name not in ('''+','.join("'"+n+"'" for n,g in rows)+''')) then
   raise exception 'Existing accounts outside the approved roster: review before applying this migration';
 end if;
end; $$;
'''
migration+='insert into public.lunch_roster(id,name,class_name,default_status)\nselect coalesce(u.id,seed.id),seed.name,seed.class_name,seed.default_status from (values\n'+',\n'.join(values)+''') as seed(id,name,class_name,default_status)
left join public.lunch_users u on u.name=seed.name
on conflict(name) do update set class_name=excluded.class_name, default_status=excluded.default_status;
update public.lunch_users u set class_name=r.class_name from public.lunch_roster r where u.id=r.id;
'''
migration+='''do $$ begin
 if not exists(select 1 from pg_constraint where conname='lunch_users_roster_id') then
   alter table public.lunch_users add constraint lunch_users_roster_id foreign key(id) references public.lunch_roster(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='lunch_users_roster_name') then
   alter table public.lunch_users add constraint lunch_users_roster_name foreign key(name) references public.lunch_roster(name);
 end if;
end; $$;
'''+security+'\ncommit;\n'
(root/'supabase/migrations/20261021_fixed_roster.sql').write_text(migration)
(root/'supabase/README.md').write_text('''# 참가자 명단 적용

현재 작업 환경에는 Supabase 연결 정보가 없어 원격 DB에는 아직 적용하지 않았습니다.

- 새 DB: SQL Editor에서 `schema.sql`을 1회 실행합니다. 테이블과 20명 명단을 함께 생성합니다.
- 기존 DB: `migrations/20261021_fixed_roster.sql`을 실행합니다. 허용 명단 외 계정이 있으면 기존 데이터를 삭제하지 않고 트랜잭션 전체를 중단합니다. 기존 계정 ID와 PIN, 신청 내역을 유지합니다.
- 두 SQL을 연달아 실행할 필요는 없습니다.

`lunch_roster`에 4반 8명, 5반 9명, 12월 입사자 3명을 저장합니다. 최초 등록은 이 명단의 행에 PIN 계정을 연결합니다. 미등록자는 PIN이 미리 생성되지 않습니다.

12월 입사자의 `default_status`는 `absent`입니다. 운영 기간의 날짜별 신청값이 없으면 서버가 기본값을 저장합니다. 명시적인 참여/불참 신청은 덮어쓰지 않습니다. 참여를 취소하면 기본 불참으로 돌아갑니다. 과거 확정 명단의 이름·소속 스냅샷은 바꾸지 않습니다.

소속은 사용자가 수정할 수 없습니다. 이름 목록은 클라이언트, 인증 API, DB FK/트리거에서 검증합니다. DB `lunch_roster_allowed` 제약이 명단 밖 이름·임의 소속·잘못된 기본값을 차단합니다.
''')
print('Prepared schema + transactional migration:',len(rows),'participants')
