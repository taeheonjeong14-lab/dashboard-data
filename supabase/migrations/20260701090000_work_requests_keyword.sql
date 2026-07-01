-- 작업 목록 '블로그 저장' 배정 시, 케이스마다 요청자가 지정하는 키워드.
--  board='blog_save' 에서만 사용(블로그 작성 배정에는 불필요) — 자유 입력, 선택.
alter table health_report.work_requests
  add column if not exists keyword text;
