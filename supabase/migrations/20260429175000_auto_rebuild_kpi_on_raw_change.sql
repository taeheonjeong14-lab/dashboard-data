-- Auto rebuild chart_daily_kpis immediately when raw rows change.
-- Scope: month of changed service_date for (hospital_id, chart_type).

create or replace function analytics.rebuild_chart_daily_kpis_month(
  p_hospital_id text,
  p_chart_type text,
  p_any_date date,
  p_rebuild_source text default 'trigger-monthly'
)
returns integer
language plpgsql
security definer
set search_path = analytics, public
as $$
declare
  v_month_start date;
  v_next_month_start date;
  v_kpi_days int := 0;
begin
  if p_hospital_id is null or p_chart_type is null or p_any_date is null then
    return 0;
  end if;

  v_month_start := date_trunc('month', p_any_date)::date;
  v_next_month_start := (v_month_start + interval '1 month')::date;

  delete from analytics.chart_daily_kpis
  where hospital_id = p_hospital_id
    and chart_type = p_chart_type
    and metric_date >= v_month_start
    and metric_date < v_next_month_start;

  with net_zero_receipt_group as (
    select
      r.service_date,
      r.customer_key_norm,
      lower(trim(r.receipt_no_raw)) as receipt_no_norm
    from analytics.chart_transactions_raw r
    where r.hospital_id = p_hospital_id
      and r.chart_type = 'intovet'
      and coalesce(trim(r.receipt_no_raw), '') <> ''
    group by 1,2,3
    having sum(r.final_amount_raw) = 0
  ),
  filtered_rows as (
    select r.*
    from analytics.chart_transactions_raw r
    where r.hospital_id = p_hospital_id
      and r.chart_type = p_chart_type
      and r.service_date >= v_month_start
      and r.service_date < v_next_month_start
      and not (
        p_chart_type = 'intovet'
        and coalesce(trim(r.receipt_no_raw), '') <> ''
        and exists (
          select 1
          from net_zero_receipt_group nz
          where nz.service_date = r.service_date
            and nz.customer_key_norm = r.customer_key_norm
            and nz.receipt_no_norm = lower(trim(r.receipt_no_raw))
        )
      )
  ),
  intovet_net_rows as (
    select
      r.service_date as metric_date,
      r.hospital_id,
      r.chart_type,
      r.customer_key_norm,
      min(r.patient_key_norm) as patient_key_norm,
      max(r.customer_name_raw) as customer_name_raw,
      max(r.patient_name_raw) as patient_name_raw,
      lower(trim(r.receipt_no_raw)) as receipt_no_norm,
      sum(r.final_amount_raw) as final_amount_raw
    from filtered_rows r
    where p_chart_type = 'intovet'
      and coalesce(trim(r.receipt_no_raw), '') <> ''
    group by 1,2,3,4,8
    having sum(r.final_amount_raw) <> 0
  ),
  kpi_rows as (
    select
      r.service_date as metric_date,
      r.hospital_id,
      r.chart_type,
      r.customer_key_norm,
      r.patient_key_norm,
      r.customer_name_raw,
      r.patient_name_raw,
      lower(trim(r.receipt_no_raw)) as receipt_no_norm,
      r.final_amount_raw
    from filtered_rows r
    where not (
      p_chart_type = 'intovet'
      and coalesce(trim(r.receipt_no_raw), '') <> ''
    )
    union all
    select
      i.metric_date,
      i.hospital_id,
      i.chart_type,
      i.customer_key_norm,
      i.patient_key_norm,
      i.customer_name_raw,
      i.patient_name_raw,
      i.receipt_no_norm,
      i.final_amount_raw
    from intovet_net_rows i
  ),
  raw_by_day as (
    select
      r.metric_date,
      r.hospital_id,
      r.chart_type,
      sum(r.final_amount_raw) as sales_amount,
      count(distinct case
        when r.customer_name_raw = '(고객명 미상)' or r.patient_name_raw = '(환자명 미상)' then null
        when p_chart_type = 'intovet' and coalesce(r.receipt_no_norm, '') <> '' then r.customer_key_norm || '|receipt|' || r.receipt_no_norm
        when p_chart_type = 'efriends' then r.customer_key_norm || '|visit'
        else r.customer_key_norm || '|' || r.patient_key_norm
      end) as visit_count
    from kpi_rows r
    group by 1,2,3
  ),
  intovet_first_visit as (
    select
      r.customer_key_norm,
      min(r.service_date) as first_visit_date
    from analytics.chart_transactions_raw r
    where p_chart_type = 'intovet'
      and r.hospital_id = p_hospital_id
      and r.chart_type = p_chart_type
      and r.customer_name_raw <> '(고객명 미상)'
      and r.patient_name_raw <> '(환자명 미상)'
      and not (
        coalesce(trim(r.receipt_no_raw), '') <> ''
        and exists (
          select 1
          from net_zero_receipt_group nz
          where nz.service_date = r.service_date
            and nz.customer_key_norm = r.customer_key_norm
            and nz.receipt_no_norm = lower(trim(r.receipt_no_raw))
        )
      )
    group by 1
  ),
  new_customer_by_day as (
    select
      i.first_visit_date as metric_date,
      p_hospital_id as hospital_id,
      p_chart_type as chart_type,
      count(*) as new_customer_count
    from intovet_first_visit i
    where p_chart_type = 'intovet'
      and i.first_visit_date >= v_month_start
      and i.first_visit_date < v_next_month_start
    group by 1,2,3
    union all
    select
      c.first_visit_date as metric_date,
      c.hospital_id,
      c.chart_type,
      count(*) as new_customer_count
    from analytics.chart_customer_master c
    where p_chart_type <> 'intovet'
      and c.hospital_id = p_hospital_id
      and c.chart_type = p_chart_type
      and c.first_visit_date >= v_month_start
      and c.first_visit_date < v_next_month_start
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
      null,
      jsonb_build_object('rebuild_source', coalesce(p_rebuild_source, 'trigger-monthly'))
    from raw_by_day r
    left join new_customer_by_day n
      on n.metric_date = r.metric_date
     and n.hospital_id = r.hospital_id
     and n.chart_type = r.chart_type
    returning 1
  )
  select count(*) into v_kpi_days from inserted;

  return v_kpi_days;
