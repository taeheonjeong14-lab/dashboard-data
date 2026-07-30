-- Meta(인스타그램/페이스북) 광고 수집 — 병원 매핑 + 일별 성과 + 전환(제너릭) (멱등)
--
-- 설계 메모:
--  · Google Ads 는 병원마다 OAuth 동의를 따로 받아 refresh token 을 hospitals 행에 병원별로 둔다.
--    Meta 는 대행 구조라 **한 사람(대행사 계정)이 모든 광고계정 관리자**여서 토큰이 1개면 된다.
--    → 토큰은 hospitals 가 아니라 단일 행 credentials 테이블에 두고, 병원 구분은 ad_account_id 로 한다.
--  · 전환은 병원마다 이벤트가 달라 컬럼으로 못 박을 수 없다(탐침 결과 한 계정에서만 22종).
--    → action_type 을 **문자열 그대로** 저장하는 세로형 테이블. 새 전환이 생겨도 스키마 불변.
--  · 같은 행동을 다르게 센 파생 지표가 섞여 온다(post_engagement ⊃ post_reaction …).
--    합산하면 부풀려지므로 **원본을 전부 적재하고 표시할 것만 화면에서 고른다.**

create schema if not exists analytics;

-- 1) 병원 ↔ Meta 광고계정 매핑 (Google Ads 와 같은 자리에 둬서 admin 병원 관리에서 함께 입력)
alter table core.hospitals
  add column if not exists meta_ad_account_id text,
  add column if not exists meta_is_active boolean not null default false,
  add column if not exists meta_last_synced_at timestamptz;

-- 2) 공용 액세스 토큰 (단일 행). 비밀이므로 service_role 만 접근 — authenticated 에 grant 하지 않는다.
--    60일 사용자 토큰은 만료 전 교환으로 갱신되며, 수집기가 이 행을 직접 갱신해 무인 운영한다.
--    System User 토큰(무기한)으로 갈아끼우면 만료 검사는 자연히 no-op 이 된다.
create table if not exists analytics.analytics_meta_credentials (
  id text primary key default 'default',
  access_token text,
  token_expires_at timestamptz,
  app_id text,
  note text,
  updated_at timestamptz not null default now()
);

-- 3) 일별 광고 성과 (ad 레벨. 캠페인·광고세트 이름을 함께 담아 상위 롤업은 조회로 처리)
create table if not exists analytics.analytics_meta_ads_daily (
  metric_date date not null,
  hospital_id text not null,
  ad_account_id text not null,
  campaign_id text not null default '',
  campaign_name text,
  adset_id text not null default '',
  adset_name text,
  ad_id text not null default '',
  ad_name text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  reach bigint not null default 0,
  spend numeric(14, 2) not null default 0,
  currency text,
  raw_payload jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  primary key (metric_date, hospital_id, ad_account_id, ad_id)
);

-- 4) 일별 전환/액션 (세로형). action_count/action_value 로 이름 지어 count 예약어 혼동을 피한다.
create table if not exists analytics.analytics_meta_ads_conversions_daily (
  metric_date date not null,
  hospital_id text not null,
  ad_account_id text not null,
  ad_id text not null default '',
  action_type text not null,
  action_count numeric not null default 0,
  action_value numeric,
  collected_at timestamptz not null default now(),
  primary key (metric_date, hospital_id, ad_account_id, ad_id, action_type)
);

create or replace function analytics.meta_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_meta_credentials_updated_at on analytics.analytics_meta_credentials;
create trigger trg_meta_credentials_updated_at
  before update on analytics.analytics_meta_credentials
  for each row
  execute function analytics.meta_touch_updated_at();

create index if not exists idx_meta_ads_daily_hospital_date
  on analytics.analytics_meta_ads_daily (hospital_id, metric_date desc);
create index if not exists idx_meta_ads_daily_account_date
  on analytics.analytics_meta_ads_daily (ad_account_id, metric_date desc);
create index if not exists idx_meta_ads_conv_hospital_date
  on analytics.analytics_meta_ads_conversions_daily (hospital_id, metric_date desc);
-- 전환 종류별 추이(대표 지표 몇 개만 골라 그리는 화면) 조회용
create index if not exists idx_meta_ads_conv_type
  on analytics.analytics_meta_ads_conversions_daily (hospital_id, action_type, metric_date desc);

grant select, insert, update on table analytics.analytics_meta_ads_daily to service_role;
grant select, insert, update on table analytics.analytics_meta_ads_conversions_daily to service_role;
grant select, insert, update, delete on table analytics.analytics_meta_credentials to service_role;
grant select on table analytics.analytics_meta_ads_daily to authenticated;
grant select on table analytics.analytics_meta_ads_conversions_daily to authenticated;
-- analytics_meta_credentials 는 authenticated 에 grant 하지 않는다(토큰).

alter table analytics.analytics_meta_ads_daily enable row level security;
alter table analytics.analytics_meta_ads_conversions_daily enable row level security;
alter table analytics.analytics_meta_credentials enable row level security;

-- 병원 유저는 자기 병원 행만, admin 은 전체. (googleads 정책과 동일 형태)
drop policy if exists "meta_ads_daily_select_assigned_hospitals" on analytics.analytics_meta_ads_daily;
create policy "meta_ads_daily_select_assigned_hospitals"
  on analytics.analytics_meta_ads_daily
  for select
  to authenticated
  using (
    exists (
      select 1
      from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or u.hospital_id = analytics_meta_ads_daily.hospital_id
        )
    )
  );

drop policy if exists "meta_ads_conv_select_assigned_hospitals" on analytics.analytics_meta_ads_conversions_daily;
create policy "meta_ads_conv_select_assigned_hospitals"
  on analytics.analytics_meta_ads_conversions_daily
  for select
  to authenticated
  using (
    exists (
      select 1
      from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or u.hospital_id = analytics_meta_ads_conversions_daily.hospital_id
        )
    )
  );

-- credentials 는 정책을 만들지 않는다 → authenticated 는 RLS 로도 한 행도 못 본다(service_role 은 RLS 우회).
