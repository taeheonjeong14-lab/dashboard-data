-- Incremental migration: split blog/smartplace daily metrics into separate tables

create schema if not exists analytics;

create table if not exists analytics.analytics_blog_daily_metrics (
  account_id text not null,
  hospital_id text,
  hospital_name text,
  metric_date date not null,
  blog_views bigint,
  blog_unique_visitors bigint,
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  primary key (account_id, metric_date)
);

create table if not exists analytics.analytics_smartplace_daily_metrics (
  account_id text not null,
  hospital_id text,
  hospital_name text,
  metric_date date not null,
  smartplace_inflow bigint,
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  primary key (account_id, metric_date)
);

grant select, insert, update on table analytics.analytics_blog_daily_metrics to service_role;
grant select on table analytics.analytics_blog_daily_metrics to authenticated;
grant select, insert, update on table analytics.analytics_smartplace_daily_metrics to service_role;
grant select on table analytics.analytics_smartplace_daily_metrics to authenticated;

alter table analytics.analytics_blog_daily_metrics enable row level security;
alter table analytics.analytics_smartplace_daily_metrics enable row level security;

drop policy if exists "blog_daily_metrics_select_assigned_hospitals" on analytics.analytics_blog_daily_metrics;
create policy "blog_daily_metrics_select_assigned_hospitals"
  on analytics.analytics_blog_daily_metrics
  for select
  to authenticated
  using (
    exists (
      select 1
      from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or u.hospital_id = analytics_blog_daily_metrics.hospital_id
        )
    )
  );

drop policy if exists "smartplace_daily_metrics_select_assigned_hospitals" on analytics.analytics_smartplace_daily_metrics;
create policy "smartplace_daily_metrics_select_assigned_hospitals"
  on analytics.analytics_smartplace_daily_metrics
  for select
  to authenticated
  using (
    exists (
      select 1
      from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or u.hospital_id = analytics_smartplace_daily_metrics.hospital_id
        )
    )
  );
