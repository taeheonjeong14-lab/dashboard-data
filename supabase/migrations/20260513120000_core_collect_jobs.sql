-- 수집 Job Queue — Worker가 폴링해서 실행하는 방식
create table if not exists core.collect_jobs (
  id          uuid        primary key default gen_random_uuid(),
  hospital_id text,                        -- null = 전체 병원 배치
  status      text        not null default 'pending', -- pending | running | done | failed
  output      text,
  steps       jsonb,
  upserts     jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);

create index if not exists idx_collect_jobs_status_created
  on core.collect_jobs (status, created_at);

grant select, insert, update, delete on table core.collect_jobs to service_role;
