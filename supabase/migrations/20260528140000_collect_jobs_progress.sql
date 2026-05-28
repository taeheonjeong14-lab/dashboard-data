-- 수집 잡의 단계별 진행률(progress bar 용).
-- 형태: { "<step_key>": { "done": int, "total": int, "label": text, "updatedAt": iso } }
-- step_key: blog_metrics / smartplace / keyword_rank / searchad
alter table if exists analytics.collect_jobs
  add column if not exists progress jsonb not null default '{}'::jsonb;
