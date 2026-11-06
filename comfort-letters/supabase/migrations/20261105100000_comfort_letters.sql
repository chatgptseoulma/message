-- 퇴근길 위로 편지: 위로받는 사람이 위로해 줄 사람을 골라 편지를 주고받는다.
-- 모든 접근은 Vercel 서버 함수(service role)로만 한다. 공개 키(anon)로는 읽기·쓰기 불가.

create table if not exists public.cb_users (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,          -- 브라우저가 가진 열쇠의 SHA-256 (열쇠 원문은 저장 안 함)
  nickname    text not null check (char_length(nickname) between 1 and 20),
  created_at  timestamptz not null default now()
);

create table if not exists public.cb_comforters (
  user_id     uuid primary key references public.cb_users(id) on delete cascade,
  intro       text not null default '' check (char_length(intro) <= 100),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.cb_threads (
  id                uuid primary key default gen_random_uuid(),
  seeker_id         uuid not null references public.cb_users(id) on delete cascade,
  comforter_id      uuid not null references public.cb_users(id) on delete cascade,
  seeker_unread     boolean not null default false,
  comforter_unread  boolean not null default true,
  closed            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (seeker_id <> comforter_id)
);
create index if not exists cb_threads_seeker_idx on public.cb_threads (seeker_id, updated_at desc);
create index if not exists cb_threads_comforter_idx on public.cb_threads (comforter_id, updated_at desc);

create table if not exists public.cb_messages (
  id          bigint generated always as identity primary key,
  thread_id   uuid not null references public.cb_threads(id) on delete cascade,
  author_id   uuid not null references public.cb_users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists cb_messages_thread_idx on public.cb_messages (thread_id, id);
create index if not exists cb_messages_author_idx on public.cb_messages (author_id, created_at desc);

alter table public.cb_users      enable row level security;
alter table public.cb_comforters enable row level security;
alter table public.cb_threads    enable row level security;
alter table public.cb_messages   enable row level security;
revoke all on public.cb_users, public.cb_comforters, public.cb_threads, public.cb_messages from anon, authenticated;
