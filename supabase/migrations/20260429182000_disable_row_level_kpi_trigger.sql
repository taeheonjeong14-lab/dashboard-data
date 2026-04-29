-- Disable row-level raw->kpi trigger to avoid upload timeouts.
-- KPI is still rebuilt automatically at upload completion via analytics.rebuild_chart_for_run(p_run_id).

drop trigger if exists trg_rebuild_kpis_on_raw_change on analytics.chart_transactions_raw;

-- Keep functions for optional manual/batch rebuild usage.
-- drop function if exists analytics.trg_rebuild_kpis_on_raw_change();
-- drop function if exists analytics.rebuild_chart_daily_kpis_month(text, text, date, text);
