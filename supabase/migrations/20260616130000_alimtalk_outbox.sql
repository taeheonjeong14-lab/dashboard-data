-- 알림톡 발송 대기열(outbox).
-- 알리고가 "고정 발신 IP"를 요구하는데 chart-api(Vercel) egress IP는 유동적 → 사무실 고정 IP 뒤의
-- 워커 PC(collect-worker)가 이 큐를 폴링해 알리고로 발송한다. 알리고에는 사무실 고정 IP만 등록.
create schema if not exists health_report;

create table if not exists health_report.alimtalk_outbox (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts       int  not null default 0,
  run_id         uuid,
  hospital_id    uuid,
  receiver       text not null,            -- 정규화된 수신번호(01012345678)
  template_code  text not null,
  subject        text,
  emphasis_title text,                      -- 강조표기형 주제목(emtitle_1)
  message        text not null,             -- 본문(message_1)
  buttons        jsonb,                     -- [{type:'WL',name,linkMo,linkPc} | {type:'AC',name}]
  pdf_url        text,
  result_code    int,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  sent_at        timestamptz
);

create index if not exists idx_alimtalk_outbox_status_created
  on health_report.alimtalk_outbox (status, created_at);

-- 워커(collect-worker)는 service_role 키로 접근한다.
grant select, insert, update on health_report.alimtalk_outbox to service_role;
