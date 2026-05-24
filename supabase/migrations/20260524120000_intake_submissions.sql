-- 초진환자 접수증 (보호자가 작성하는 공개 설문) 제출 저장
-- 접근은 모두 서버(서비스 롤) 경유: 공개 제출 라우트 + 직원 열람 라우트.
-- 브라우저(anon/authenticated) 직접 접근 없음 → RLS 켜두고 정책은 두지 않음(서비스 롤만 통과).

create schema if not exists intake;

create table if not exists intake.submissions (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      text not null,                       -- core.hospitals.id 와 값 일치
  owner_name       text,
  owner_phone      text,
  owner_address    text,
  pet_count        integer,
  pets             jsonb not null default '[]'::jsonb,  -- 아이별 답변 배열
  referral         jsonb not null default '{}'::jsonb,  -- 알게 된 경로
  consent_required boolean not null default false,      -- (필수) 진료 목적 동의
  consent_marketing boolean not null default false,     -- (선택) 마케팅 동의
  answers          jsonb not null default '{}'::jsonb,  -- 전체 원본 답변(향후 호환·문진 통합 대비)
  status           text not null default 'submitted',   -- submitted / seen / archived
  created_at       timestamptz not null default now()
);

create index if not exists idx_intake_submissions_hospital_created
  on intake.submissions (hospital_id, created_at desc);

alter table intake.submissions enable row level security;

grant usage on schema intake to service_role;
grant select, insert, update on table intake.submissions to service_role;

-- ⚠️ 배포 후 1회: Supabase 대시보드 → Settings → API → Exposed schemas 에 `intake` 추가해야
--    supabase-js(.schema('intake'))로 접근됩니다. (core/analytics/health_report 처럼)
