-- Phase 0: 회원가입·권한 재설계 스키마.
-- core.* 는 ddx-api prisma 가 SoT — 이 SQL 은 prisma 스키마 변경(Hospital/User 컬럼 + HospitalRegistration)과 동치.

-- 병원: 통지용 이메일 + 대표원장 휴대폰
alter table core.hospitals add column if not exists email text;
alter table core.hospitals add column if not exists director_phone text;

-- 유저: 병원 내 역할 / 스태프 승인 / 휴대폰 본인인증(ci·di)
alter table core.users add column if not exists hospital_role text;            -- 'master' | 'staff'
alter table core.users add column if not exists staff_approved boolean not null default false;
alter table core.users add column if not exists ci text;
alter table core.users add column if not exists di text;
alter table core.users add column if not exists phone_verified boolean not null default false;
alter table core.users add column if not exists verified_name text;
create index if not exists idx_core_users_di on core.users (di);

-- 병원 등록 신청·심사 대기 (승인 시 core.hospitals 생성)
create table if not exists core.hospital_registrations (
  id                   uuid primary key default gen_random_uuid(),
  hospital_name        text not null,
  phone                text,
  address              text,
  address_detail       text,
  email                text,
  director_name        text,
  director_phone       text,
  biz_cert_path        text,           -- 사업자등록증 (Storage 경로)
  vet_license_path     text,           -- 수의사신고필증 (Storage 경로)
  master_user_id       text,           -- 제출 시 만든 마스터 인증계정 uid
  status               text not null default 'pending',  -- pending|approved|rejected
  review_note          text,
  di_conflict          boolean not null default false,   -- 마스터 DI 중복(심사 경고)
  di_conflict_hospital text,
  hospital_id          text,           -- 승인 시 생성된 hospital
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_hospital_registrations_status on core.hospital_registrations (status);

grant select, insert, update, delete on core.hospital_registrations to service_role;
