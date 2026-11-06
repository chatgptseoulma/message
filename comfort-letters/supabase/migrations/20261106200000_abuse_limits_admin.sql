-- 2026-11-06: 보안점검 3·4순위. 표·열 추가만 하고 기존 데이터는 건드리지 않는다.

-- V-02 계정 생성 기록: 접속 주소(IP)는 원문이 아니라 서버 비밀값으로 만든 해시만 저장. 2일 지난 기록은 앱이 지운다
create table if not exists public.cb_signup_log (
  id         bigint generated always as identity primary key,
  ip_hash    text not null check (char_length(ip_hash) <= 64),
  created_at timestamptz not null default now()
);
create index if not exists cb_signup_log_ip_idx on public.cb_signup_log (ip_hash, created_at desc);

-- V-01 관리자 화면: 신고를 처리했는지 표시
alter table public.cb_reports add column if not exists reviewed_at timestamptz;

-- 하루 방 개수 제한을 빠르게 세기 위한 인덱스
create index if not exists cb_threads_seeker_created_idx on public.cb_threads (seeker_id, created_at desc);

alter table public.cb_signup_log enable row level security;
revoke all on public.cb_signup_log from anon, authenticated;
