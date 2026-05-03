-- core.users: keep hospital_id only; drop quoted "hospitalId".
-- Prerequisite: verify-hospital-id-unification.sql — conflict count = 0.
-- DDx after apply: User.hospitalId @map("hospital_id")
--
-- Idempotent: if "hospitalId" is already gone, only ensures users_hospital_id_fkey exists.

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

-- If ADD CONSTRAINT fails (text vs uuid): run scripts/sql/migrate-core-users-unify-hospital_id.sql §A manually, then re-run this migration or add FK in SQL Editor.