end;
$$;

grant execute on function analytics.rebuild_chart_daily_kpis_month(text, text, date, text) to service_role;

create or replace function analytics.trg_rebuild_kpis_on_raw_change()
returns trigger
language plpgsql
security definer
set search_path = analytics, public
as $$
begin
  if tg_op = 'INSERT' then
    perform analytics.rebuild_chart_daily_kpis_month(
      new.hospital_id,
      new.chart_type,
      new.service_date,
      'trigger-monthly-insert'
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform analytics.rebuild_chart_daily_kpis_month(
      old.hospital_id,
      old.chart_type,
      old.service_date,
      'trigger-monthly-delete'
    );
    return old;
  end if;

  -- UPDATE
  if coalesce(new.hospital_id, '') = coalesce(old.hospital_id, '')
     and coalesce(new.chart_type, '') = coalesce(old.chart_type, '')
     and new.service_date = old.service_date
     and coalesce(new.final_amount_raw, 0) = coalesce(old.final_amount_raw, 0)
     and coalesce(new.customer_key_norm, '') = coalesce(old.customer_key_norm, '')
     and coalesce(new.patient_key_norm, '') = coalesce(old.patient_key_norm, '')
     and coalesce(new.customer_name_raw, '') = coalesce(old.customer_name_raw, '')
     and coalesce(new.patient_name_raw, '') = coalesce(old.patient_name_raw, '') then
    return new;
  end if;

  perform analytics.rebuild_chart_daily_kpis_month(
    old.hospital_id,
    old.chart_type,
    old.service_date,
    'trigger-monthly-update-old'
  );

  if new.hospital_id is distinct from old.hospital_id
     or new.chart_type is distinct from old.chart_type
     or date_trunc('month', new.service_date) is distinct from date_trunc('month', old.service_date) then
    perform analytics.rebuild_chart_daily_kpis_month(
      new.hospital_id,
      new.chart_type,
      new.service_date,
      'trigger-monthly-update-new'
    );
  end if;

  return new;
end;
$$;

grant execute on function analytics.trg_rebuild_kpis_on_raw_change() to service_role;

drop trigger if exists trg_rebuild_kpis_on_raw_change on analytics.chart_transactions_raw;
create trigger trg_rebuild_kpis_on_raw_change
  after insert or update or delete on analytics.chart_transactions_raw
  for each row
  execute function analytics.trg_rebuild_kpis_on_raw_change();
