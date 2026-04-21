-- 블로그 키워드 순위 수집 대상 시드 (예시)
-- 1) Supabase SQL Editor에서 supabase/schema.sql 반영 후 실행
-- 2) 아래 PLACEHOLDER_* 를 실제 값으로 바꾸거나, SELECT 결과를 참고해 INSERT 하세요.

-- 병원 목록과 네이버 블로그 ID 확인 (naver_blog_id 가 순위 매크로의 account_id 와 같아야 함)
-- select id::text as hospital_id, name, naver_blog_id
-- from core.hospitals
-- where naver_blog_id is not null
-- order by name;

-- 단일 병원에 키워드 여러 개
insert into analytics.analytics_blog_keyword_targets (
  account_id,
  hospital_id,
  keyword,
  is_active,
  source
)
values
  ('PLACEHOLDER_NAVER_BLOG_ID', 'PLACEHOLDER_HOSPITAL_ID_TEXT', '은평구동물병원', true, 'manual'),
  ('PLACEHOLDER_NAVER_BLOG_ID', 'PLACEHOLDER_HOSPITAL_ID_TEXT', '수색동물병원', true, 'manual')
on conflict (account_id, keyword) do update set
  hospital_id = excluded.hospital_id,
  is_active = excluded.is_active,
  source = excluded.source,
  updated_at = now();

-- hospital_id 는 RLS(대시보드에서 타깃 목록 조회)용입니다. 수집 매크로는 account_id + keyword 만 읽습니다.
-- core.hospitals.naver_blog_id 와 account_id 가 일치하도록 맞추는 것을 권장합니다.
