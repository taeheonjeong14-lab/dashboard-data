-- Run in Supabase SQL Editor (read-only). Purpose: see if public.* is duplicate of core/robovet.
-- After review, use drop-public-legacy-tables.sql only if public rows are 0 or confirmed obsolete.

-- 1) Same table name across schemas
select table_schema, table_name
from information_schema.tables
where table_type = 'BASE TABLE'
  and table_name in (
    'users', 'hospitals', 'consultations', 'pre_consultations',
    'email_verifications', 'survey_sessions', 'survey_question_instances',
    'survey_answers', 'survey_templates'
  )
order by table_name, table_schema;

-- 2) Row counts: public vs core/robovet (adjust if a table only exists in one schema)
select 'public.users' as tbl, count(*)::bigint as n from public.users
union all select 'core.users', count(*) from core.users
union all select 'public.hospitals', count(*) from public.hospitals
union all select 'core.hospitals', count(*) from core.hospitals
union all select 'public.consultations', count(*) from public.consultations
union all select 'robovet.consultations', count(*) from robovet.consultations
union all select 'public.pre_consultations', count(*) from public.pre_consultations
union all select 'robovet.pre_consultations', count(*) from robovet.pre_consultations
union all select 'public.email_verifications', count(*) from public.email_verifications
union all select 'robovet.email_verifications', count(*) from robovet.email_verifications
union all select 'public.survey_sessions', count(*) from public.survey_sessions
union all select 'robovet.survey_sessions', count(*) from robovet.survey_sessions
union all select 'public.survey_question_instances', count(*) from public.survey_question_instances
union all select 'robovet.survey_question_instances', count(*) from robovet.survey_question_instances
union all select 'public.survey_answers', count(*) from public.survey_answers
union all select 'robovet.survey_answers', count(*) from robovet.survey_answers
union all select 'public.survey_templates', count(*) from public.survey_templates
union all select 'robovet.survey_templates', count(*) from robovet.survey_templates;

-- 3) FKs referencing public tables (what blocks DROP order)
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema as references_schema,
  ccu.table_name as references_table
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
  and tc.table_name = kcu.table_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
where tc.constraint_type = 'foreign key'
  and (
    tc.table_schema = 'public'
    or ccu.table_schema = 'public'
  )
order by tc.table_schema, tc.table_name;
