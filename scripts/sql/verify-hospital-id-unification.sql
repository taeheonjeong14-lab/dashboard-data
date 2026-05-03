-- STEP 2.1 — hospital identifier audit (read-only)
-- Run in Supabase SQL Editor; share results before any destructive migration.
--
-- Context:
--   - DDx Prisma uses quoted camelCase: "hospitalId" on core.users / robovet.*.
--   - dashboard-data RLS and analytics use snake_case: core.users.hospital_id.
--   - Canonical value: text form of core.hospitals.id (UUID string).
--   - Naver blog id lives only on core.hospitals.naver_blog_id.

-- ---------------------------------------------------------------------------
-- A) Column inventory: anything that looks like a hospital link
-- ---------------------------------------------------------------------------
select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema in ('core', 'robovet')
  and table_name in (
    'users', 'hospitals', 'pre_consultations', 'survey_templates', 'survey_sessions'
  )
  and (
    lower(column_name) like '%hospital%'
    or lower(column_name) like '%naver%'
  )
order by table_schema, table_name, ordinal_position;

-- ---------------------------------------------------------------------------
-- B) core.users: presence of "hospitalId" vs hospital_id (no hard errors)
-- ---------------------------------------------------------------------------
select
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'core' and c.table_name = 'users' and c.column_name = 'hospitalId'
  ) as core_users_has_quoted_hospitalid,
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'core' and c.table_name = 'users' and c.column_name = 'hospital_id'
  ) as core_users_has_hospital_id;

-- Counts + mismatch sample (only runs the inner query if both columns exist; else returns nulls)
do $body$
declare
  has_camel boolean;
  has_snake boolean;
  n_camel bigint;
  n_snake bigint;
  n_both bigint;
  n_conflict bigint;
begin
  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'core' and c.table_name = 'users' and c.column_name = 'hospitalId'
  ) into has_camel;
  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'core' and c.table_name = 'users' and c.column_name = 'hospital_id'
  ) into has_snake;

  raise notice 'core.users: has "hospitalId"=%  has hospital_id=%', has_camel, has_snake;

  if has_camel then
    execute 'select count(*) from core.users where "hospitalId" is not null' into n_camel;
    raise notice 'core.users: non-null "hospitalId" count = %', n_camel;
  end if;

  if has_snake then
    execute 'select count(*) from core.users where hospital_id is not null' into n_snake;
    raise notice 'core.users: non-null hospital_id count = %', n_snake;
  end if;

  if has_camel and has_snake then
    execute
      'select count(*) from core.users where "hospitalId" is not null and hospital_id is not null'
      into n_both;
    execute
      $q$
      select count(*) from core.users u
      where u."hospitalId" is not null
        and u.hospital_id is not null
        and u."hospitalId" is distinct from u.hospital_id
      $q$
      into n_conflict;
    raise notice 'core.users: both set = %  conflicting pairs = %', n_both, n_conflict;
  end if;
end
$body$;

-- Up to 50 rows where both columns exist and disagree (empty if only one column exists)
drop table if exists _hospital_id_audit_conflicts;
-- core.users.id matches Prisma String @id (text), not always uuid
create temporary table _hospital_id_audit_conflicts (
  id text,
  email text,
  quoted_hospitalid text,
  hospital_id text
);

do $body$
declare
  has_camel boolean;
  has_snake boolean;
begin
  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'core' and c.table_name = 'users' and c.column_name = 'hospitalId'
  ) into has_camel;
  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'core' and c.table_name = 'users' and c.column_name = 'hospital_id'
  ) into has_snake;

  if has_camel and has_snake then
    insert into _hospital_id_audit_conflicts (id, email, quoted_hospitalid, hospital_id)
    select u.id, u.email, u."hospitalId"::text, u.hospital_id
    from core.users u
    where u."hospitalId" is not null
      and u.hospital_id is not null
      and u."hospitalId" is distinct from u.hospital_id
    limit 50;
  end if;
end
$body$;

select * from _hospital_id_audit_conflicts;

-- ---------------------------------------------------------------------------
-- C) FK constraints touching core.hospitals.id (users + robovet)
-- ---------------------------------------------------------------------------
select
  n.nspname as fk_schema,
  cl.relname as fk_table,
  con.conname,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class cl on cl.oid = con.conrelid
join pg_namespace n on n.oid = cl.relnamespace
where con.contype = 'f'
  and pg_get_constraintdef(con.oid) like '%core.hospitals%'
order by 1, 2, 3;

-- ---------------------------------------------------------------------------
-- D) Referential sanity: user hospital pointers vs core.hospitals (Messages tab)
-- ---------------------------------------------------------------------------
do $body$
declare
  has_camel boolean;
  has_snake boolean;
  n_orphan_camel bigint;
  n_orphan_snake bigint;
begin
  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'core' and c.table_name = 'users' and c.column_name = 'hospitalId'
  ) into has_camel;
  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'core' and c.table_name = 'users' and c.column_name = 'hospital_id'
  ) into has_snake;

  if has_camel then
    execute
      $q$
      select count(*) from core.users u
      where u."hospitalId" is not null
        and not exists (select 1 from core.hospitals h where h.id::text = u."hospitalId")
      $q$
      into n_orphan_camel;
    raise notice 'core.users: orphan "hospitalId" (not in core.hospitals) = %', n_orphan_camel;
  end if;

  if has_snake then
    execute
      $q$
      select count(*) from core.users u
      where u.hospital_id is not null
        and not exists (select 1 from core.hospitals h where h.id::text = u.hospital_id)
      $q$
      into n_orphan_snake;
    raise notice 'core.users: orphan hospital_id (not in core.hospitals) = %', n_orphan_snake;
  end if;
end
$body$;

-- ---------------------------------------------------------------------------
-- E) core.hospitals: duplicate naver_blog_id (should be empty if unique index holds)
-- ---------------------------------------------------------------------------
select naver_blog_id, count(*) as n
from core.hospitals
where naver_blog_id is not null
group by naver_blog_id
having count(*) > 1;

-- ---------------------------------------------------------------------------
-- F) analytics: orphan hospital_id (sample — heavy tables may be slow; cancel if needed)
-- ---------------------------------------------------------------------------
-- Uncomment one at a time if you need row-level proof.

-- select 'analytics_daily_metrics' as tbl, count(*) as orphan_rows
-- from analytics.analytics_daily_metrics m
-- where m.hospital_id is not null
--   and not exists (select 1 from core.hospitals h where h.id::text = m.hospital_id);

-- select 'analytics_blog_keyword_targets' as tbl, count(*) as orphan_rows
-- from analytics.analytics_blog_keyword_targets t
-- where t.hospital_id is not null
--   and not exists (select 1 from core.hospitals h where h.id::text = t.hospital_id);
