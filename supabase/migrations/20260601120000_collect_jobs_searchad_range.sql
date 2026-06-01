-- SearchAd 수집 잡의 사용자 지정 기간(admin 화면에서 선택).
-- 둘 다 채워지면 collect-worker가 SEARCHAD_METRIC_START/END 환경변수로 넘겨
-- 증분/청크 없이 그 구간만 수집한다. null이면 기존 자동(빠진 날짜) 수집.
alter table analytics.collect_jobs
  add column if not exists searchad_start_date date,
  add column if not exists searchad_end_date date;
