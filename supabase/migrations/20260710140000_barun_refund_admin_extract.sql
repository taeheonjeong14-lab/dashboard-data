-- 바른플랜 환불 대상에 admin 추출(product='admin_extract')을 추가한다.
--
-- 배경: 추출 차감(feature='extract')의 환불 여부는 product 로 판단하는데, product 는 호출자가 넘긴다.
--   - hospital-web(processExtractJob): job.kind 로 'case_blog' | 'health_report' 를 넘긴다 → 환불 정상.
--   - admin-web(chart-extraction): product 를 아예 안 넘겼다 → v_product=null → 환불 누락.
-- feature 'extract' 는 'blog%' 에도 health 목록에도 안 걸려 유추도 실패한다.
-- 그 결과 바른플랜 병원이 admin 경로로 추출할 때마다 토큰이 빠졌고, 잔액이 음수까지 내려갔다.
--
-- 정책(2026-07-10 확정):
--   - admin 추출은 상품을 알 수 없다(진료케이스가 될지 건강검진이 될지 추출 시점엔 미정).
--     바른플랜 병원이면 항상 net 0 으로 둔다 → product='admin_extract'.
--   - 진료케이스(case_blog) 는 종전대로 net 0.
--   - 건강검진(health_report) 생성 토큰은 바른플랜이어도 과금 유지.
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

  -- 바른플랜 활성 기간 + (진료케이스 | admin 추출) 이면 방금 차감분 즉시 환불(net 0).
  -- 건강검진(health_report) 및 product 없는 단계(assessment 등)는 유료 유지.
  if v_product in ('case_blog', 'admin_extract') then
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
