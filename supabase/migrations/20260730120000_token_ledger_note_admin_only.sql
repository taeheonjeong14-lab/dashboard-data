-- 관리자 토큰 지급 메모(billing.token_ledger.note)는 관리자 전용이다.
--
-- 병원은 토큰 내역을 core.my_usage_overview(security definer) 로만 보고, 그 함수는 note 를 내려주지 않는다.
-- 다만 authenticated 에게 billing.token_ledger 직접 SELECT 권한이 남아 있어(20260609140000_token_billing.sql)
-- billing 스키마가 PostgREST 에 노출되는 순간 병원 브라우저 토큰으로 note(+다른 병원 원장 전체)를 읽을 수 있다.
-- 앱에서 이 테이블을 authenticated 권한으로 읽는 경로는 없으므로(모든 조회는 definer 함수 또는 admin 서버 풀)
-- 직접 권한을 회수해 메모가 병원에 새는 경로를 닫는다.
revoke select on billing.token_ledger from authenticated;
