-- 과금 2단계: 사용량(USD) → 자체 토큰 환산 + 병원별 잔액 차감.
-- 1토큰 = $0.10 (원가 1:1). 작업(operation) 단위로 합산 후 정수 올림(최소 1토큰), 실시간 차감, 잔액 0이면 차단.

-- 1) 병원별 토큰 잔액
alter table core.hospitals add column if not exists token_balance numeric not null default 0;

-- 2) usage 행에 작업(operation) 태그 — 한 작업의 여러 LLM 호출을 묶어 합산 청구.
alter table billing.llm_usage add column if not exists operation_id uuid;
create index if not exists idx_llm_usage_operation on billing.llm_usage (operation_id);

-- 3) 토큰 원장(차감·지급 이력)
create table if not exists billing.token_ledger (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  operation_id  uuid,                 -- charge: 작업 id / grant·adjust: null
  feature       text,
  cost_usd      numeric(12,6),
  tokens        numeric not null,     -- 델타: charge 는 음수, grant/adjust 는 양수
  balance_after numeric,
  kind          text not null check (kind in ('charge', 'grant', 'adjust')),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_token_ledger_hospital_created on billing.token_ledger (hospital_id, created_at desc);
-- 한 작업은 한 번만 청구
create unique index if not exists uq_token_ledger_charge_operation
  on billing.token_ledger (operation_id) where kind = 'charge';

grant select, insert, update on billing.token_ledger to service_role;
grant select on billing.token_ledger to authenticated;

-- 4) 작업 단위 토큰 차감: 그 operation 의 usage 합산원가 → ceil($합계/단가), 최소 1, 병원 잔액에서 차감.
--    이미 청구된 작업이면 재청구하지 않음(멱등). 비용 0이면 청구 없음.
-- core.hospitals.id 가 text 이므로 p_hospital_id 는 text 로 받고, uuid 컬럼(billing.*)엔 ::uuid 캐스트.
create or replace function billing.token_charge_operation(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_feature         text default null,
  p_token_value_usd numeric default 0.10
) returns table(tokens integer, balance_after numeric, cost_usd numeric)
language plpgsql security definer as $$
declare
  v_cost    numeric;
  v_tokens  integer;
  v_balance numeric;
begin
  if p_hospital_id is null or p_operation_id is null then
    return;
  end if;
  if exists (select 1 from billing.token_ledger l where l.operation_id = p_operation_id and l.kind = 'charge') then
    return; -- 이미 청구됨
  end if;
  select coalesce(sum(u.cost_usd), 0) into v_cost
    from billing.llm_usage u
   where u.operation_id = p_operation_id and u.hospital_id = p_hospital_id::uuid;
  if v_cost <= 0 then
    return; -- 비용 없음
  end if;
  v_tokens := ceil(v_cost / nullif(p_token_value_usd, 0))::integer;
  if v_tokens < 1 then v_tokens := 1; end if;

  update core.hospitals
     set token_balance = coalesce(token_balance, 0) - v_tokens
   where id = p_hospital_id
   returning token_balance into v_balance;

  insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind)
    values (p_hospital_id::uuid, p_operation_id, p_feature, v_cost, -v_tokens, v_balance, 'charge');

  return query select v_tokens, v_balance, v_cost;
end $$;

-- 5) 토큰 지급/충전(양수)·조정. admin 에서 호출.
create or replace function billing.token_grant(
  p_hospital_id text,
  p_tokens      integer,
  p_note        text default null,
  p_kind        text default 'grant'
) returns numeric
language plpgsql security definer as $$
declare
  v_balance numeric;
begin
  if p_hospital_id is null or p_tokens is null or p_tokens = 0 then
    return null;
  end if;
  update core.hospitals
     set token_balance = coalesce(token_balance, 0) + p_tokens
   where id = p_hospital_id
   returning token_balance into v_balance;
  insert into billing.token_ledger(hospital_id, feature, tokens, balance_after, kind, note)
    values (p_hospital_id::uuid, null, p_tokens, v_balance, case when p_kind = 'adjust' then 'adjust' else 'grant' end, p_note);
  return v_balance;
end $$;

grant execute on function billing.token_charge_operation(text, uuid, text, numeric) to service_role;
grant execute on function billing.token_grant(text, integer, text, text) to service_role;
