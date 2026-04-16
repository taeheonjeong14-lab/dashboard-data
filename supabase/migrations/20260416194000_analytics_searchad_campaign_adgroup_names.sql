-- Incremental migration: add campaign/adgroup name columns for SearchAd metrics

alter table if exists analytics.analytics_searchad_daily_metrics
  add column if not exists campaign_name text;

alter table if exists analytics.analytics_searchad_daily_metrics
  add column if not exists adgroup_name text;
