-- 바른플랜 환불 대상에 사전문진(product='survey')을 추가한다.
--
-- 배경: 사전문진 알림톡 발송 비용(1원=1토큰)은 워커가 core.charge_alimtalk_cost 로 차감하고,
--   그 함수는 outbox.product_code 를 p_product 로 넘긴다. 그런데 hospital-web 의 사전문진 발송이
--   outbox 에 product_code 를 넣지 않아 v_product=null 이 되었고, 환불 조건(product 기준)에서 빠져
--   바른플랜 병원인데도 알림톡 토큰이 그대로 차감됐다. (건강검진 발송은 'health_report' 를 넣는다)
--
-- 정책(2026-07-13 확정):
--   - 사전문진(survey) 알림톡: 바른플랜이면 net 0(차감 즉시 환불).
--   - 진료케이스(case_blog) · admin 추출(admin_extract): 종전대로 net 0.
--   - 건강검진(health_report): 바른플랜이어도 과금 유지.
--
-- 안전장치: 앱이 라벨을 안 붙이고 부르는 옛 배포본이 남아 있어도 새는 걸 막기 위해,
--   feature='kakao_alimtalk' 인데 product 가 없으면 'survey' 로 간주한다.
--   (알림톡 중 상품 라벨이 붙는 건 건강검진뿐이고, 그건 항상 'health_report' 를 명시한다)
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
      when p_feature = 'kakao_alimtalk' then 'survey'  -- 라벨 없는 알림톡 = 사전문진(건강검진은 항상 라벨을 붙임)
      else null
    end
  );

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

-- 상품 카탈로그에 사전문진을 등록(사용량 화면 라벨용). 번들 기능 'survey' 와 코드가 같다.
insert into billing.products (code, name, category, billing_type, price_tokens, sort_order) values
  ('survey', '사전문진', '사용', 'usage', null, 40)
on conflict (code) do nothing;
