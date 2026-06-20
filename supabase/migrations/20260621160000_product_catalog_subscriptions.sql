-- 상품 메뉴판 + 구독(정액) 시스템 토대.
-- billing_type: 'subscription'(월 정액, 토큰 잔액에서 차감) | 'usage'(원가기반, 기존 방식)
-- 여러 패키지 확장 가능: products(카탈로그) + product_features(번들 구성) + subscriptions(병원별 상태)

-- 1) 상품 카탈로그
create table if not exists billing.products (
  code         text primary key,
  name         text not null,
  category     text,
  billing_type text not null check (billing_type in ('subscription', 'usage')),
  price_tokens numeric,                 -- subscription: 월 정액(토큰). usage: null(원가기반)
  period       text default 'monthly',  -- subscription 주기. 현재 monthly.
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2) 번들 구성 — 구독 상품이 풀어주는 기능들(게이팅 키)
create table if not exists billing.product_features (
  product_code text not null references billing.products(code) on delete cascade,
  feature_key  text not null,           -- 'dashboard' | 'competitor_analysis' | 'reception' | 'survey' ...
  primary key (product_code, feature_key)
);

-- 3) 병원별 구독 상태
--   status: active(갱신중) | canceled(취소-기간끝까지 사용) | lapsed(잔액부족/기간만료-차단)
--   접근권 = current_period_end > now() AND status <> 'lapsed'
create table if not exists billing.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  product_code  text not null references billing.products(code),
  status        text not null check (status in ('active', 'canceled', 'lapsed')),
  price_tokens  numeric not null,        -- 구독 시점 가격 스냅샷(이후 가격변경에 영향 안 받게)
  current_period_start timestamptz not null,
  current_period_end   timestamptz not null,
  auto_renew    boolean not null default true,
  canceled_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (hospital_id, product_code)
);
create index if not exists idx_subscriptions_hospital on billing.subscriptions (hospital_id);
create index if not exists idx_subscriptions_renew on billing.subscriptions (current_period_end) where status = 'active';

grant select, insert, update, delete on billing.products to service_role;
grant select, insert, update, delete on billing.product_features to service_role;
grant select, insert, update, delete on billing.subscriptions to service_role;
grant select on billing.products to authenticated;
grant select on billing.product_features to authenticated;
grant select on billing.subscriptions to authenticated;

-- 4) 초기 카탈로그 시드
insert into billing.products (code, name, category, billing_type, price_tokens, sort_order) values
  ('ops_bundle',    '운영 패키지',     '구독', 'subscription', 200, 10),
  ('health_report', '건강검진 리포트', '사용', 'usage',        null, 20),
  ('case_blog',     '진료케이스',      '사용', 'usage',        null, 30)
on conflict (code) do nothing;

-- 운영 패키지 번들 구성(경영대시보드·경쟁사분석·초진접수·사전문진)
insert into billing.product_features (product_code, feature_key) values
  ('ops_bundle', 'dashboard'),
  ('ops_bundle', 'competitor_analysis'),
  ('ops_bundle', 'reception'),
  ('ops_bundle', 'survey')
on conflict do nothing;
