-- 건강검진(health_report) 리포트 가격 인하: 토큰 판매가(≈80원/토큰)는 그대로 두고,
-- 리포트가 소비하는 토큰을 원가 대비 80%로 낮춘다(할인 배수 0.8). 진료케이스 글쓰기 ×30 과 대칭인 배수 조정.
-- 배수 판정에 product 가 필요하므로 product 판정을 토큰 산출 앞으로 옮겼다.
-- 그 외 로직·환불 규칙(case_blog/admin_extract/survey 만 바른플랜 환불)은 직전 배포본과 동일.
-- ※ 앞으로 발생분만 적용(과거 차감 소급 없음). cost_usd 는 실제 원가 그대로 기록되고, tokens 만 할인 반영된다.
create or replace function billing.token_charge_operation(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_feature         text default null,
  p_token_value_usd numeric default 0.01,
  p_product         text default null
) returns table(tokens numeric, balance_after numeric, cost_usd numeric)
language plpgsql security definer as $$
declare
  v_cost          numeric;
  v_tokens        numeric;
  v_balance       numeric;
  v_is_case_write boolean;
  v_product       text;
  v_refund        boolean;
begin
  if p_hospital_id is null or p_operation_id is null then
    return;
  end if;
  if exists (select 1 from billing.token_ledger l where l.operation_id = p_operation_id and l.kind = 'charge') then
    return;
  end if;
  select coalesce(sum(u.cost_usd), 0) into v_cost
    from billing.llm_usage u
   where u.operation_id = p_operation_id and u.hospital_id = p_hospital_id::uuid;
  if v_cost <= 0 then
    return;
  end if;

  -- 상품 라벨: 명시값 우선, 없으면 피처에서 유추. 배수 판정에 쓰이므로 토큰 산출 전에 정한다.
  v_product := coalesce(
    p_product,
    case
      when p_feature like 'blog%' then 'case_blog'
      when p_feature in ('health_checkup','disease_intro') or p_feature like 'image%' then 'health_report'
      when p_feature = 'kakao_alimtalk' then 'survey'  -- 라벨 없는 알림톡 = 사전문진(건강검진은 항상 라벨을 붙임)
      else null
    end
  );

  v_is_case_write := p_feature in ('blog_causal', 'blog_detail', 'blog_outline', 'blog_post');
  v_tokens        := ceil(v_cost / nullif(p_token_value_usd, 0));
  if v_is_case_write then
    v_tokens := v_tokens * 30;              -- 진료케이스 글쓰기 단계 인건비 배율
  end if;
  if v_product = 'health_report' then
    v_tokens := ceil(v_tokens * 0.8);       -- 건강검진 리포트 가격 인하(원가 대비 80%)
  end if;
  if v_tokens <= 0 then
    return;
  end if;

  update core.hospitals
     set token_balance = coalesce(token_balance, 0) - v_tokens
   where id = p_hospital_id
   returning token_balance into v_balance;
  insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, product_code)
    values (p_hospital_id::uuid, p_operation_id, p_feature, v_cost, -v_tokens, v_balance, 'charge', v_product);

  -- 바른플랜 활성 기간 + (진료케이스 | admin 추출 | 사전문진) 이면 방금 차감분 즉시 환불(net 0).
  -- 건강검진(health_report) 및 product 없는 단계(assessment 등)는 유료 유지.
  if v_product in ('case_blog', 'admin_extract', 'survey') then
    select (h.barun_plan_enabled
            and (h.barun_plan_start is null or current_date >= h.barun_plan_start)
            and (h.barun_plan_end   is null or current_date <= h.barun_plan_end))
      into v_refund from core.hospitals h where h.id = p_hospital_id;
    if coalesce(v_refund, false) then
      update core.hospitals
         set token_balance = coalesce(token_balance, 0) + v_tokens
       where id = p_hospital_id
       returning token_balance into v_balance;
      insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, note, product_code)
        values (p_hospital_id::uuid, p_operation_id, p_feature, 0, v_tokens, v_balance, 'adjust', 'barun_plan_refund', v_product);
    end if;
  end if;

  return query select v_tokens, v_balance, v_cost;
end $$;

grant execute on function billing.token_charge_operation(text, uuid, text, numeric, text) to service_role;
