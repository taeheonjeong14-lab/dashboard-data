# dashboard-api

**dashboard-ui** 전용 Next.js App Router BFF. DB 직접 접근·프록시·서버에서만 가능한 작업을 여기 둡니다.

## ddx-api와 역할 분리

| 영역 | 어디에 두나 |
|------|-------------|
| DDx 앱(문진·가입·설문·관리자 유저/병원 등) | **`../ddx-api`** |
| 대시보드만 필요한 API | **여기 (`dashboard-api`)** |

같은 경로·같은 도메인 로직을 **두 프로젝트에 중복 구현하지 않기.**

## 실행

```bash
cd dashboard-api
npm install
cp .env.example .env.local   # 채우기
npm run dev                 # http://localhost:3002
```

## 배포 (Vercel)

- **Root Directory:** **`dashboard-api`** (레포 루트 `.` 아님).
- 루트에만 `package-lock.json` 이 있으므로 `dashboard-api/vercel.json` 에 **`cd .. && npm ci`** / **`cd .. && npm run dashboard-api:build`** 가 설정되어 있습니다. **Install / Build Command 는 비워 두어도 됩니다.**

### 빌드 로그에 `naver-blog-stat` · `Couldn't find any pages or app directory` 가 나오면

Vercel 이 **레포 루트**에서 빌드하고 있는 것입니다. **Settings → General → Root Directory → `dashboard-api`** 로 저장 후 재배포하세요.

- `NEXT_PUBLIC_*` 는 dashboard-ui와 동일 Supabase면 동일 값 가능.

### 브라우저 CORS

다른 오리진에서 `fetch`로 호출할 때 허용 오리진은 `lib/cors.ts` **기본 목록**과 환경변수 **`DASHBOARD_API_ALLOWED_ORIGINS`**(쉼표 구분)를 **병합**합니다. 커스텀 도메인만 env에 넣어도 vet-solution·dashboard-ui 기본 허용은 유지됩니다.

## 구현된 API (dashboard-ui 스펙)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/blog/preview?url=` | HTML fetch 후 제목·canonical·설명·og:image URL JSON |
| GET | `/api/blog/preview-image?url=` | 이미지 바이너리 프록시 (`Cache-Control` 1h) |

클라이언트는 기존 대시보드 베이스 URL을 **`dashboard-api` 배포 주소**로 바꾸면 됨.

## 다음으로 넣을 후보
- PostgREST로 부족한 집계/서버 전용 쿼리 — Prisma·`pg`·Service Role 등은 필요할 때 `package.json` 에 추가.
