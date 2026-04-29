-- Add `extensions` to rebuild_chart_for_run search_path so pgcrypto.digest(bytea, text) resolves.
-- (Supabase installs pgcrypto in schema extensions; RPC used analytics, public only → digest missing.)
-- Same logic as 20260429140100; apply if you still see digest(bytea, text) does not exist after that migration.

create or replace function analytics.rebuild_chart_for_run(p_run_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = analytics, public, extensions
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

  create temporary table if not exists tmp_owner_resolution (
    owner_name_norm text primary key,
    customer_key_norm text not null
  ) on commit drop;

  truncate table tmp_owner_resolution;

  -- eFriends: resolve stable customer_key_norm based on owner_name_norm + patient set similarity.
  if v_chart_type = 'efriends' then
    with owners as (
      select
        analytics.norm_owner_name(customer_name_raw) as owner_name_norm,
        analytics.parse_patient_names(patient_name_raw) as patient_names
      from analytics.chart_transactions_raw
      where hospital_id = v_hospital_id
        and chart_type = v_chart_type
        and service_date between v_min_date and v_max_date
        and customer_name_raw <> '(고객명 미상)'
        and patient_name_raw <> '(환자명 미상)'
      group by 1,2
    ),
    best_match as (
      select
        o.owner_name_norm,
        m.customer_key_norm,
        analytics.jaccard_similarity(m.patient_names, o.patient_names) as sim,
        row_number() over (partition by o.owner_name_norm order by analytics.jaccard_similarity(m.patient_names, o.patient_names) desc) as rn
      from owners o
      join analytics.chart_customer_identity_map m
        on m.hospital_id = v_hospital_id
       and m.chart_type = v_chart_type
       and m.owner_name_norm = o.owner_name_norm
    ),
    chosen as (
      select owner_name_norm, customer_key_norm
      from best_match
      where rn = 1 and sim >= 0.30
    )
    insert into tmp_owner_resolution(owner_name_norm, customer_key_norm)
    select owner_name_norm, customer_key_norm
    from chosen
    on conflict (owner_name_norm) do nothing;

    -- For owners not yet resolved, create a new identity row.
    with owners as (
      select
        analytics.norm_owner_name(customer_name_raw) as owner_name_norm,
        analytics.parse_patient_names(patient_name_raw) as patient_names
      from analytics.chart_transactions_raw
      where hospital_id = v_hospital_id
        and chart_type = v_chart_type
        and service_date between v_min_date and v_max_date
        and customer_name_raw <> '(고객명 미상)'
        and patient_name_raw <> '(환자명 미상)'
      group by 1,2
    ),
    missing as (
      select o.*
      from owners o
      left join tmp_owner_resolution r using (owner_name_norm)
      where r.owner_name_norm is null
    ),
    inserted as (
      insert into analytics.chart_customer_identity_map (
        hospital_id,
        chart_type,
        owner_name_norm,
        customer_key_norm,
        patient_names
      )
      select
        v_hospital_id,
        v_chart_type,
        m.owner_name_norm,
        encode(digest(convert_to(v_hospital_id || '|efriends|' || m.owner_name_norm || '|' || gen_random_uuid()::text, 'UTF8'), 'sha256'::text), 'hex'),
        m.patient_names
      from missing m
      returning owner_name_norm, customer_key_norm
    )
    insert into tmp_owner_resolution(owner_name_norm, customer_key_norm)
    select owner_name_norm, customer_key_norm
    from inserted
    on conflict (owner_name_norm) do nothing;

    -- Refresh patient_names on the selected identities (union with new set).
    with owners as (
      select
        analytics.norm_owner_name(customer_name_raw) as owner_name_norm,
        analytics.parse_patient_names(patient_name_raw) as patient_names
      from analytics.chart_transactions_raw
      where hospital_id = v_hospital_id
        and chart_type = v_chart_type
        and service_date between v_min_date and v_max_date
        and customer_name_raw <> '(고객명 미상)'
        and patient_name_raw <> '(환자명 미상)'
      group by 1,2
    ),
    resolved as (
      select o.owner_name_norm, r.customer_key_norm, o.patient_names
      from owners o
      join tmp_owner_resolution r using (owner_name_norm)
    ),
    merged as (
      select
        hospital_id,
        chart_type,
        owner_name_norm,
        customer_key_norm,
        array(
          select distinct v
          from (
            select unnest(coalesce(m.patient_names,'{}'::text[])) as v
            union
            select unnest(coalesce(r.patient_names,'{}'::text[])) as v
          ) x
          where v is not null and v <> ''
          order by 1
        ) as patient_names_union
      from resolved r
      join analytics.chart_customer_identity_map m
        on m.hospital_id = v_hospital_id
       and m.chart_type = v_chart_type
       and m.owner_name_norm = r.owner_name_norm
       and m.customer_key_norm = r.customer_key_norm
      cross join lateral (select v_hospital_id as hospital_id, v_chart_type as chart_type) t
    )
    update analytics.chart_customer_identity_map m
    set patient_names = merged.patient_names_union
    from merged
    where m.hospital_id = v_hospital_id
      and m.chart_type = v_chart_type
      and m.owner_name_norm = merged.owner_name_norm
      and m.customer_key_norm = merged.customer_key_norm;
  end if;

  -- 1) customer master rebuild (known only)
  with known as (
    select
      r.hospital_id,
      r.chart_type,
      case
        when v_chart_type = 'efriends'
          then coalesce(res.customer_key_norm, r.customer_key_norm)
        else r.customer_key_norm
      end as customer_key_norm,
      max(r.customer_no_raw) filter (where r.customer_no_raw is not null and r.customer_no_raw <> '') as customer_no_raw_latest,
      max(r.customer_name_raw) as customer_name_latest,
      min(r.service_date) as first_visit_date,
      max(r.ingested_at) as last_seen_at
    from analytics.chart_transactions_raw r
    left join tmp_owner_resolution res
      on v_chart_type = 'efriends'
     and res.owner_name_norm = analytics.norm_owner_name(r.customer_name_raw)
    where r.hospital_id = v_hospital_id
      and r.chart_type = v_chart_type
      and r.service_date between v_min_date and v_max_date
      and r.customer_name_raw <> '(고객명 미상)'
      and r.patient_name_raw <> '(환자명 미상)'
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
      r.hospital_id,
      r.chart_type,
      case
        when v_chart_type = 'efriends'
          then coalesce(res.customer_key_norm, r.customer_key_norm)
        else r.customer_key_norm
      end as customer_key_norm,
      case
        when v_chart_type = 'efriends'
          then encode(digest(convert_to(v_hospital_id || '|efriends|visit|' || coalesce(res.customer_key_norm, r.customer_key_norm), 'UTF8'), 'sha256'::text), 'hex')
        else r.patient_key_norm
      end as patient_key_norm,
      max(r.patient_name_raw) as patient_name_latest,
      min(r.service_date) as first_seen_date,
      max(r.service_date) as last_seen_date,
      max(r.ingested_at) as last_seen_at
    from analytics.chart_transactions_raw r
    left join tmp_owner_resolution res
      on v_chart_type = 'efriends'
     and res.owner_name_norm = analytics.norm_owner_name(r.customer_name_raw)
    where r.hospital_id = v_hospital_id
      and r.chart_type = v_chart_type
      and r.service_date between v_min_date and v_max_date
      and r.customer_name_raw <> '(고객명 미상)'
      and r.patient_name_raw <> '(환자명 미상)'
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

  with net_zero_receipt_group as (
    select
      r.service_date,
      r.customer_key_norm,
      lower(trim(r.receipt_no_raw)) as receipt_no_norm
    from analytics.chart_transactions_raw r
    where r.hospital_id = v_hospital_id
      and r.chart_type = 'intovet'
      and coalesce(trim(r.receipt_no_raw), '') <> ''
    group by 1,2,3
    having sum(r.final_amount_raw) = 0
  ),
  base_rows as (
    select
      r.service_date as metric_date,
      r.hospital_id,
      r.chart_type,
      case
        when v_chart_type = 'efriends' then coalesce(res.customer_key_norm, r.customer_key_norm)
        else r.customer_key_norm
      end as resolved_customer_key_norm,
      case
        when v_chart_type = 'efriends'
          then encode(digest(convert_to(v_hospital_id || '|efriends|visit|' || coalesce(res.customer_key_norm, r.customer_key_norm), 'UTF8'), 'sha256'::text), 'hex')
        else r.patient_key_norm
      end as resolved_patient_key_norm,
      r.customer_name_raw,
      r.patient_name_raw,
      r.final_amount_raw,
      r.receipt_no_raw
    from analytics.chart_transactions_raw r
    left join tmp_owner_resolution res
      on v_chart_type = 'efriends'
     and res.owner_name_norm = analytics.norm_owner_name(r.customer_name_raw)
    where r.hospital_id = v_hospital_id
      and r.chart_type = v_chart_type
      and r.service_date between v_min_date and v_max_date
  ),
  filtered_rows as (
    select b.*
    from base_rows b
    where not (
      v_chart_type = 'intovet'
      and coalesce(trim(b.receipt_no_raw), '') <> ''
      and exists (
        select 1
        from net_zero_receipt_group nz
        where nz.service_date = b.metric_date
          and nz.customer_key_norm = b.resolved_customer_key_norm
          and nz.receipt_no_norm = lower(trim(b.receipt_no_raw))
      )
    )
  ),
  intovet_net_rows as (
    select
      f.metric_date,
      f.hospital_id,
      f.chart_type,
      f.resolved_customer_key_norm,
      min(f.resolved_patient_key_norm) as resolved_patient_key_norm,
      max(f.customer_name_raw) as customer_name_raw,
      max(f.patient_name_raw) as patient_name_raw,
      lower(trim(f.receipt_no_raw)) as receipt_no_norm,
      sum(f.final_amount_raw) as final_amount_raw
    from filtered_rows f
    where v_chart_type = 'intovet'
      and coalesce(trim(f.receipt_no_raw), '') <> ''
    group by 1,2,3,4,8
    having sum(f.final_amount_raw) <> 0
  ),
  kpi_rows as (
    -- IntoVet rows with receipt_no are collapsed to net amount per receipt group.
    select
      f.metric_date,
      f.hospital_id,
      f.chart_type,
      f.resolved_customer_key_norm,
      f.resolved_patient_key_norm,
      f.customer_name_raw,
      f.patient_name_raw,
      lower(trim(f.receipt_no_raw)) as receipt_no_norm,
      f.final_amount_raw
    from filtered_rows f
    where not (
      v_chart_type = 'intovet'
      and coalesce(trim(f.receipt_no_raw), '') <> ''
    )
    union all
    select
      i.metric_date,
      i.hospital_id,
      i.chart_type,
      i.resolved_customer_key_norm,
      i.resolved_patient_key_norm,
      i.customer_name_raw,
      i.patient_name_raw,
      i.receipt_no_norm,
      i.final_amount_raw
    from intovet_net_rows i
  ),
  raw_by_day as (
    select
      f.metric_date,
      f.hospital_id,
      f.chart_type,
      sum(f.final_amount_raw) as sales_amount,
      count(distinct case
        when f.customer_name_raw = '(고객명 미상)' or f.patient_name_raw = '(환자명 미상)' then null
        when v_chart_type = 'intovet' and coalesce(f.receipt_no_norm, '') <> '' then f.resolved_customer_key_norm || '|receipt|' || f.receipt_no_norm
        when v_chart_type = 'efriends' then f.resolved_customer_key_norm || '|visit'
        else f.resolved_customer_key_norm || '|' || f.resolved_patient_key_norm
      end) as visit_count
    from kpi_rows f
    group by 1,2,3
  ),
  intovet_first_visit as (
    select
      r.customer_key_norm,
      min(r.service_date) as first_visit_date
    from analytics.chart_transactions_raw r
    where v_chart_type = 'intovet'
      and r.hospital_id = v_hospital_id
      and r.chart_type = v_chart_type
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
      v_hospital_id as hospital_id,
      v_chart_type as chart_type,
      count(*) as new_customer_count
    from intovet_first_visit i
    where v_chart_type = 'intovet'
      and i.first_visit_date between v_min_date and v_max_date
    group by 1,2,3
    union all
    select
      c.first_visit_date as metric_date,
      c.hospital_id,
      c.chart_type,
      count(*) as new_customer_count
    from analytics.chart_customer_master c
    where v_chart_type <> 'intovet'
      and c.hospital_id = v_hospital_id
      and c.chart_type = v_chart_type
      and c.first_visit_date between v_min_date and v_max_date
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
