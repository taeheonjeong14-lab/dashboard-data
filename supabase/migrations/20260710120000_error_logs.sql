-- hospital-web 에서 발생한 오류를 admin 이 조회할 수 있게 적재하는 테이블.
-- 쓰기는 service_role 만(서버 라우트 래퍼 / 클라이언트 수집 엔드포인트).
-- 읽기도 service_role 만 — admin 화면은 /api/admin/error-logs 를 거쳐 읽는다.
create table if not exists core.error_logs (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),

  app          text not null default 'hospital-web',
  source       text not null,              -- server | client
  route        text,                       -- 서버: /api/stats-upload · 클라이언트: pathname
  method       text,                       -- 서버 전용 (GET/POST/...)
  status_code  integer,                    -- 서버 전용
  feature      text,                       -- 사람이 읽는 기능명 (예: 경영통계 업로드)

  message      text not null,
  stack        text,

  hospital_id  text,
  user_id      text,

  -- 민감정보: 요청 본문은 redactPayload() 로 키 denylist 마스킹 + 크기/깊이 제한 후에만 저장한다.
  -- lib/error-log.ts 의 REDACT_KEYS 가 유일한 출처. 키를 추가할 땐 거기만 고칠 것.
  request_body jsonb,
  context      jsonb not null default '{}'::jsonb,

  -- route + 정규화된 message 해시. 같은 에러 묶어보기용.
  fingerprint  text not null,

  created_at   timestamptz not null default now()
);

create index if not exists idx_error_logs_occurred
  on core.error_logs (occurred_at desc);
create index if not exists idx_error_logs_fingerprint
  on core.error_logs (fingerprint, occurred_at desc);
create index if not exists idx_error_logs_hospital
  on core.error_logs (hospital_id, occurred_at desc);

alter table core.error_logs enable row level security;
-- 정책 없음 = authenticated/anon 접근 불가. service_role 은 RLS 를 우회한다.

grant select, insert, delete on core.error_logs to service_role;

comment on table core.error_logs is
  'hospital-web 서버/클라이언트 오류 적재. admin 에러 로그 화면(/admin/error-logs)의 원본.';
comment on column core.error_logs.request_body is
  '마스킹된 요청 본문. 원문 저장 금지 — lib/error-log.ts redactPayload() 통과분만.';
