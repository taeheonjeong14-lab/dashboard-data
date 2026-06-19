-- 마스터 최초 로그인 온보딩 설문: 완료 플래그 + 희망 키워드/경쟁병원(admin 참고용).
alter table core.hospitals add column if not exists onboarding_done boolean not null default false;
alter table core.hospitals add column if not exists wish_keywords text[] not null default '{}';
alter table core.hospitals add column if not exists wish_competitors text[] not null default '{}';
