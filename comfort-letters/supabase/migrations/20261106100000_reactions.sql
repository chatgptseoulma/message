-- 2026-11-06: 말풍선 공감 반응 (👍 😢 🔥 😡 🫂 💪). 표 추가만 하고 기존 데이터는 건드리지 않는다.
-- thread_id 는 방 하나의 반응을 한 번에 읽기 위해 함께 저장한다.
create table if not exists public.cb_reactions (
  message_id bigint not null references public.cb_messages(id) on delete cascade,
  thread_id  uuid   not null references public.cb_threads(id) on delete cascade,
  user_id    uuid   not null references public.cb_users(id) on delete cascade,
  emoji      text   not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists cb_reactions_thread_idx on public.cb_reactions (thread_id);

alter table public.cb_reactions enable row level security;
revoke all on public.cb_reactions from anon, authenticated;
