-- Incremental migration: place keyword rank storage table

create schema if not exists analytics;

create table if not exists analytics.analytics_place_keyword_ranks (
  metric_date date not null,
  hospital_id text,
  keyword text not null,
  store_name text not null,
  section text not null default '플레이스',
  metric_key text not null default 'place_rank_integrated',
  rank_value integer,
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  primary key (metric_date, keyword, store_name, section, metric_key)
);

create index if not exists idx_place_keyword_ranks_metric_date
  on analytics.analytics_place_keyword_ranks (metric_date desc, keyword, store_name);

grant select, insert, update on table analytics.analytics_place_keyword_ranks to service_role;
grant select on table analytics.analytics_place_keyword_ranks to authenticated;

alter table analytics.analytics_place_keyword_ranks enable row level security;

drop policy if exists "place_keyword_ranks_select_assigned_hospitals" on analytics.analytics_place_keyword_ranks;
create policy "place_keyword_ranks_select_assigned_hospitals"
  on analytics.analytics_place_keyword_ranks
  for select
  to authenticated
  using (
    exists (
      select 1
      from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or (
            analytics_place_keyword_ranks.hospital_id is not null
            and u.hospital_id = analytics_place_keyword_ranks.hospital_id
          )
        )
    )
  );
