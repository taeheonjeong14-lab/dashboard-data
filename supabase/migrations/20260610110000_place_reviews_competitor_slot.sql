-- 경쟁병원 리뷰를 우리 병원(owner) hospital_id 하위에 competitor_slot 태그로 저장(갯수 비교용).
-- competitor_slot null = 우리 병원, 1~3 = 경쟁병원. 경쟁병원 행은 본문/감성 없이 날짜만 채운다.
alter table analytics.analytics_place_reviews
  add column if not exists competitor_slot smallint;

create index if not exists idx_place_reviews_competitor
  on analytics.analytics_place_reviews (hospital_id, competitor_slot, review_date desc);
