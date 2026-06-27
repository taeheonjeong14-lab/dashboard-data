-- 경영통계 업로드 실패(57014 statement timeout) 해소.
-- 원인: 인제스트(chart-ingest)가 부르는 베이스 재빌드 analytics.rebuild_chart_for_run(bigint) 는
--   함수별 statement_timeout 설정이 없어, 연결 기본 제한(authenticator 8s)에 걸린다. 큰 업로드에서
--   매출·방문 raw 재스캔이 8초를 넘기면 57014 로 실패.
-- 형제 함수 recompute_new_customers_for_run 는 이미 statement_timeout='120s' 를 갖고 있어 안 걸린다.
-- 베이스에도 동일하게 부여(함수 본문 무수정, 설정만 추가). 베이스 재빌드는 업로드 날짜 범위만
-- 재계산하므로 120s 면 충분.
alter function analytics.rebuild_chart_for_run(bigint) set statement_timeout = '120s';
