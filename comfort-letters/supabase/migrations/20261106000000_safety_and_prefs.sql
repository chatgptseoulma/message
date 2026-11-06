-- 2026-11-06: 신고·차단, 이모티콘, 메시지 회수, 방별 숨기기/편들어 주기 그만.
-- 기존 데이터는 지우거나 바꾸지 않는다 (열·표 추가, 제약 하나 완화만).

-- 이모티콘 (빈 문자열 = 없음)
alter table public.cb_users add column if not exists emoji text not null default '';
alter table public.cb_users drop constraint if exists cb_users_emoji_check;
alter table public.cb_users add constraint cb_users_emoji_check check (char_length(emoji) <= 16);

-- 메시지 회수 / 신고 누적으로 가려진 메시지
alter table public.cb_messages add column if not exists deleted_at timestamptz;
alter table public.cb_messages add column if not exists moderated boolean not null default false;
-- 회수한 메시지는 내용을 비우므로, 회수된 경우에만 빈 본문을 허용
alter table public.cb_messages drop constraint if exists cb_messages_body_check;
alter table public.cb_messages add constraint cb_messages_body_check
  check (deleted_at is not null or char_length(body) between 1 and 2000);

-- 신고 누적으로 가려진 방
alter table public.cb_threads add column if not exists moderated boolean not null default false;

-- 차단: blocker 가 blocked 를 차단 (양쪽 모두 서로의 방·메시지가 안 보임)
create table if not exists public.cb_blocks (
  blocker_id uuid not null references public.cb_users(id) on delete cascade,
  blocked_id uuid not null references public.cb_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists cb_blocks_blocked_idx on public.cb_blocks (blocked_id);

-- 신고 (관리자는 Supabase 대시보드에서 확인)
create table if not exists public.cb_reports (
  id             bigint generated always as identity primary key,
  reporter_id    uuid references public.cb_users(id) on delete set null,
  target_user_id uuid references public.cb_users(id) on delete cascade,
  thread_id      uuid references public.cb_threads(id) on delete cascade,
  message_id     bigint references public.cb_messages(id) on delete cascade,
  reason         text not null check (reason in ('abuse', 'spam', 'privacy', 'sexual', 'other')),
  detail         text not null default '' check (char_length(detail) <= 300),
  created_at     timestamptz not null default now()
);
-- 같은 사람이 같은 메시지(또는 같은 방)를 두 번 신고하지 못하게
create unique index if not exists cb_reports_once_idx on public.cb_reports (reporter_id, thread_id, coalesce(message_id, 0));
create index if not exists cb_reports_message_idx on public.cb_reports (message_id);
create index if not exists cb_reports_thread_idx on public.cb_reports (thread_id);

-- 방별 개인 설정: 숨기기(새 메시지가 오면 다시 보임), 편들어 주기 그만(목록에서 빠지고 글쓰기 중지)
create table if not exists public.cb_room_prefs (
  thread_id uuid not null references public.cb_threads(id) on delete cascade,
  user_id   uuid not null references public.cb_users(id) on delete cascade,
  hidden_at timestamptz,
  stopped   boolean not null default false,
  primary key (thread_id, user_id)
);
create index if not exists cb_room_prefs_user_idx on public.cb_room_prefs (user_id);

alter table public.cb_blocks     enable row level security;
alter table public.cb_reports    enable row level security;
alter table public.cb_room_prefs enable row level security;
revoke all on public.cb_blocks, public.cb_reports, public.cb_room_prefs from anon, authenticated;
