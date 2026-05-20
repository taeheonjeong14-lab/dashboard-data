-- 토큰 시스템: 사용자별 잔액 + 거래원장(ledger) + 원자적 grant/deduct 함수
-- 정책: 1토큰=100원(표시용), 음수 잔액 불가. 건강검진 리포트 1건 = 50토큰 차감.

-- 1) 사용자별 잔액 (가산적 — 기존 행에 영향 없음)
alter table core.users add column if not exists token_balance integer not null default 0;

-- 2) 거래 원장
create table if not exists core.token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users (id) on delete cascade,
  hospital_id uuid,
  delta integer not null,
  balance_after integer not null,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_token_ledger_user
  on core.token_ledger (user_id, created_at desc);

-- 3) 토큰 지급 (관리자): 원자적 가산 + 원장 기록
create or replace function core.token_grant(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_created_by uuid
) returns integer
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  update core.users set token_balance = token_balance + p_amount
    where id = p_user_id
    returning token_balance into v_balance;
  if v_balance is null then
    raise exception 'user not found';
  end if;
  insert into core.token_ledger (user_id, delta, balance_after, reason, created_by)
    values (p_user_id, p_amount, v_balance, p_reason, p_created_by);
  return v_balance;
end;
$$;

-- 4) 토큰 차감 (리포트 등): 잔액 부족 시 'insufficient_balance' 예외 → 음수 불가
create or replace function core.token_deduct(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_hospital_id uuid
) returns integer
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  update core.users set token_balance = token_balance - p_amount
    where id = p_user_id and token_balance >= p_amount
    returning token_balance into v_balance;
  if v_balance is null then
    raise exception 'insufficient_balance';
  end if;
  insert into core.token_ledger (user_id, hospital_id, delta, balance_after, reason)
    values (p_user_id, p_hospital_id, -p_amount, v_balance, p_reason);
  return v_balance;
end;
$$;

grant execute on function core.token_grant(uuid, integer, text, uuid) to service_role;
grant execute on function core.token_deduct(uuid, integer, text, uuid) to service_role;
grant select on table core.token_ledger to service_role, authenticated;
