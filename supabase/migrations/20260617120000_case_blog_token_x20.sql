-- 진료케이스 작성 단계(인과흐름·진단치료세부·아웃라인·블로그글)는 사람 손(검수·수정)이 많이 타
-- 인건비를 토큰에 녹인다 → 해당 feature 의 차감 토큰을 20배로. (다른 feature 는 그대로 1배)
-- 시그니처 동일 → create or replace 로 본문만 교체. (20260615120000 ceil 버전 기반 + 배율)
create or replace function billing.token_charge_operation(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_feature         text default null,
  p_token_value_usd numeric default 0.01
) returns table(tokens numeric, balance_after numeric, cost_usd numeric)
language plpgsql security definer as $$
declare
  v_cost    numeric;
  v_tokens  numeric;
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
  -- 정수 올림. v_cost > 0 이므로 최소 1토큰.
  v_tokens := ceil(v_cost / nullif(p_token_value_usd, 0));
  -- 진료케이스 작성 단계는 인건비 반영 → 20배 과금.
  if p_feature in ('blog_causal', 'blog_detail', 'blog_outline', 'blog_post') then
    v_tokens := v_tokens * 20;
  end if;
  if v_tokens <= 0 then
    return;
  end if;

  update core.hospitals
     set token_balance = coalesce(token_balance, 0) - v_tokens
   where id = p_hospital_id
   returning token_balance into v_balance;

  insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind)
    values (p_hospital_id::uuid, p_operation_id, p_feature, v_cost, -v_tokens, v_balance, 'charge');

  return query select v_tokens, v_balance, v_cost;
end $$;

grant execute on function billing.token_charge_operation(text, uuid, text, numeric) to service_role;
