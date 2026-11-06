-- 사내 교육 수요 설문 응답 (사번당 1건, 재제출 시 덮어씀)
create table if not exists public.responses (
  emp_no         text primary key check (emp_no ~ '^[A-Za-z0-9-]{1,20}$'),
  name           text not null,
  dept           text not null,
  rank           text not null,
  areas          text[] not null,
  area_other     text not null default '',
  priority_topic text not null default '',
  skill          smallint not null check (skill between 1 and 5),
  methods        text[] not null,
  time_slot      text not null,
  duration       text not null,
  past_sat       smallint check (past_sat between 0 and 5),  -- 0 = 받은 적 없음, null = 무응답
  barriers       text[] not null default '{}',
  barrier_other  text not null default '',
  comment        text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists responses_dept_idx on public.responses (dept);
create index if not exists responses_updated_idx on public.responses (updated_at desc);

-- 직원 개인정보가 들어 있으므로 공개(anon) 키로는 읽기·쓰기 모두 막는다.
-- Vercel 서버 함수만 service role 키로 접근한다 (service role은 RLS를 우회).
alter table public.responses enable row level security;
revoke all on public.responses from anon, authenticated;
