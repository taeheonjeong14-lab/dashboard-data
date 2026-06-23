-- collect_jobs 출처 구분: admin 수동 실행 vs 크론 스케줄 자동.
-- 수집 내역(통합 화면)에서 [수동]/[스케줄] 배지를 구분해 표시하기 위함.
alter table analytics.collect_jobs
  add column if not exists origin text not null default 'manual';

comment on column analytics.collect_jobs.origin is 'manual=admin 수동 실행, schedule=크론 스케줄 자동';
