# Dashboard Data Admin UI

로컬에서 Supabase 운영 데이터를 관리하는 간단한 UI입니다.

## 준비

1. `admin-ui/.env.example`를 `admin-ui/.env.local`로 복사
2. 아래 값 입력

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_SERVICE_ROLE_KEY`

## 실행

루트(`dashboard-data`)에서:

```bash
npm run admin:dev
```

브라우저에서 표시된 로컬 주소(기본 `http://localhost:5173`)를 열면 됩니다.

## 제공 기능

- 병원 기본 정보 (`core.hospitals`)
- 병원별 포트 (`core.hospitals.debug_port`)
- 블로그 키워드 타깃 (`analytics.analytics_blog_keyword_targets`)
- 플레이스 키워드 타깃 (`analytics.analytics_place_keyword_targets`)
- SearchAd 계정 (`analytics.analytics_searchad_accounts`)

## 주의

- 이 UI는 로컬 운영 도구용이며 service role key를 사용합니다.
- `.env.local`은 절대 Git에 커밋하지 마세요.
