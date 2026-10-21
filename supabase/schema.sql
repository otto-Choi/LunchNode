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
insert into public.lunch_roster(id,name,class_name,default_status) values
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
('00000000-0000-4000-8000-000000000020'::uuid,'박진영','12월 입사자','absent');

-- Apply once in the Supabase SQL editor. Only the server service role accesses these tables.
create table public.lunch_users (
 id uuid primary key references public.lunch_roster(id),
 name text not null unique references public.lunch_roster(name) check(char_length(name) between 2 and 30),
 class_name text not null default '' check(char_length(class_name)<=20),
 pin_hash text not null,
 created_at timestamptz not null default now()
);
create table public.lunch_sessions (
 token_hash text primary key,
 user_id uuid not null references public.lunch_users(id) on delete cascade,
 expires_at timestamptz not null
);
create index lunch_sessions_user on public.lunch_sessions(user_id);
create table public.lunch_state (
 id integer primary key check(id=1), version integer not null default 0,
 data jsonb not null default '{"choices":{},"days":{},"events":[]}'::jsonb
);
insert into public.lunch_state(id) values(1);
create table public.lunch_auth_buckets (
 key text primary key, attempts integer not null, window_start timestamptz not null
);
create or replace function public.lunch_auth_attempt(bucket_key text)
returns boolean language plpgsql security definer set search_path=public as $$
declare count_now integer;
begin
 insert into public.lunch_auth_buckets(key,attempts,window_start) values(bucket_key,1,now())
 on conflict(key) do update set
 attempts=case when lunch_auth_buckets.window_start < now()-interval '15 minutes' then 1 else lunch_auth_buckets.attempts+1 end,
 window_start=case when lunch_auth_buckets.window_start < now()-interval '15 minutes' then now() else lunch_auth_buckets.window_start end
 returning attempts into count_now;
 return count_now<=8;
end;
$$;
alter table public.lunch_users enable row level security;
alter table public.lunch_sessions enable row level security;
alter table public.lunch_state enable row level security;
alter table public.lunch_auth_buckets enable row level security;
revoke all on public.lunch_users, public.lunch_sessions, public.lunch_state, public.lunch_auth_buckets from anon, authenticated;
revoke all on function public.lunch_auth_attempt(text) from public, anon, authenticated;
grant execute on function public.lunch_auth_attempt(text) to service_role;
grant all on public.lunch_users, public.lunch_sessions, public.lunch_state, public.lunch_auth_buckets to service_role;

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
