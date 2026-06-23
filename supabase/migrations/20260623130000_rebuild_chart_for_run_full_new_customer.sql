-- 신규환자(new_customer_count) 업로드 순서 무관 보정.
--
-- 문제: 기존 rebuild_chart_for_run 은 일별 KPI를 "업로드 파일의 날짜 범위"만 재계산한다.
--   고객의 first_visit_date(최초 방문일)는 LEAST 업서트로 전역 최소값에 수렴하지만,
--   일별 신규환자 카운트는 그 업로드 범위만 다시 계산되므로, 과거 데이터를 나중에 올리면
--   먼저 올린 더 최근 기간의 신규환자가 보정되지 않아 이중 카운트된다.
--
-- 해결: 기존 재빌드를 그대로 수행한 뒤, 고객 마스터(first_visit_date) 기준으로
--   해당 병원·차트의 "전 구간" 신규환자 수를 다시 맞추는 래퍼 함수를 둔다.
--   신규환자는 작은 테이블(chart_customer_master)에서 산출되므로 전구간 재계산해도 부담이 없다.
--   매출·방문수는 기존 로직 그대로(무거운 raw 재스캔 없음).

create or replace function analytics.rebuild_chart_for_run_full(p_run_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = analytics, public, extensions
as $$
declare
  v_result jsonb;
  v_hospital_id text;
  v_chart_type text;
begin
  -- 1) 기존 재빌드(고객 마스터 갱신 + 매출·방문·해당 범위 KPI)
  v_result := analytics.rebuild_chart_for_run(p_run_id);

  -- 2) 신규환자 전 구간 보정 — 고객 마스터의 (전역) first_visit_date 로 일별 신규 카운트를 다시 맞춘다.
  select hospital_id, chart_type
    into v_hospital_id, v_chart_type
  from analytics.chart_upload_runs
  where id = p_run_id;

  if v_hospital_id is not null and v_chart_type is not null then
    with nc as (
      select first_visit_date as metric_date, count(*)::int as cnt
      from analytics.chart_customer_master
      where hospital_id = v_hospital_id
        and chart_type = v_chart_type
        and first_visit_date is not null
      group by first_visit_date
    )
    update analytics.chart_daily_kpis k
    set new_customer_count = coalesce(nc.cnt, 0)
    from analytics.chart_daily_kpis kk
    left join nc on nc.metric_date = kk.metric_date
    where kk.hospital_id = v_hospital_id
      and kk.chart_type = v_chart_type
      and k.hospital_id = kk.hospital_id
      and k.chart_type = kk.chart_type
      and k.metric_date = kk.metric_date
      and k.new_customer_count is distinct from coalesce(nc.cnt, 0);
  end if;

  return v_result;
end;
$$;

grant execute on function analytics.rebuild_chart_for_run_full(bigint) to service_role;

-- 기존 데이터 1회 보정: 모든 병원·차트의 일별 신규환자 수를 고객 마스터(first_visit_date) 기준으로 재산정.
-- (지난 out-of-order 업로드로 이중 카운트된 과거 KPI를 즉시 바로잡는다.)
with nc as (
  select hospital_id, chart_type, first_visit_date as metric_date, count(*)::int as cnt
  from analytics.chart_customer_master
  where first_visit_date is not null
  group by hospital_id, chart_type, first_visit_date
)
update analytics.chart_daily_kpis k
set new_customer_count = coalesce(nc.cnt, 0)
from analytics.chart_daily_kpis kk
left join nc
  on nc.hospital_id = kk.hospital_id
 and nc.chart_type = kk.chart_type
 and nc.metric_date = kk.metric_date
where k.hospital_id = kk.hospital_id
  and k.chart_type = kk.chart_type
  and k.metric_date = kk.metric_date
  and k.new_customer_count is distinct from coalesce(nc.cnt, 0);
