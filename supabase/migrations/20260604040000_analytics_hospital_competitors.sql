-- 병원별 경쟁 병원 등록(최대 3개). 경쟁사 순위 비교용.
-- name(상호명) = 플레이스 순위 매칭 + 표시, naver_blog_id = 블로그 순위 매칭.

create schema if not exists analytics;

create table if not exists analytics.analytics_hospital_competitors (
  hospital_id text not null,
  slot smallint not null check (slot between 1 and 3),
  name text not null,             -- 경쟁사 상호명(네이버 플레이스 표기 그대로)
  naver_blog_id text,             -- 경쟁사 네이버 블로그 ID
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (hospital_id, slot)
);

create index if not exists idx_hospital_competitors_hospital
  on analytics.analytics_hospital_competitors (hospital_id, slot);

create or replace function analytics.hospital_competitors_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_hospital_competitors_updated_at on analytics.analytics_hospital_competitors;
create trigger trg_hospital_competitors_updated_at
  before update on analytics.analytics_hospital_competitors
  for each row execute function analytics.hospital_competitors_touch_updated_at();

grant select, insert, update, delete on table analytics.analytics_hospital_competitors to service_role;
grant select on table analytics.analytics_hospital_competitors to authenticated;

alter table analytics.analytics_hospital_competitors enable row level security;

drop policy if exists "hospital_competitors_select_assigned" on analytics.analytics_hospital_competitors;
create policy "hospital_competitors_select_assigned"
  on analytics.analytics_hospital_competitors
  for select
  to authenticated
  using (
    exists (
      select 1
      from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or u.hospital_id = analytics_hospital_competitors.hospital_id
        )
    )
  );
