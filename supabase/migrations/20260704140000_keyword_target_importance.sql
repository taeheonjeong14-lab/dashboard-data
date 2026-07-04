-- Incremental migration (idempotent): 키워드 타깃(블로그/플레이스)에 중요도(importance) 추가.
-- High/Medium/Low. 기존 행은 'medium' 기본값.
-- (참고: 과거 priority 컬럼은 20260421190000 에서 제거됨 — 용도가 다른 별개 컬럼)

alter table if exists analytics.analytics_blog_keyword_targets
  add column if not exists importance text not null default 'medium';
alter table if exists analytics.analytics_place_keyword_targets
  add column if not exists importance text not null default 'medium';

alter table if exists analytics.analytics_blog_keyword_targets
  drop constraint if exists analytics_blog_keyword_targets_importance_chk;
alter table if exists analytics.analytics_blog_keyword_targets
  add constraint analytics_blog_keyword_targets_importance_chk
  check (importance in ('high', 'medium', 'low'));

alter table if exists analytics.analytics_place_keyword_targets
  drop constraint if exists analytics_place_keyword_targets_importance_chk;
alter table if exists analytics.analytics_place_keyword_targets
  add constraint analytics_place_keyword_targets_importance_chk
  check (importance in ('high', 'medium', 'low'));
