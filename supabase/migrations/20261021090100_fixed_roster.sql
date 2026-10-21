-- Apply after baseline. Preserve existing accounts and request history.
-- Transactional: stop without deleting anything if accounts outside the roster exist.
begin;
lock table public.lunch_users, public.lunch_state in exclusive mode;
-- Fixed roster: 8 in class 4, 9 in class 5, 3 December hires.
create table if not exists public.lunch_roster (
 id uuid primary key,
 name text not null unique,
 class_name text not null,
 default_status text not null check(default_status in ('unset','absent')),
 constraint lunch_roster_allowed check (
    (name='권도영' and class_name='4반' and default_status='unset') or
    (name='김서영' and class_name='4반' and default_status='unset') or
    (name='손규영' and class_name='4반' and default_status='unset') or
    (name='김민국' and class_name='4반' and default_status='unset') or
    (name='김상규' and class_name='4반' and default_status='unset') or
    (name='안소이' and class_name='4반' and default_status='unset') or
    (name='유태상' and class_name='4반' and default_status='unset') or
    (name='최철원' and class_name='4반' and default_status='unset') or
    (name='김주연' and class_name='5반' and default_status='unset') or
    (name='박서연' and class_name='5반' and default_status='unset') or
    (name='박진홍' and class_name='5반' and default_status='unset') or
    (name='양우진' and class_name='5반' and default_status='unset') or
    (name='장은영' and class_name='5반' and default_status='unset') or
    (name='김영탁' and class_name='5반' and default_status='unset') or
    (name='부유경' and class_name='5반' and default_status='unset') or
    (name='서유빈' and class_name='5반' and default_status='unset') or
    (name='오성현' and class_name='5반' and default_status='unset') or
    (name='김범준' and class_name='12월 입사자' and default_status='absent') or
    (name='박대원' and class_name='12월 입사자' and default_status='absent') or
    (name='박진영' and class_name='12월 입사자' and default_status='absent')
 )
);
do $$ begin
 if exists(select 1 from public.lunch_users where name not in ('권도영','김서영','손규영','김민국','김상규','안소이','유태상','최철원','김주연','박서연','박진홍','양우진','장은영','김영탁','부유경','서유빈','오성현','김범준','박대원','박진영')) then
   raise exception 'Existing accounts outside the approved roster: review before applying this migration';
 end if;
end; $$;
insert into public.lunch_roster(id,name,class_name,default_status)
select coalesce(u.id,seed.id),seed.name,seed.class_name,seed.default_status from (values
('00000000-0000-4000-8000-000000000001'::uuid,'권도영','4반','unset'),
('00000000-0000-4000-8000-000000000002'::uuid,'김서영','4반','unset'),
('00000000-0000-4000-8000-000000000003'::uuid,'손규영','4반','unset'),
('00000000-0000-4000-8000-000000000004'::uuid,'김민국','4반','unset'),
('00000000-0000-4000-8000-000000000005'::uuid,'김상규','4반','unset'),
('00000000-0000-4000-8000-000000000006'::uuid,'안소이','4반','unset'),
('00000000-0000-4000-8000-000000000007'::uuid,'유태상','4반','unset'),
('00000000-0000-4000-8000-000000000008'::uuid,'최철원','4반','unset'),
('00000000-0000-4000-8000-000000000009'::uuid,'김주연','5반','unset'),
('00000000-0000-4000-8000-000000000010'::uuid,'박서연','5반','unset'),
('00000000-0000-4000-8000-000000000011'::uuid,'박진홍','5반','unset'),
('00000000-0000-4000-8000-000000000012'::uuid,'양우진','5반','unset'),
('00000000-0000-4000-8000-000000000013'::uuid,'장은영','5반','unset'),
('00000000-0000-4000-8000-000000000014'::uuid,'김영탁','5반','unset'),
('00000000-0000-4000-8000-000000000015'::uuid,'부유경','5반','unset'),
('00000000-0000-4000-8000-000000000016'::uuid,'서유빈','5반','unset'),
('00000000-0000-4000-8000-000000000017'::uuid,'오성현','5반','unset'),
('00000000-0000-4000-8000-000000000018'::uuid,'김범준','12월 입사자','absent'),
('00000000-0000-4000-8000-000000000019'::uuid,'박대원','12월 입사자','absent'),
('00000000-0000-4000-8000-000000000020'::uuid,'박진영','12월 입사자','absent')) as seed(id,name,class_name,default_status)
left join public.lunch_users u on u.name=seed.name
on conflict(name) do update set class_name=excluded.class_name, default_status=excluded.default_status;
update public.lunch_users u set class_name=r.class_name from public.lunch_roster r where u.id=r.id;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='lunch_users_roster_id') then
   alter table public.lunch_users add constraint lunch_users_roster_id foreign key(id) references public.lunch_roster(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='lunch_users_roster_name') then
   alter table public.lunch_users add constraint lunch_users_roster_name foreign key(name) references public.lunch_roster(name);
 end if;
end; $$;
alter table public.lunch_roster enable row level security;
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

commit;
