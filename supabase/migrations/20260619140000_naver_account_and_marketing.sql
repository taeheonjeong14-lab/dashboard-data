-- 병원 네이버 로그인 계정(데이터 수집용, 평문) + 가입 시 과거 마케팅 활동.
alter table core.hospitals add column if not exists naver_login_id text;
alter table core.hospitals add column if not exists naver_login_pw text;

alter table core.hospital_registrations add column if not exists marketing_channels text[] not null default '{}';
