-- Auto rebuild chart master/link/kpis in DB to ensure consistency

create or replace function analytics.rebuild_chart_for_run(p_run_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = analytics, public
as $$
declare
  v_hospital_id text;
  v_chart_type text;
  v_min_date date;
  v_max_date date;
  v_customer_upserts int := 0;
  v_link_upserts int := 0;
  v_kpi_days int := 0;
begin
  select hospital_id, chart_type
    into v_hospital_id, v_chart_type
  from analytics.chart_upload_runs
  where id = p_run_id;

  if v_hospital_id is null or v_chart_type is null then
    raise exception 'run not found: %', p_run_id;
  end if;

  select min(service_date), max(service_date)
    into v_min_date, v_max_date
  from analytics.chart_transactions_raw
  where run_id = p_run_id;

  if v_min_date is null or v_max_date is null then
    return jsonb_build_object(
      'hospital_id', v_hospital_id,
      'chart_type', v_chart_type,
      'min_date', null,
      'max_date', null,
      'customer_upserts', 0,
      'link_upserts', 0,
      'kpi_days', 0
    );
  end if;

  -- 1) customer master rebuild (known only)
  with known as (
    select
      hospital_id,
      chart_type,
      customer_key_norm,
      max(customer_no_raw) filter (where customer_no_raw is not null and customer_no_raw <> '') as customer_no_raw_latest,
      max(customer_name_raw) as customer_name_latest,
      min(service_date) as first_visit_date,
      max(ingested_at) as last_seen_at
    from analytics.chart_transactions_raw
    where hospital_id = v_hospital_id
      and chart_type = v_chart_type
      and service_date between v_min_date and v_max_date
      and customer_name_raw <> '(고객명 미상)'
      and patient_name_raw <> '(환자명 미상)'
    group by 1,2,3
  ),
  upserted as (
    insert into analytics.chart_customer_master (
      hospital_id,
      chart_type,
      customer_key_norm,
      customer_no_raw_latest,
      customer_name_latest,
      first_visit_date,
      last_seen_at,
      is_active
    )
    select
      k.hospital_id,
      k.chart_type,
      k.customer_key_norm,
      k.customer_no_raw_latest,
      k.customer_name_latest,
      k.first_visit_date,
      k.last_seen_at,
      true
    from known k
    on conflict (hospital_id, chart_type, customer_key_norm) do update set
      customer_no_raw_latest = coalesce(excluded.customer_no_raw_latest, analytics.chart_customer_master.customer_no_raw_latest),
      customer_name_latest = coalesce(excluded.customer_name_latest, analytics.chart_customer_master.customer_name_latest),
      first_visit_date = least(analytics.chart_customer_master.first_visit_date, excluded.first_visit_date),
      last_seen_at = greatest(analytics.chart_customer_master.last_seen_at, excluded.last_seen_at),
      is_active = true
    returning 1
  )
  select count(*) into v_customer_upserts from upserted;

  -- 2) customer-patient links rebuild (known only)
  with known_links as (
    select
      hospital_id,
      chart_type,
      customer_key_norm,
      patient_key_norm,
      max(patient_name_raw) as patient_name_latest,
      min(service_date) as first_seen_date,
      max(service_date) as last_seen_date,
      max(ingested_at) as last_seen_at
    from analytics.chart_transactions_raw
    where hospital_id = v_hospital_id
      and chart_type = v_chart_type
      and service_date between v_min_date and v_max_date
      and customer_name_raw <> '(고객명 미상)'
      and patient_name_raw <> '(환자명 미상)'
    group by 1,2,3,4
  ),
  upserted as (
    insert into analytics.chart_customer_patients (
      hospital_id,
      chart_type,
      customer_key_norm,
      patient_key_norm,
      patient_name_latest,
      first_seen_date,
      last_seen_date,
      last_seen_at,
      is_active
    )
    select
      k.hospital_id,
      k.chart_type,
      k.customer_key_norm,
      k.patient_key_norm,
      k.patient_name_latest,
      k.first_seen_date,
      k.last_seen_date,
      k.last_seen_at,
      true
    from known_links k
    on conflict (hospital_id, chart_type, customer_key_norm, patient_key_norm) do update set
      patient_name_latest = coalesce(excluded.patient_name_latest, analytics.chart_customer_patients.patient_name_latest),
      first_seen_date = least(analytics.chart_customer_patients.first_seen_date, excluded.first_seen_date),
      last_seen_date = greatest(analytics.chart_customer_patients.last_seen_date, excluded.last_seen_date),
      last_seen_at = greatest(analytics.chart_customer_patients.last_seen_at, excluded.last_seen_at),
      is_active = true
    returning 1
  )
  select count(*) into v_link_upserts from upserted;

  -- 3) daily kpis rebuild for date range (delete+insert)
  delete from analytics.chart_daily_kpis
  where hospital_id = v_hospital_id
    and chart_type = v_chart_type
    and metric_date between v_min_date and v_max_date;

  with raw_by_day as (
    select
      service_date as metric_date,
      hospital_id,
      chart_type,
      sum(final_amount_raw) as sales_amount,
      count(distinct case
        when customer_name_raw = '(고객명 미상)' or patient_name_raw = '(환자명 미상)' then null
        else customer_key_norm || '|' || patient_key_norm
      end) as visit_count
    from analytics.chart_transactions_raw
    where hospital_id = v_hospital_id
      and chart_type = v_chart_type
      and service_date between v_min_date and v_max_date
    group by 1,2,3
  ),
  new_customer_by_day as (
    select
      first_visit_date as metric_date,
      hospital_id,
      chart_type,
      count(*) as new_customer_count
    from analytics.chart_customer_master
    where hospital_id = v_hospital_id
      and chart_type = v_chart_type
      and first_visit_date between v_min_date and v_max_date
    group by 1,2,3
  ),
  inserted as (
    insert into analytics.chart_daily_kpis (
      metric_date,
      hospital_id,
      chart_type,
      sales_amount,
      visit_count,
      new_customer_count,
      source_run_id,
      metadata
    )
    select
      r.metric_date,
      r.hospital_id,
      r.chart_type,
      r.sales_amount,
      r.visit_count,
      coalesce(n.new_customer_count, 0),
      p_run_id,
      '{}'::jsonb
    from raw_by_day r
    left join new_customer_by_day n
      on n.metric_date = r.metric_date
     and n.hospital_id = r.hospital_id
     and n.chart_type = r.chart_type
    returning 1
  )
  select count(*) into v_kpi_days from inserted;

  return jsonb_build_object(
    'hospital_id', v_hospital_id,
    'chart_type', v_chart_type,
    'min_date', v_min_date,
    'max_date', v_max_date,
    'customer_upserts', v_customer_upserts,
    'link_upserts', v_link_upserts,
    'kpi_days', v_kpi_days
  );
end;
$$;

grant execute on function analytics.rebuild_chart_for_run(bigint) to service_role;

create or replace function analytics.repair_stale_chart_runs(p_hospital_id text, p_chart_type text, p_older_than interval default interval '5 minutes')
returns integer
language plpgsql
security definer
set search_path = analytics, public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    select id
    from analytics.chart_upload_runs
    where hospital_id = p_hospital_id
      and chart_type = p_chart_type
      and status = 'running'
      and started_at < now() - p_older_than
    order by id asc
  loop
    perform analytics.rebuild_chart_for_run(r.id);
    update analytics.chart_upload_runs
    set
      status = 'failed',
      finished_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('failed_reason', 'auto_repair_stale_running')
    where id = r.id
      and status = 'running';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function analytics.repair_stale_chart_runs(text, text, interval) to service_role;
