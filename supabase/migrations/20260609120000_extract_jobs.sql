-- 비동기 추출 작업 큐: 병원이 제출하면 즉시 접수(job)만 만들고, 추출/저장은 백그라운드 워커가 처리한다.
-- 진료케이스(blog_case)·건강검진(hospital_notes) 공용.

create schema if not exists health_report;

create table if not exists health_report.extract_jobs (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  user_id         uuid not null,
  chart_type      text not null,
  kind            text not null check (kind in ('blog_case', 'hospital_notes')),
  storage_bucket  text not null,
  storage_paths   jsonb not null default '[]'::jsonb,   -- 업로드된 PDF 경로들
  payload         jsonb not null default '{}'::jsonb,    -- overview/emphasis + image_groups 등
  status          text not null default 'queued' check (status in ('queued', 'processing', 'done', 'error')),
  run_id          uuid,                                  -- 추출 성공 시 생성된 parse_run id
  error_text      text,
  token_cost      integer not null default 0,
  token_deducted  boolean not null default false,
  attempts        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists extract_jobs_status_idx   on health_report.extract_jobs (status, updated_at);
create index if not exists extract_jobs_hospital_idx on health_report.extract_jobs (hospital_id, created_at desc);

grant select, insert, update on table health_report.extract_jobs to service_role;
grant select on table health_report.extract_jobs to authenticated;

-- 원자적 점유: queued 이거나 오래 멈춘 processing 인 job 을 processing 으로 전환하며 attempts++.
-- 동시에 after()와 cron 이 같은 job 을 잡지 않도록 단 하나만 성공한다(반환 행이 있으면 점유 성공).
create or replace function health_report.claim_extract_job(p_id uuid, p_stale_seconds integer default 900)
returns health_report.extract_jobs
language plpgsql
security definer
as $$
declare
  j health_report.extract_jobs;
begin
  update health_report.extract_jobs
     set status = 'processing',
         attempts = attempts + 1,
         updated_at = now()
   where id = p_id
     and (
       status = 'queued'
       or (status = 'processing' and updated_at < now() - make_interval(secs => p_stale_seconds))
     )
  returning * into j;
  return j; -- 점유 실패 시 NULL
end;
$$;

grant execute on function health_report.claim_extract_job(uuid, integer) to service_role;
