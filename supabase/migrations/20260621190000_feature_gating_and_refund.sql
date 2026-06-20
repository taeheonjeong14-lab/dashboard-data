-- 기능 게이팅 wrapper + 번들 포함 기능 사용 환불.

-- 내 병원이 기능 접근권 있나(앱 노출). 바른플랜 OR 활성구독.
create or replace function core.my_has_feature(p_feature_key text)
returns boolean
language plpgsql security definer
set search_path = core, billing, public
as $$
declare v_hid text;
begin
  select hospital_id into v_hid from core.users where id::text = (auth.uid())::text;
  if v_hid is null then return false; end if;
  return billing.hospital_has_feature(v_hid::uuid, p_feature_key);
end $$;
grant execute on function core.my_has_feature(text) to authenticated;

-- 알림톡 과금 — 번들(구독/바른플랜)에 포함된 기능이면 차감분을 즉시 환불(net 0).
create or replace function core.charge_alimtalk_cost(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_cost_krw        numeric,
  p_run_id          uuid default null,
  p_token_value_usd numeric default 0.001,
  p_product         text default null
) returns void
language plpgsql security definer
set search_path = core, billing, public
as $func$
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
  if v_charged is not null and v_charged > 0 and p_product is not null
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
end $func$;
grant execute on function core.charge_alimtalk_cost(text, uuid, numeric, uuid, numeric, text) to service_role;
