-- 내부 관리자 — 병원 귀속 core.users 와 분리. id = Supabase Auth user id (uuid text).

create table if not exists core.admin_users (
  id text primary key,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_admin_users_email_lower on core.admin_users (lower(email));

comment on table core.admin_users is 'Internal admins; hospital staff remain in core.users';
