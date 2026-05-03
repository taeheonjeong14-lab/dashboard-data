-- DANGER: Only run after verify-public-vs-core-robovet.sql shows public.* is empty or obsolete.
-- Prefer maintenance window + backup / PITR. DDx must use core/robovet only.
--
-- Order: children first (adjust if FK query shows different order).

begin;

drop table if exists public.survey_answers cascade;
drop table if exists public.survey_question_instances cascade;
drop table if exists public.survey_sessions cascade;
drop table if exists public.survey_templates cascade;
drop table if exists public.consultations cascade;
drop table if exists public.pre_consultations cascade;
drop table if exists public.email_verifications cascade;
drop table if exists public.users cascade;
drop table if exists public.hospitals cascade;

commit;

-- Re-check: public should have no business tables left (except extensions like spatial_ref_sys if any).
-- select tablename from pg_tables where schemaname = 'public' order by tablename;
