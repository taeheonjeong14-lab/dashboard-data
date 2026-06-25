-- intake.submission_pets — 초진 접수증의 "아이별" 정규화 행 (submissions 1건 : pets N건).
--
-- ⚠️ 이 테이블은 운영 DB에 이미 존재하지만 마이그레이션 파일이 누락돼 있었다(생성 마이그레이션 부재).
--    DB 재구축(마이그레이션만으로 스키마 재현) 시 이 테이블이 빠져 초진 접수 INSERT가 깨지는 것을 막기 위해,
--    현재 운영 스키마(PostgREST introspection 기준) 그대로 재현해 버전관리에 채운다.
--    `create table if not exists` 라 기존 운영 DB에는 무영향(no-op)이고, 신규/재구축 시에만 생성된다.
--
-- 접근은 submissions 와 동일하게 모두 서버(서비스 롤) 경유 → RLS 켜고 정책은 두지 않는다.

create table if not exists intake.submission_pets (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references intake.submissions(id) on delete cascade,
  hospital_id       uuid not null,
  pet_index         integer,
  name              text,
  species           text,                       -- dog / cat / other
  breed             text,
  breed_other       text,
  birth_date        date,
  age_unknown       boolean not null default false,
  age_text          text,
  sex               text,                       -- male_neutered / female_neutered / male_intact / female_intact
  registration      text,                       -- internal / external / none
  insurance         text,                       -- yes / no
  symptoms          text[] not null default '{}',
  symptom_detail    text,
  survey_linked     boolean not null default false,
  survey_session_id text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_intake_submission_pets_submission
  on intake.submission_pets (submission_id);

alter table intake.submission_pets enable row level security;

grant select, insert, update on table intake.submission_pets to service_role;
