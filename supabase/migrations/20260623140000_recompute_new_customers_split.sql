-- 신규환자 보정을 rebuild_chart_for_run 과 분리한다.
-- 이유: 둘을 한 statement(rebuild_chart_for_run_full)로 묶으면 합산 시간이 DB 기본 statement_timeout 을
--       넘겨 57014(canceling statement due to statement timeout)가 난다.
-- 해결: 신규환자 보정만 하는 가벼운 함수를 따로 두고, 업로드 파이프라인이 rebuild 직후 별도 호출한다.
--       함수 자체에 statement_timeout 을 넉넉히 둬서 보정 단계가 기본 제한에 안 걸리게 한다.

create or replace function analytics.recompute_new_customers_for_run(p_run_id bigint)
returns void
language plpgsql
security definer
set search_path = analytics, public, extensions
set statement_timeout = '120s'
as $$
declare
  v_hospital_id text;
  v_chart_type text;
begin
  select hospital_id, chart_type
    into v_hospital_id, v_chart_type
  from analytics.chart_upload_runs
  where id = p_run_id;

  if v_hospital_id is null or v_chart_type is null then
    return;
  end if;

  -- (1) 첫방문일에 해당하는 날의 신규환자 수를 고객 마스터 기준으로 맞춘다.
  with nc as (
    select first_visit_date as metric_date, count(*)::int as cnt
    from analytics.chart_customer_master
    where hospital_id = v_hospital_id
      and chart_type = v_chart_type
      and first_visit_date is not null
    group by first_visit_date
  )
  update analytics.chart_daily_kpis k
  set new_customer_count = nc.cnt
  from nc
  where k.hospital_id = v_hospital_id
    and k.chart_type = v_chart_type
    and k.metric_date = nc.metric_date
    and k.new_customer_count is distinct from nc.cnt;

  -- (2) 더 이상 누구의 첫방문일도 아닌 날(과거 값이 남은 날)을 0 으로 정리.
  update analytics.chart_daily_kpis k
  set new_customer_count = 0
  where k.hospital_id = v_hospital_id
    and k.chart_type = v_chart_type
    and k.new_customer_count <> 0
    and not exists (
      select 1
      from analytics.chart_customer_master m
      where m.hospital_id = v_hospital_id
        and m.chart_type = v_chart_type
        and m.first_visit_date = k.metric_date
    );
end;
$$;

grant execute on function analytics.recompute_new_customers_for_run(bigint) to service_role;
