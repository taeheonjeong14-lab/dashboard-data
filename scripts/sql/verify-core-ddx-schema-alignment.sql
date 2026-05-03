-- Read-only: compare live DB to DDx Prisma (do NOT prisma db push blindly).
-- Run on staging/production Supabase SQL Editor.
--
-- Expect after migrate 20260503180000_core_users_unify_hospital_id.sql:
--   core.users: column hospital_id exists; quoted "hospitalId" does NOT exist.

-- core.users — hospital + optional columns Prisma may not model
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'core'
  and table_name = 'users'
  and column_name in (
    'id', 'hospital_id', 'hospitalId', 'role', 'email', 'approved'
  )
order by column_name;

-- core.hospitals — dashboard-data migrations add these; DDx Prisma may omit them
select column_name, data_type
from information_schema.columns
where table_schema = 'core'
  and table_name = 'hospitals'
  and column_name in (
    'id', 'naver_blog_id', 'debug_port', 'smartplace_stat_url', 'name'
  )
order by column_name;

-- email_verifications: dashboard-data는 public → core 이동. DDx Prisma는 robovet에 둔 경우가 있어 드리프트 가능.
select
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'email_verifications'
  ) as public_has_email_verifications,
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'core' and table_name = 'email_verifications'
  ) as core_has_email_verifications,
  exists (
    select 1
    from information_schema.tables
    where table_schema = 'robovet' and table_name = 'email_verifications'
  ) as robovet_has_email_verifications;
