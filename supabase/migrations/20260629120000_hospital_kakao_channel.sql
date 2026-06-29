-- 병원별 카카오 알림톡 채널/템플릿 설정.
-- 회사 단일 알리고 계정(ALIGO_API_KEY/USER_ID/발신IP는 공용) 안에서 병원마다
-- 발신프로필(senderkey)·발신번호·커스텀 템플릿을 갖는다.
-- 미설정 병원은 워커가 ENV(회사 기본 채널)로 폴백 발송한다.
create schema if not exists health_report;

-- (a) 병원 채널 발신 정보
create table if not exists health_report.hospital_kakao_channel (
  hospital_id  text primary key references core.hospitals(id) on delete cascade,
  sender_key   text not null,            -- 발신프로필키
  sender_phone text not null,            -- 발신번호(01012345678 형식)
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- (b) 병원 템플릿(메시지 종류별 1행) — 병원마다 커스텀이라 코드뿐 아니라 본문/강조제목/버튼까지 저장.
--     본문은 카카오 승인 템플릿과 글자까지 일치해야 발송되므로 변수자리를 포함한 원문을 그대로 저장한다.
create table if not exists health_report.hospital_kakao_template (
  hospital_id    text not null references core.hospitals(id) on delete cascade,
  message_type   text not null check (message_type in ('survey','report')),
  template_code  text not null,
  body           text not null,          -- 변수자리(#{병원명}·#{예약일}·#{token} 등) 포함
  emphasis_title text,                    -- 강조표기형 주제목(emtitle_1), 변수 포함 가능
  buttons        jsonb,                   -- [{type:'AC',name} | {type:'WL',name,linkMo,linkPc}]
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (hospital_id, message_type)
);

-- (c) outbox 에 발신프로필 정보 — null 이면 워커가 ENV(회사 기본 채널)로 폴백 발송.
alter table health_report.alimtalk_outbox
  add column if not exists sender_key   text,
  add column if not exists sender_phone text;

-- 워커(collect-worker) / 서버 라우트는 service_role 로 접근한다.
grant select, insert, update, delete on health_report.hospital_kakao_channel  to service_role;
grant select, insert, update, delete on health_report.hospital_kakao_template to service_role;
