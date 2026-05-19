-- chart_pdf.parse_run_case_images is created at runtime by ensureTable() in the
-- admin-web case-images upload route. The CREATE TABLE there did not include
-- PostgREST role grants, so service_role queries via Supabase client fail with
-- "permission denied". Add the same grants as report_case_images uses.

grant select, insert, update, delete on table chart_pdf.parse_run_case_images to service_role;
grant select on table chart_pdf.parse_run_case_images to authenticated;
