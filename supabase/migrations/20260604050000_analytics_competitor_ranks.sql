-- 경쟁 병원 키워드 순위 저장(블로그/플레이스 공통).
-- 우리 병원 순위는 기존 테이블(account_id/store 기준)에 저장되지만,
-- 경쟁사는 소유 hospital 이 없어 별도 테이블에 (우리 hospital_id + slot) 기준으로 저장한다.

create schema if not exists analytics;

create table if not exists analytics.analytics_competitor_ranks (
  hospital_id text not null,         -- 이 경쟁사를 등록한 우리 병원
  slot smallint not null,            -- 경쟁사 슬롯 1~3 (analytics_hospital_competitors.slot)
  channel text not null,             -- 'blog' | 'place'
  metric_date date not null,
  keyword text not null,
  rank_value integer,                -- 순위(없으면 null = 미노출)
  name text,                         -- 경쟁사 상호명 스냅샷
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  primary key (hospital_id, slot, channel, metric_date, keyword)
);

create index if not exists idx_competitor_ranks_lookup
  on analytics.analytics_competitor_ranks (hospital_id, channel, metric_date desc, keyword);

alter table analytics.analytics_competitor_ranks
  drop constraint if exists analytics_competitor_ranks_channel_chk;
alter table analytics.analytics_competitor_ranks
  add constraint analytics_competitor_ranks_channel_chk
  check (channel in ('blog', 'place'));

grant select, insert, update on table analytics.analytics_competitor_ranks to service_role;
grant select on table analytics.analytics_competitor_ranks to authenticated;

alter table analytics.analytics_competitor_ranks enable row level security;

drop policy if exists "competitor_ranks_select_assigned" on analytics.analytics_competitor_ranks;
create policy "competitor_ranks_select_assigned"
  on analytics.analytics_competitor_ranks
  for select
  to authenticated
  using (
    exists (
      select 1
      from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or u.hospital_id = analytics_competitor_ranks.hospital_id
        )
    )
  );
