# 회원가입·권한 재설계 — 핸드오프

설계: 메모리 `project_signup_auth_redesign.md`. 빌드: ddx-api / admin-web / hospital-web 모두 통과. **전부 미커밋.**
현재 검증 수단 = **이메일 인증(인터림)**. 휴대폰 본인인증(PortOne)은 키 발급 후 교체.

## 구현 완료
- **Phase 0 스키마** — prisma + `20260619120000_signup_auth_phase0.sql` (이미 적용·generate 완료)
- **경로 A (새 병원+마스터, admin 1회 심사)**: 가입 마법사 → 병원정보+서류2개+마스터계정 → `ddx-api /api/registrations` (마스터 유저 생성, DI중복 플래그, **이메일 인증 메일 발송**) → 서류는 `hospital-web /api/registration-docs/sign`(`hospital-docs` 버킷) → admin `/admin/registrations` 심사 큐(파일 열람·승인/거절, 승인 시 `core.hospitals` 생성+마스터 활성화)
- **경로 B (스태프)**: 병원 검색→선택→스태프 가입 `ddx-api /api/registrations/staff` (**DI 중복 즉시 차단** + @더함마케팅 안내, 이메일 인증 발송) → Master 승인 대기
- **Master 멤버 관리**: 설정 모달 "멤버 관리" 탭(Master 전용) — 대기 스태프 승인/거절, 멤버 제외. API `hospital-web /api/members`(+`/[id]`)
- **로그인 게이트**((app)/layout): 신규 흐름=이메일인증 AND (마스터 approved / 스태프 staff_approved), 레거시(role 없음)=approved (회귀 없음, 백필 불필요)
- **Staff 권한 제한**: 경영 대시보드(`/dashboard`)만 차단 — 사이드바 메뉴 숨김 + dashboard layout 가드
- **본인인증 추상화** `ddx-api/lib/phone-verify.ts` — 지금은 STUB(휴대폰 해시로 DI 생성, DI중복 로직 동작). PortOne 키 오면 실연동.

## 아직 안 함
- **PortOne 휴대폰 본인인증 실연동** (키 발급 후 stub 교체 + 가입 UI에 본인인증 팝업)
- **승인/거절 알림**(병원 이메일 + 대표원장 알림톡) — 코드에 TODO. 템플릿/자격증명 필요.
- 스태프 **초대 링크**(현재는 자가가입→Master 승인 방식)
- 기존 가입 유저/병원 master 일괄 지정 백필(원하면)

## ☀️ 네가 할 일
1. **Supabase Auth → "Confirm email" OFF** 확인 (가입 직후 자동 로그인해 서류 업로드/세션 필요. 기존 커스텀 인증 쓰던 터라 이미 off 가능성↑).
2. **(완료)** 마이그레이션·prisma generate·`hospital-docs` 버킷.
3. **이메일 발송 동작 확인** — ddx-api Resend env (기존 가입 인증 메일과 동일 경로 `sendVerificationEmail`). 안 되면 env 확인.
4. **검토 후 커밋/푸시.**
5. PortOne 키 나오면 알려줘 → phone-verify 실연동.

## 지금 테스트 흐름 (이메일 인증)
1. /signup → 병원 검색(없음) → 새 병원 등록(정보+서류+마스터계정) → 제출 → **인증 메일 클릭** + admin 승인 → 마스터 로그인.
2. /signup → 같은 병원 검색·선택 → 스태프 가입 → **인증 메일 클릭** → 마스터가 설정 "멤버 관리"에서 승인 → 스태프 로그인.
3. 스태프로 로그인 시 좌측 "경영 대시보드" 안 보이고 `/dashboard` 직접 접근도 차단.
