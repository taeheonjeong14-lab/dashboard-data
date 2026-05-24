-- Google Ads 일별 지표를 캠페인/광고그룹/키워드 단위까지 저장하도록 확장 (네이버 SearchAd와 동일 패턴)
-- 기존: (metric_date, hospital_id, customer_id) 계정 단위 1행
-- 변경: campaign/ad_group/keyword 컬럼 추가 + PK에 포함 → 다단계 행 저장

alter table analytics.analytics_googleads_daily_metrics
  add column if not exists campaign_id   text not null default '',
  add column if not exists campaign_name text,
  add column if not exists ad_group_id   text not null default '',
  add column if not exists ad_group_name text,
  add column if not exists keyword_id    text not null default '',
  add column if not exists keyword_name  text,
  add column if not exists conversions   numeric;

-- PK 재설정: 키워드 단위까지 구분 (drop if exists → add 라 재실행 안전)
alter table analytics.analytics_googleads_daily_metrics
  drop constraint if exists analytics_googleads_daily_metrics_pkey;
alter table analytics.analytics_googleads_daily_metrics
  add constraint analytics_googleads_daily_metrics_pkey
  primary key (metric_date, hospital_id, customer_id, campaign_id, ad_group_id, keyword_id);
