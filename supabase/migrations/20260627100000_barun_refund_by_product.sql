-- 바른플랜 환불 기준을 feature('blog%') → product('case_blog') 로 변경.
-- 의도: 진료케이스(case_blog)는 end-to-end 무료(차감→즉시 환불 net 0),
--       건강검진(health_report)은 end-to-end 유료(환불 없음).
-- 기존엔 환불이 feature LIKE 'blog%' 한정이라, 진료케이스의 PDF 추출/OCR(feature 'extract'/'ocr',
-- product 'case_blog')이 환불 누락되어 바른플랜인데도 토큰이 빠졌다. product 기준으로 바꾸면
-- 진료케이스에 새 단계가 추가돼도 case_blog 라벨만 달면 자동 면제된다.
-- ※ 앞으로 발생분만 적용(과거 누락분 소급 환불 없음). assessment(product 없음)는 유료 유지.
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

  v_is_case_write := p_feature in ('blog_causal', 'blog_detail', 'blog_outline', 'blog_post');
  v_tokens        := ceil(v_cost / nullif(p_token_value_usd, 0));
  if v_is_case_write then
    v_tokens := v_tokens * 30;
  end if;
  if v_tokens <= 0 then
    return;
  end if;

  -- 상품 라벨: 명시값 우선, 없으면 피처에서 유추(콘텐츠 차감).
  v_product := coalesce(
    p_product,
    case
      when p_feature like 'blog%' then 'case_blog'
      when p_feature in ('health_checkup','disease_intro') or p_feature like 'image%' then 'health_report'
      else null
    end
  );

  update core.hospitals
     set token_balance = coalesce(token_balance, 0) - v_tokens
   where id = p_hospital_id
   returning token_balance into v_balance;
  insert into billing.token_ledger(hospital_id, operation_id, feature, cost_usd, tokens, balance_after, kind, product_code)
    values (p_hospital_id::uuid, p_operation_id, p_feature, v_cost, -v_tokens, v_balance, 'charge', v_product);

  -- 바른플랜 활성 기간 + 진료케이스(product='case_blog')면 방금 차감분 즉시 환불(net 0).
  -- 건강검진(health_report) 및 product 없는 단계(assessment 등)는 유료 유지.
  if v_product = 'case_blog' then
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
