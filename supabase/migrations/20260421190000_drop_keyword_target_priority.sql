-- Remove priority from keyword target tables (blog/place).
-- Input ordering is no longer managed by explicit priority.

alter table if exists analytics.analytics_blog_keyword_targets
  drop column if exists priority;

alter table if exists analytics.analytics_place_keyword_targets
  drop column if exists priority;

drop index if exists analytics.idx_blog_keyword_targets_active;
create index if not exists idx_blog_keyword_targets_active
  on analytics.analytics_blog_keyword_targets (is_active, account_id, keyword);

drop index if exists analytics.idx_place_keyword_targets_active;
create index if not exists idx_place_keyword_targets_active
  on analytics.analytics_place_keyword_targets (is_active, hospital_id, keyword);
