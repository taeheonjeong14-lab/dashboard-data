-- 경쟁병원 스마트플레이스 리뷰 추이 수집을 위해 경쟁병원에 리뷰 URL 추가.
alter table analytics.analytics_hospital_competitors
  add column if not exists smartplace_review_url text;
