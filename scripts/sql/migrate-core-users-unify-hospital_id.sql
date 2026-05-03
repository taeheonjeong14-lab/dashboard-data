-- STEP 2.2 — core.users: single column hospital_id + FK
-- Same logic as: supabase/migrations/20260503180000_core_users_unify_hospital_id.sql
-- Use that migration via Supabase CLI/remote, or paste this in SQL Editor.
--
-- Prerequisite: verify-hospital-id-unification.sql (충돌 0건)
--
-- 끝 상태: hospital_id 만 유지 + users_hospital_id_fkey
-- DDx: hospitalId String? @map("hospital_id")

begin;

do $merge$
declare
  has_quoted boolean;
  n bigint;
begin
  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'core'
      and c.table_name = 'users'
      and c.column_name = 'hospitalId'
  )
  into has_quoted;

  if not has_quoted then
    raise notice 'core.users: "hospitalId" absent — skip coalesce / drop column';
    return;
  end if;

  execute $q$
    select count(*)::bigint from core.users u
    where u."hospitalId" is not null
      and u.hospital_id is not null
      and u."hospitalId"::text is distinct from u.hospital_id
  $q$
  into n;

  if n > 0 then
    raise exception 'resolve % conflicting core.users rows before migration (verify script)', n;
  end if;

  execute 'update core.users u set hospital_id = coalesce(u.hospital_id, u."hospitalId"::text)';
  execute 'alter table core.users drop constraint if exists users_hospitalId_fkey';
  execute 'alter table core.users drop column if exists "hospitalId"';
end
$merge$;

do $fk$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'core'
      and rel.relname = 'users'
      and c.conname = 'users_hospital_id_fkey'
  ) then
    raise notice 'core.users: users_hospital_id_fkey already exists — skip';
    return;
  end if;

  execute $q$
    alter table core.users
    add constraint users_hospital_id_fkey
    foreign key (hospital_id)
    references core.hospitals (id)
    on update cascade on delete set null
  $q$;
end
$fk$;

commit;

-- §A — FK 단계가 타입 오류 나면 (hospitals.id = uuid, hospital_id = text):
-- begin;
-- alter table core.users drop constraint if exists users_hospital_id_fkey;
-- alter table core.users
--   alter column hospital_id type uuid using nullif(trim(hospital_id::text), '')::uuid;
-- alter table core.users
--   add constraint users_hospital_id_fkey
--   foreign key (hospital_id) references core.hospitals (id)
--   on update cascade on delete set null;
-- commit;
