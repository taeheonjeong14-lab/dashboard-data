-- 바른반려연구소 플랜: 진료케이스도 평소처럼 차감(×20)하되, 플랜 활성 기간이면 그 즉시 같은 양을 환불한다.
-- (차감·환불 둘 다 원장에 기록 → 숨기지 않음. 잔액 순효과 0. 진료케이스 작성 단계에 한해서만.)
-- 이전(130000)의 '0 차감 면제' 방식을 대체한다.
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
  v_is_case boolean;
  v_refund  boolean;
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

  v_is_case := p_feature in ('blog_causal', 'blog_detail', 'blog_outline', 'blog_post');
  v_tokens  := ceil(v_cost / nullif(p_token_value_usd, 0));
  if v_is_case then
    v_tokens := v_tokens * 20; -- 진료케이스 작성 단계 인건비 반영
  end if;
  if v_tokens <= 0 then
    return;
  end if;

  -- 정상 차감
  update core.hospitals
     set token_balance = coalesce(token_balance, 0) - v_tokens
   where id = p_hospital_id
   returning token_balance into v_balance;
  insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind)
    values (p_hospital_id::uuid, p_operation_id, p_feature, v_cost, -v_tokens, v_balance, 'charge');

  -- 바른플랜 활성 기간 + 진료케이스면 방금 차감분을 즉시 환불(기록 남김).
  if v_is_case then
    select (h.barun_plan_enabled
            and (h.barun_plan_start is null or current_date >= h.barun_plan_start)
            and (h.barun_plan_end   is null or current_date <= h.barun_plan_end))
      into v_refund
      from core.hospitals h
     where h.id = p_hospital_id;
    if coalesce(v_refund, false) then
      update core.hospitals
         set token_balance = coalesce(token_balance, 0) + v_tokens
       where id = p_hospital_id
       returning token_balance into v_balance;
      insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, note)
        values (p_hospital_id::uuid, p_operation_id, p_feature, 0, v_tokens, v_balance, 'adjust', 'barun_plan_refund');
    end if;
  end if;

  return query select v_tokens, v_balance, v_cost;
end $$;

grant execute on function billing.token_charge_operation(text, uuid, text, numeric) to service_role;
