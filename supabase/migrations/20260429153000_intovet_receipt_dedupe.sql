-- Dedupe overwrite keys:
-- - IntoVet: (service_date + customer_no + owner_name + receipt_no + final_amount_raw)
-- - Woorien PMS: (service_date + owner_name + patient_name + treatment_content + final_amount_raw)
-- - eFriends: (service_date + owner_name + bill_no + final_amount_raw)

alter table analytics.chart_transactions_raw
  add column if not exists receipt_no_raw text,
  add column if not exists treatment_content_raw text,
  add column if not exists bill_no_raw text,
  add column if not exists dedupe_key text;

-- If this migration is re-run after partial success, drop dedupe uniqueness first
-- so backfill updates can proceed before we re-deduplicate + recreate uniqueness.
alter table analytics.chart_transactions_raw
  drop constraint if exists uq_chart_transactions_raw_hospital_chart_dedupe_key;
drop index if exists analytics.uq_chart_transactions_raw_hospital_chart_dedupe_key;

-- Backfill dedupe key for IntoVet rows with customer no + customer name + receipt no.
update analytics.chart_transactions_raw r
set dedupe_key = concat_ws(
  '|',
  r.service_date::text,
  lower(regexp_replace(regexp_replace(trim(coalesce(r.customer_no_raw, '')), '\s+', '', 'g'), '[^a-z0-9_-]', '', 'g')),
  lower(regexp_replace(trim(coalesce(r.customer_name_raw, '')), '\s+', ' ', 'g')),
  lower(regexp_replace(trim(coalesce(r.receipt_no_raw, '')), '\s+', '', 'g')),
  r.final_amount_raw::text
)
where r.chart_type = 'intovet'
  and r.customer_no_raw is not null
  and trim(r.customer_no_raw) <> ''
  and r.customer_name_raw is not null
  and trim(r.customer_name_raw) <> ''
  and r.receipt_no_raw is not null
  and trim(r.receipt_no_raw) <> '';

-- Backfill Woorien PMS treatment content from raw payload when available.
update analytics.chart_transactions_raw r
set treatment_content_raw = nullif(trim(coalesce(r.raw_payload->'row'->>5, '')), '')
where r.chart_type = 'woorien_pms'
  and (r.treatment_content_raw is null or trim(r.treatment_content_raw) = '');

-- Backfill dedupe key for Woorien PMS rows with usable treatment content.
update analytics.chart_transactions_raw r
set dedupe_key = concat_ws(
  '|',
  r.service_date::text,
  lower(regexp_replace(trim(coalesce(r.customer_name_raw, '')), '\s+', ' ', 'g')),
  lower(regexp_replace(trim(coalesce(r.patient_name_raw, '')), '\s+', ' ', 'g')),
  lower(regexp_replace(trim(coalesce(r.treatment_content_raw, '')), '\s+', ' ', 'g')),
  r.final_amount_raw::text
)
where r.chart_type = 'woorien_pms'
  and r.treatment_content_raw is not null
  and trim(r.treatment_content_raw) <> '';

-- Backfill eFriends bill number from raw payload when available.
update analytics.chart_transactions_raw r
set bill_no_raw = nullif(trim(coalesce(r.raw_payload->'row'->>6, '')), '')
where r.chart_type = 'efriends'
  and (r.bill_no_raw is null or trim(r.bill_no_raw) = '');

-- Backfill dedupe key for eFriends rows with usable bill number.
update analytics.chart_transactions_raw r
set dedupe_key = concat_ws(
  '|',
  r.service_date::text,
  lower(regexp_replace(trim(coalesce(r.customer_name_raw, '')), '\s+', ' ', 'g')),
  lower(regexp_replace(trim(coalesce(r.bill_no_raw, '')), '\s+', '', 'g')),
  r.final_amount_raw::text
)
where r.chart_type = 'efriends'
  and r.bill_no_raw is not null
  and trim(r.bill_no_raw) <> ''
  and r.customer_name_raw <> '(고객명 미상)';

-- Keep only the latest row per dedupe key before unique index creation.
with ranked as (
  select
    id,
    row_number() over (
      partition by hospital_id, chart_type, dedupe_key
      order by ingested_at desc nulls last, run_id desc nulls last, id desc
    ) as rn
  from analytics.chart_transactions_raw
  where chart_type in ('intovet', 'woorien_pms', 'efriends')
    and dedupe_key is not null
    and trim(dedupe_key) <> ''
)
delete from analytics.chart_transactions_raw r
using ranked d
where r.id = d.id
  and d.rn > 1;

alter table analytics.chart_transactions_raw
  add constraint uq_chart_transactions_raw_hospital_chart_dedupe_key
  unique (hospital_id, chart_type, dedupe_key);
