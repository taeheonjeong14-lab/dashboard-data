-- 재추출(admin): 기존 run 을 덮어쓰는 추출 잡을 위한 컬럼.
-- 설정 시 워커(process.ts)가 chart-api 에 replaceRunId 로 전달 → 새 run 대신 그 run 을 덮어쓴다.
-- claim_extract_job 은 `returning *` 로 행 전체(테이블 타입)를 반환하므로, 컬럼 추가만으로 자동 포함된다(함수 수정 불필요).

alter table health_report.extract_jobs
  add column if not exists replace_run_id uuid;
