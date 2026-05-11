# UI 통합 (관리자 / 병원) — 진행 메모

기존 프로덕션 앱은 **끄거나 바꾸지 않은 채**, 이 레포 안에 **새 껍데기**만 추가한 상태입니다.

**관리자 UI 방향:** `admin-ui`(Vite)는 통합 **관리자용 웹(`apps/admin-web`)** 으로 기능을 옮긴 뒤 **폐기 예정**이다. 당분간 로컬 개발·참고용으로만 두고, 새 기능은 `admin-web`에만 넣는 것을 원칙으로 한다.

**의존성:** 루트에 `package-lock.json` **하나만** 둡니다. `chart-api` 등 하위 폴더에서 예전처럼 단독 `npm install`을 하면 워크스페이스와 어긋날 수 있으니, 패키지 추가·업데이트는 보통 레포 루트에서 `npm install`로 처리합니다.

| 경로 | 역할 |
|------|------|
| `admin-ui/` | 레거시 관리자용 Vite — 기능 이관 후 **삭제 예정** (`npm run admin:dev`). 새 작업은 `apps/admin-web/` |
| `apps/admin-web/` | 통합 관리자 Next — Vercel **`vet-solution-admin-ui`** — **`npm run admin-web:dev`** (포트 **3011**) |
| `apps/hospital-web/` | 통합 병원 Next — Vercel **`vet-solution-hospital-ui`** — **`npm run hospital:dev`** (포트 **3010**) |
| `packages/ui` | 공통 UI (`@dashboard/ui`) 자리 |
| `packages/api-client` | API 클라이언트 (`@dashboard/api-client`) 자리 |

기존 API 서비스 포트(참고): `ddx-api` 3001, `dashboard-api` 3002, `chart-api` 3003.

**통합 앱 Vercel 프로젝트명 (결정):** 레포 `dashboard-data`를 연결하고 Root Directory만 다르게 둔다.

| Vercel 프로젝트명 | 레포 내 폴더 | 용도 |
|-------------------|---------------|------|
| **`vet-solution-hospital-ui`** | `apps/hospital-web` | 병원용 통합 UI (스테이징·프로덕션 배포 시 동일 이름 사용 가능) |
| **`vet-solution-admin-ui`** | `apps/admin-web` | 관리자용 통합 UI |

