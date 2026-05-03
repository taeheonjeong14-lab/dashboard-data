-- core.users: quoted "hospitalId" was dropped in 20260503180000_core_users_unify_hospital_id.sql.
-- Any BEFORE trigger that still references NEW."hospitalId" fails on UPDATE/INSERT.
-- Replace with no-op: only hospital_id remains; nothing to sync between two columns.

create or replace function core.sync_users_hospital_columns()
returns trigger
language plpgsql
as $$
begin
  return new;
end;
$$;
