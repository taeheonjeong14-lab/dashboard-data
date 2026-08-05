-- core.admin_users 에 service_role 읽기 권한 부여.
--
-- 왜: 이 테이블만 grant 구문이 빠져 있었다(20260510120000_core_admin_users.sql).
-- service_role 로 조회하면 42501 permission denied 가 나고, 운영자 알림 호출부 세 곳이
-- 모두 error 를 버리고 data=null → 수신자 0명 → 조용히 return 했다.
-- 그 결과 core.notifications 의 type='admin_error' 가 전체 기간 0건이었다.
-- (2026-08-05 알림톡 발신프로필키 오류가 아무에게도 안 간 원인)
--
-- admin 로그인 판정은 ddx-api 가 Prisma 직접 연결로 읽어서 영향이 없었다 — 그래서 여태 안 드러났다.
-- 읽기만 필요하다(쓰기는 수동 INSERT 로 운영 중).

grant select on table core.admin_users to service_role;