**실제 프로덕션 URL:** [병원 `vet-solution-hospital-ui`](https://vet-solution-hospital-ui.vercel.app/) · [관리자 `vet-solution-admin-ui`](https://vet-solution-admin-ui.vercel.app/) (스타브 페이지 배포됨).

**Vercel Production 브랜치:** **`main`** 에 연결한다. (`vet-solution-hospital-ui` / `vet-solution-admin-ui` 프로젝트 모두 Settings → Git에서 Production Branch가 `main`인지 확인.)

**배포가 곧바로 “Canceled”일 때:** 레포 루트 `vercel.json`의 **`ignoreCommand`가 `exit 0`** 이면 Vercel이 **빌드를 건너뛴다**(로그에 `process.exit(0)` 한 줄만 나오는 경우). 서브폴더(`apps/hospital-web`) 프로젝트도 루트 설정을 타면 같은 증상이 난다. **항상 빌드하려면 해당 설정을 제거하거나 `exit 1`로 둔다.**

**Root Directory가 안 보일 때:** Vercel은 **GitHub의 `main`** 내용만 본다. `apps/hospital-web`이 **`main`에 커밋·푸시되기 전**이면 목록에 안 뜬다. 로컬에서 `develop`만 고치고 있으면 → **`main`으로 머지(또는 PR 머지) 후 `git push origin main`** → GitHub 웹에서 폴더 존재 확인 → 다시 Vercel에서 import 또는 설정 새로고침.

---

## 1. 배포 인벤토리 (채워 주세요)

**어디에 쓰나요:** 바로 **이 파일**(`docs/UI_CONSOLIDATION.md`) 아래 표 칸에 적으면 됩니다. Git에 커밋해 두면 팀과 에이전트가 같은 기준을 봅니다.

실사용 URL과 **실제 빌드 소스**(어느 레포·어느 폴더에서 빌드되는지)가 다르면 통합 중에 꼬이기 쉽습니다. 모르는 칸은 비워 두거나 비고에 “확인 필요”만 적어도 됩니다.

**찾는 방법(한 줄):** Vercel이라면 프로젝트 → **Settings → Git** (연결 레포·브랜치), **Settings → General → Root Directory**.

### 1-1. 통합 대상 서비스 (행마다 채우기)

`|`(파이프) 사이의 빈 칸에 내용을 넣으세요. 표가 깨지면 칸 안에서 줄바꿈하지 말고 한 줄로 적습니다.

**URL 칸:** 웹앱이면 브라우저 주소이면 되고, **`chart-api`·`dashboard-api`·`ddx-api` 같은 API**는 사용자용 화면이 없을 수 있습니다. 그럴 때는 비워 두거나, 프론트가 호출하는 **프로덕션 베이스 URL**(예: `https://◆◆◆.vercel.app`)을 적습니다. Vercel 프로젝트의 **Domains** 또는 배포 상세에 나오는 주소입니다. 로컬만이면 비우고 비고에 “미배포·로컬만”.

아래 표에서 **에이전트가 저장소·문서 기준으로 채운 칸**이 있습니다. 틀린 URL이 있으면(Vercel에서 이름 바꾼 경우 등) 직접 고쳐 주세요.

| 제품 (우리가 부르는 이름) | 공개 베이스 URL (웹 주소 또는 API 호출 기준 URL) | Git 레포 (`owner/repo`) | 배포 브랜치 | Root Directory | 호스팅 (예: Vercel 프로젝트명) | 비고 |
|---------------------------|--------------------------------------------------|-------------------------|------------|----------------|--------------------------------|------|
| dashboard-ui (병원 대시보드) | https://dashboard-ui-nu-weld.vercel.app/ | `taeheonjeong14-lab/dashboard-ui` | `main` | `.` | _(대시보드 UI 프로젝트명 확인)_ | 기존에 적어 둔 URL 유지 |
| DDx (수의료 AI 앱) | https://ddx-livid.vercel.app/ | `taeheonjeong14-lab/DDx` | `main` | `.` | _(DDx 프론트 프로젝트명 확인)_ | 기존에 적어 둔 URL 유지 |
| vet-report | https://vet-report-ochre.vercel.app/ | `taeheonjeong14-lab/vet-report` | `main` | `.` | _(vet-report 프로젝트명 확인)_ | 기존에 적어 둔 URL 유지 |
| chart-api | `https://chart-api-five.vercel.app` | `taeheonjeong14-lab/dashboard-data` | `main` | `chart-api` | _(예: `chart-api-five`)_ | 운영 URL 사용자 확인됨(`chart-api-five`). API 전용—브라우저 화면 아님. |
| dashboard-api | `https://dashboard-api-jade.vercel.app` | `taeheonjeong14-lab/dashboard-data` | `main` | `dashboard-api` | _(예: `dashboard-api-jade`)_ | 사용자 제공 프로덕션 URL. 루트에 서비스 요약·`/api/health` 등 노출. |
| ddx-api | `https://ddx-api.vercel.app` | `taeheonjeong14-lab/dashboard-data` | `main` | `ddx-api` | `ddx-api` | `ddx-api/README.md`에 명시된 프로덕션 URL(alias). 미세하게 다른 배포 URL도 있을 수 있음 |
| admin-ui (Vite, 이 레포) | _(비움)_ | `taeheonjeong14-lab/dashboard-data` | `main` | `admin-ui` | 미배포 | **폐기 예정:** `apps/admin-web`으로 옮긴 뒤 폴더·스크립트 제거. 현재는 로컬 `npm run admin:dev`만 |
| `apps/hospital-web` | **프로덕션:** `https://vet-solution-hospital-ui.vercel.app/` · 로컬 `http://localhost:3010` | `taeheonjeong14-lab/dashboard-data` | `main` | `apps/hospital-web` | **`vet-solution-hospital-ui`** | Vercel 배포 완료(스타브) |
| `apps/admin-web` | **프로덕션:** `https://vet-solution-admin-ui.vercel.app/` · 로컬 `http://localhost:3011` | `taeheonjeong14-lab/dashboard-data` | `main` | `apps/admin-web` | **`vet-solution-admin-ui`** | Vercel 배포 완료(스타브) |

**브랜치 참고:** 이 `dashboard-data` 레포는 **Vercel Production = `main`** 으로 통일한다. 표의 **배포 브랜치 `main`** 과 같다. 로컬 작업 브랜치가 `develop`이어도 되지만, Vercel·GitHub에 반영하려면 **`main`에 머지 후 푸시**해야 한다.

### 1-1b. 남은 확인 (선택)

1. ~~`dashboard-api` URL~~ → **`https://dashboard-api-jade.vercel.app`** 반영함.
2. ~~`chart-api-five` 일치 여부~~ → 확인됨.
3. ~~**외부 세 레포 Production 브랜치**~~ — 사용자 확인: 세 레포 모두 **`main`** (표에 반영함).
4. **호스팅 프로젝트명** 열 — Vercel 대시보드 이름과 맞추고 싶을 때만 채우면 됨.

### 1-2. 위 표에 없는 다른 배포 (있으면만 적기)

**의미:** `dashboard-ui`·DDx 같은 **메인 제품 말고**, 따로 URL이 있어서 “운영 중인 무언가”인데 위 행 목록에 없을 때 적는 칸입니다. 없으면 **비워 두면 됩니다.**

**예시:** 회사 소개 랜딩, 채용 페이지, 스토리북/내부 도구, 별도 워커·크론(HTTPS 트리거 URL이 있는 경우), 예전에 쓰다 버린 도메인이지만 아직 떠 있는 사이트 등.

| 이름 | 공개 URL (웹·API·워커 트리거 등, 없으면 비움) | 레포 / 브랜치 | Root Directory | 호스팅 | 비고 |
|------|-----|---------------|----------------|--------|------|
| | | | | | |
| | | | | | |

---

## 2. 통합 전에 당신이 준비해 주면 좋은 것

1. **위 배포 인벤토리 표** — 특히 “프로덕션 URL → 어떤 폴더에서 빌드되는지”.
2. **새 앱용 도메인/호스트 이름 초안** — **결정됨:** Vercel 프로젝트 **`vet-solution-hospital-ui`**(병원), **`vet-solution-admin-ui`**(관리자). 스테이징 전용을 따로 둘지, 프리뷰 배포만 쓸지는 나중에 선택.
3. **인증 리디렉트 URI** — Supabase 등에서 허용 리디렉트에 스테이징 URL을 추가할 수 있는지(담당 계정 access).
4. **CORS** — 새 오리진을 각 API에 넣을 때 누가 배포 설정을 바꿀 수 있는지(Vercel 프로젝트 권한).
5. **스모크 시나리오 3~5개** — “로그인 → 대시보드 숫자 확인”처럼 배포 후 매번 클릭으로 확인할 최소 목록.

---

## 2a. 사용자 필수 작업 (Vercel · Supabase · API)

레포에 코드가 들어가도 **아래를 직접 설정하지 않으면** 프로덕션에서 로그인·CORS가 동작하지 않습니다.

### Vercel 환경변수 (두 통합 앱 각각)

각 프로젝트 **`vet-solution-hospital-ui`** / **`vet-solution-admin-ui`** → Settings → Environment Variables:

| 변수 | 병원 앱 예시 | 관리자 앱 예시 |
|------|----------------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 동일 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon 공개 키 | 동일 |
| `NEXT_PUBLIC_SITE_URL` | `https://vet-solution-hospital-ui.vercel.app` | `https://vet-solution-admin-ui.vercel.app` |
| `NEXT_PUBLIC_DASHBOARD_API_URL` (선택) | `https://dashboard-api-jade.vercel.app` | 동일 |
| `DDX_API_BASE_URL` | _(비움)_ | **필수:** `https://ddx-api.vercel.app` 등 — 서버에서만 `/api/admin/check` 호출 |

로컬은 각 앱 폴더의 `.env.example`를 참고해 `.env.local`에 두면 됩니다.

### admin-web 관리자 인가 (ddx-api 연동)

Supabase 로그인만으로는 부족하고, **관리자만** `apps/admin-web`의 홈·대시보드를 보도록 서버에서 **`DDX_API_BASE_URL/api/admin/check?userId=`** 를 호출합니다.

- **ddx-api Vercel:** `ADMIN_EMAILS`(쉼표 구분)에 관리자 이메일을 넣거나, Postgres `core.users`에서 해당 사용자 `role`을 `'admin'`으로 둡니다. (`ddx-api/lib/admin.ts` 로직)
- **`core.users` 행이 없을 때:** 이메일 화이트리스트 매칭은 Supabase Auth 관리 API로 보완하므로, ddx-api에 **`SUPABASE_SERVICE_ROLE_KEY`** 가 있어야 합니다.
- DDx 가입 등으로 **`core.users.id` = Supabase Auth `uid`** 인 행이 이미 생기면, 관리자 지정은 **`role` 업데이트** 또는 **`ADMIN_EMAILS`** 추가만 하면 됩니다.

### Supabase Auth

Supabase 대시보드 → Authentication → URL configuration:

- **Site URL:** 각 앱의 프로덕션 베이스 URL(위 `NEXT_PUBLIC_SITE_URL`과 동일하게 맞추는 것을 권장).
- **Redirect URLs:** 다음 형태를 허용 목록에 추가합니다.
  - `http://localhost:3010/**`, `http://localhost:3011/**` (로컬)
  - `https://vet-solution-hospital-ui.vercel.app/auth/callback`
  - `https://vet-solution-admin-ui.vercel.app/auth/callback`
  - Vercel 프리뷰 URL을 쓸 경우 해당 호스트의 `/auth/callback`도 추가.

이메일·비밀번호 로그인 외 OAuth를 켤 경우에도 동일 리디렉트 규칙이 적용됩니다.

### dashboard-api CORS

브라우저에서 통합 앱이 `dashboard-api`를 호출하려면 호출 오리진이 허용되어야 합니다.

- 기본 허용 목록은 `dashboard-api/lib/cors.ts`에 있으며, **`vet-solution-hospital-ui`**·**`vet-solution-admin-ui`** 프로덕션 도메인이 포함되어 있습니다.
- **커스텀 도메인**만 붙일 때는 `dashboard-api` Vercel 프로젝트에 **`DASHBOARD_API_ALLOWED_ORIGINS`**(쉼표 구분)를 추가합니다. 자세한 예는 `dashboard-api/.env.example` 참고.
- CORS 코드 변경 후 **`dashboard-api`를 재배포**해야 반영됩니다.

---

## 3. 다음 구현 단계 (에이전트/개발자용)

- **`apps/hospital-web` · `apps/admin-web`:** Supabase SSR(`@supabase/ssr`), `/login`(이메일·비밀번호), `/auth/callback`, `/auth/signout`, 로그인 후 `/dashboard`(브라우저에서 `dashboard-api` `/api/health` CORS 스모크)까지 뼈대 추가됨.
- **`apps/admin-web`:** 비관리자는 `DDX_API_BASE_URL`·ddx-api `ADMIN_EMAILS` / `core.users.role` 기준으로 홈·대시보드 진입 차단.
- 다음은 실제 화면 이관·추가 RBAC·API 클라이언트 연동.
- **배포 인벤토리** 표는 통합 진행에 맞춰 계속 갱신한다.
- **`admin-ui` 폐기:** `admin-web`에 기능 패리티 생기면 워크스페이스·루트 `package.json`의 `admin:*` 스크립트·폴더 정리.
- 병원 정보 관리처럼 **중복**되는 관리 화면은 `apps/admin-web` 쪽 **단일 진실원**으로 모은 뒤 DDx 관리자에서는 제거 또는 링크만 유지.
- `dashboard-ui` / 외부 레포 코드는 **`git subtree` 또는 폴더 이관**으로 이 레포 `apps/` 아래로 들여오되, 프로덕션 스위치는 마지막에 한다.
