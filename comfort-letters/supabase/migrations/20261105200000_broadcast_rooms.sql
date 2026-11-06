-- 하소연 방: 위로받는 사람이 쏟아내면 방이 하나 생기고, 편들어 주기에 등록한 사람 모두가 보고 답할 수 있다.
--  - comforter_id 가 null 인 방 = 모두에게 보낸 방 (새 방식)
--  - comforter_id 가 있는 방 = 예전 1:1 대화 (당사자 둘만 볼 수 있음, 이력 보존용)

alter table public.cb_threads alter column comforter_id drop not null;

-- 목록을 빠르게 그리려고 방에 제목과 마지막 메시지를 함께 저장
alter table public.cb_threads add column if not exists title       text   not null default '';
alter table public.cb_threads add column if not exists last_id     bigint not null default 0;
alter table public.cb_threads add column if not exists last_body   text   not null default '';
alter table public.cb_threads add column if not exists last_author uuid;

-- 기존 방 채우기: 제목 = 첫 메시지 앞부분, 마지막 메시지 정보
update public.cb_threads t set
  title = coalesce((select left(m.body, 40) from public.cb_messages m where m.thread_id = t.id order by m.id asc limit 1), ''),
  last_id = coalesce((select m.id from public.cb_messages m where m.thread_id = t.id order by m.id desc limit 1), 0),
  last_body = coalesce((select left(m.body, 120) from public.cb_messages m where m.thread_id = t.id order by m.id desc limit 1), ''),
  last_author = (select m.author_id from public.cb_messages m where m.thread_id = t.id order by m.id desc limit 1);

create index if not exists cb_threads_broadcast_idx on public.cb_threads (updated_at desc) where comforter_id is null;

-- 사람마다 방을 어디까지 읽었는지 (단체방이라 방 하나에 읽음 표시가 여러 개)
create table if not exists public.cb_reads (
  thread_id    uuid   not null references public.cb_threads(id) on delete cascade,
  user_id      uuid   not null references public.cb_users(id) on delete cascade,
  last_read_id bigint not null default 0,
  primary key (thread_id, user_id)
);
create index if not exists cb_reads_user_idx on public.cb_reads (user_id);

alter table public.cb_reads enable row level security;
revoke all on public.cb_reads from anon, authenticated;
