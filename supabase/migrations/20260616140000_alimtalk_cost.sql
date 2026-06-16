-- 알림톡 발송 비용(원) 기록 + 토큰 환산 과금.
-- 알리고 발송 응답 info.unitCost/totalCost(원)를 워커가 받아 outbox 에 저장하고,
-- core RPC 로 토큰 차감. 환산 기준: **1원 = 1토큰**.
-- 토큰 시스템은 cost_usd→토큰(ceil(cost_usd/토큰단가)) 으로 동작하므로,
-- cost_usd 를 (원금액 × 토큰단가) 로 기록하면 토큰 = 원금액 이 되어 정확히 1:1.
-- (billing 스키마를 PostgREST 에 노출하지 않아도 되도록 core 의 security definer 함수로 처리)

alter table health_report.alimtalk_outbox
  add column if not exists unit_cost  numeric,   -- 건당 단가(원)
  add column if not exists total_cost numeric;   -- 총액(원)

create or replace function core.charge_alimtalk_cost(
  p_hospital_id     text,
  p_operation_id    uuid,
  p_cost_krw        numeric,
  p_run_id          uuid default null,        -- 건강검진 리포트 run 에 귀속(토큰 내역에서 같이 묶임)
  p_token_value_usd numeric default 0.001
) returns void
language plpgsql
security definer
set search_path = core, billing, public
as $func$
declare
  v_cost_usd numeric;
begin
  if p_hospital_id is null or p_operation_id is null or p_cost_krw is null or p_cost_krw <= 0 then
    return;
  end if;
  -- 1원 = 1토큰: cost_usd = 원금액 × 토큰단가 → token_charge 가 ceil(cost_usd/토큰단가)=원금액 토큰 차감.
  v_cost_usd := round(p_cost_krw, 0) * p_token_value_usd;

  -- 중복 적재 방지(같은 발송 건 재처리 시)
  if exists (
    select 1 from billing.llm_usage u
    where u.operation_id = p_operation_id and u.feature = 'kakao_alimtalk'
  ) then
    return;
  end if;

  -- run_id 를 함께 적재 → my_usage_overview 의 run 단위 그룹핑에서 건강검진 건과 합쳐짐.
  insert into billing.llm_usage (hospital_id, feature, operation_id, run_id, provider, model, units, cost_usd)
    values (p_hospital_id::uuid, 'kakao_alimtalk', p_operation_id, p_run_id, 'aligo', 'alimtalk', 1, v_cost_usd);

  -- 토큰 차감. 이미 청구된 작업이면 RPC 가 무시(멱등).
  perform billing.token_charge_operation(p_hospital_id, p_operation_id, 'kakao_alimtalk', p_token_value_usd);
end $func$;

grant execute on function core.charge_alimtalk_cost(text, uuid, numeric, uuid, numeric) to service_role;
