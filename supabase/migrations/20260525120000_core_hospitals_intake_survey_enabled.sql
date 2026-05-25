-- 초진 접수 ↔ 사전문진 연결 여부를 병원별로 on/off 하는 플래그.
-- 회사(admin-web)에서 병원마다 설정. 기본값 false(연결 안 함 = 기존 동작).
alter table core.hospitals
  add column if not exists intake_survey_enabled boolean not null default false;

comment on column core.hospitals.intake_survey_enabled is
  '초진 접수증에서 연락처로 사전문진을 매칭해 겹치는 질문을 스킵/프리필할지 여부 (admin-web에서 설정)';
