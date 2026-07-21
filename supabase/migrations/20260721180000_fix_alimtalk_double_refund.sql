-- 사전문진(survey) 알림톡 이중환불 버그 수정.
-- 원인: charge_alimtalk_cost 가 token_charge_operation 을 호출 → survey 는 그 안에서 바른플랜이면
--       barun_plan_refund(+) 가 이미 발동한다. 그런데 charge_alimtalk_cost 는 그 뒤에 번들 환불
--       (bundle_covered_refund)을 또 발동시키는데, 바른플랜은 hospital_has_feature 가 모든 키에 true 라
--       두 환불이 겹쳐 net +토큰(병원이 토큰 획득)이 됐다.
-- 수정: 번들 환불 전에 "이 operation 이 이미 환불(adjust)됐는지" 가드를 추가해 한 메커니즘만 발동하게 한다.
--   - 바른플랜: token_charge_operation 이 이미 환불 → 번들 환불 스킵 → net 0
--   - 비바른플랜 + 번들 구독: 앞선 환불 없음 → 번들 환불 1회 → net 0
--   - 비바른플랜 + 미구독: 환불 없음 → 유료
-- ※ 앞으로 발생분만. 과거 이중환불분은 소급 정정하지 않는다(이전 방침과 일관).
create or replace function core.charge_alimtalk_cost(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_cost_krw        numeric,
  p_run_id          uuid default null,
  p_token_value_usd numeric default 0.001,
  p_product         text default null
) returns void
language plpgsql security definer
set search_path to 'core', 'billing', 'public'
as $function$
declare
  v_cost_usd numeric;
  v_charged  numeric;
  v_bal      numeric;
begin
  if p_hospital_id is null or p_operation_id is null or p_cost_krw is null or p_cost_krw <= 0 then
    return;
  end if;
  v_cost_usd := round(p_cost_krw, 0) * p_token_value_usd;
  if exists (select 1 from billing.llm_usage u where u.operation_id = p_operation_id and u.feature = 'kakao_alimtalk') then
    return;
  end if;
  insert into billing.llm_usage (hospital_id, feature, operation_id, run_id, provider, model, units, cost_usd)
    values (p_hospital_id::uuid, 'kakao_alimtalk', p_operation_id, p_run_id, 'aligo', 'alimtalk', 1, v_cost_usd);

  select tokens, balance_after into v_charged, v_bal
    from billing.token_charge_operation(p_hospital_id, p_operation_id, 'kakao_alimtalk', p_token_value_usd, p_product);

  -- 번들 구독/바른플랜에 포함된 기능(예: 사전문진)이면 방금 차감분 환불.
  -- ⚠ p_product 가 '구독 번들에 속한 기능'일 때만 — 바른플랜은 hospital_has_feature 가 모든 키에 true 라
  --   가드 없이 쓰면 건강검진 리포트(usage) 알림톡까지 환불됨.
  -- ⚠ 이미 환불(adjust)된 operation 이면 스킵 — token_charge_operation 의 barun_plan_refund 와의 이중환불 방지.
  if v_charged is not null and v_charged > 0 and p_product is not null
     and not exists (
       select 1 from billing.token_ledger l
        where l.operation_id = p_operation_id and l.kind = 'adjust'
     )
     and exists (
       select 1 from billing.product_features pf
         join billing.products pr on pr.code = pf.product_code
        where pf.feature_key = p_product and pr.billing_type = 'subscription' and pr.active
     )
     and billing.hospital_has_feature(p_hospital_id::uuid, p_product) then
    update core.hospitals set token_balance = coalesce(token_balance, 0) + v_charged
     where id = p_hospital_id returning token_balance into v_bal;
    insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, note, product_code)
      values (p_hospital_id::uuid, p_operation_id, 'kakao_alimtalk', 0, v_charged, v_bal, 'adjust', 'bundle_covered_refund', p_product);
  end if;
end $function$;
