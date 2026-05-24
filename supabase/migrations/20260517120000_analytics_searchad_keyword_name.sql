-- Add keyword_name column to SearchAd daily metrics for keyword-level collection

alter table if exists analytics.analytics_searchad_daily_metrics
  add column if not exists keyword_name text;
