-- analytics.analytics_blog_keyword_targets 에 키워드 여러 줄 추가 (예시)
--
-- 사용 전:
-- 1) PLACEHOLDER_NAVER_BLOG_ID → core.hospitals.naver_blog_id 와 동일한 네이버 블로그 ID
-- 2) PLACEHOLDER_HOSPITAL_ID_TEXT → core.hospitals.id (uuid 문자열)
--
-- 병원·블로그 ID 확인:
--   select id::text as hospital_id, name, naver_blog_id
--   from core.hospitals
--   where naver_blog_id is not null
--   order by name;

insert into analytics.analytics_blog_keyword_targets (
  account_id,
  hospital_id,
  keyword,
  is_active,
  priority,
  source
)
values
  ('PLACEHOLDER_NAVER_BLOG_ID', 'PLACEHOLDER_HOSPITAL_ID_TEXT', '키워드예시1', true, 10, 'manual'),
  ('PLACEHOLDER_NAVER_BLOG_ID', 'PLACEHOLDER_HOSPITAL_ID_TEXT', '키워드예시2', true, 20, 'manual'),
  ('PLACEHOLDER_NAVER_BLOG_ID', 'PLACEHOLDER_HOSPITAL_ID_TEXT', '키워드예시3', true, 30, 'manual')
on conflict (account_id, keyword) do update set
  hospital_id = excluded.hospital_id,
  is_active = excluded.is_active,
  priority = excluded.priority,
  source = excluded.source,
  updated_at = now();
