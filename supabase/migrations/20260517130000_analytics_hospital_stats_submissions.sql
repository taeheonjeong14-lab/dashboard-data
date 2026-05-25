-- Hospital-side stats (Excel) submissions tracking

create table if not exists analytics.hospital_stats_submissions (
  id uuid default gen_random_uuid() primary key,
  hospital_id text not null,
  hospital_name text,
  chart_type text not null,
  file_name text not null,
  row_count integer not null default 0,
  date_from date,
  date_to date,
  status text not null default 'done',
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_hospital_stats_submissions_hospital_created
  on analytics.hospital_stats_submissions (hospital_id, created_at desc);

create index if not exists idx_hospital_stats_submissions_created
  on analytics.hospital_stats_submissions (created_at desc);

grant select, insert on analytics.hospital_stats_submissions to service_role;
grant select on analytics.hospital_stats_submissions to authenticated;

alter table analytics.hospital_stats_submissions enable row level security;

drop policy if exists "hospital_stats_submissions_select" on analytics.hospital_stats_submissions;
create policy "hospital_stats_submissions_select"
  on analytics.hospital_stats_submissions
  for select
  to authenticated
  using (
    exists (
      select 1 from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or u.hospital_id = hospital_stats_submissions.hospital_id
        )
    )
  );
