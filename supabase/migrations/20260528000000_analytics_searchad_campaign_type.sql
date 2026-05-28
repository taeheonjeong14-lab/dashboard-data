-- SearchAd 캠페인 유형(파워링크/플레이스 등) 저장용 컬럼.
-- 네이버 /ncc/campaigns 의 campaignTp 값(WEB_SITE / PLACE / SHOPPING / ...)을 그대로 저장.
-- 기존 행은 NULL → 재수집 시 채워짐.
alter table if exists analytics.analytics_searchad_daily_metrics
  add column if not exists campaign_type text;
