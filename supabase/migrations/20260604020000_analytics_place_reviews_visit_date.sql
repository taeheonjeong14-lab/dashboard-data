-- 리뷰 방문일(visit_date) 컬럼 추가.
-- review_date = 리뷰 작성일(네이버 created) — 수집/증분 기준.
-- visit_date  = 실제 방문일(네이버 visited) — UI 집계·표시 기준.

alter table analytics.analytics_place_reviews
  add column if not exists visit_date date;

-- UI 가 visit_date 로 조회/집계하므로 인덱스 추가
create index if not exists idx_place_reviews_hospital_visit
  on analytics.analytics_place_reviews (hospital_id, visit_date desc);
