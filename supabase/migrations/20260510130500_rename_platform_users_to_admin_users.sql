-- 최종 테이블명: core.admin_users (기존 core.platform_users 가 있으면 이름만 변경)

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'core' and table_name = 'platform_users'
  ) then
    alter table core.platform_users rename to admin_users;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relkind = 'i' and c.relname = 'idx_platform_users_email_lower'
  ) then
    execute 'alter index core.idx_platform_users_email_lower rename to idx_admin_users_email_lower';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'core' and table_name = 'admin_users'
  ) then
    execute $cmt$
      comment on table core.admin_users is 'Internal admins; hospital staff remain in core.users'
    $cmt$;
  end if;
end $$;
