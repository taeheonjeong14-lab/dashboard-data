-- SearchAd 선택 수집: 특정 캠페인만 수집할 때 그 campaign_id 목록(jsonb 배열).
-- null/빈 배열이면 전체 캠페인 수집(기존 동작). collect-worker가 SEARCHAD_CAMPAIGN_IDS env로 넘긴다.
alter table analytics.collect_jobs
  add column if not exists searchad_campaign_ids jsonb;
