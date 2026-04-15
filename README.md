# 네이버 블로그 통계 수집 (Chrome 디버깅 모드)

동물병원 등 홍보 중인 네이버 블로그에서 **조회수**, **순방문자 수** 등을 수집하는 매크로입니다.  
Chrome을 **디버깅 포트**로 띄우고, 그 브라우저에 연결해서 이미 로그인된 세션으로 블로그 관리·통계 페이지에 접근합니다.

## 왜 Chrome 디버깅 모드인가?

- 네이버 블로그 **관리/통계**는 로그인 후에만 볼 수 있습니다.
- 스크립트만으로 로그인을 자동화하면 계정 정책·캡차 등 이슈가 생길 수 있어, **이미 로그인된 Chrome**을 쓰는 방식이 안전합니다.
- Chrome을 `--remote-debugging-port=9222`로 실행하면, 스크립트가 그 브라우저에 붙어서 **당신이 쓰는 그 탭/쿠키**로 통계 페이지에 접근합니다.

## 준비

- Node.js 18 이상
- Chrome 브라우저

```bash
npm install
```

## Supabase 연결 (선택)

엑셀 저장과 별개로 Supabase에도 일별 지표를 업서트하려면 환경변수를 설정합니다.

1. `.env.example`을 복사해 `.env` 생성
2. 아래 값 입력

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

3. Supabase SQL Editor에서 `supabase/schema.sql` 실행

환경변수가 없으면 기존처럼 엑셀만 저장됩니다.

## 블로그 키워드 순위: DB 직접 적재

`scripts/naver-rank-main.py`는 순위 수집 결과를 기본적으로 Supabase에 바로 적재합니다.

- 기본 동작: DB 업로드 (엑셀 저장 안 함)
- 적재 대상: `analytics.analytics_blog_keyword_ranks`
- 키워드 1행당 `섹션별 4건 + best 1건` 총 5건 upsert

예시:

```bash
python scripts/naver-rank-main.py input.xlsx
```

옵션:

- `--metric-date YYYY-MM-DD`: 적재 기준일 지정 (미지정 시 KST 오늘)
- `--no-db`: DB 업로드 없이 실행
- `--export-excel`: 결과를 `output.xlsx`로도 저장

## 블로그 키워드 순위: DB에서 엑셀 다운로드용 생성

사용자가 엑셀을 원할 때는 DB 데이터를 기준으로 엑셀을 생성합니다.

```bash
npm run export:ranks -- output.xlsx
```

기간 필터(선택):

```bash
RANK_EXPORT_START_DATE=2026-04-01 RANK_EXPORT_END_DATE=2026-04-30 npm run export:ranks -- april-output.xlsx
```

## 1단계: Chrome을 디버깅 포트로 실행

**반드시 기존 Chrome 창을 모두 닫은 뒤** 아래 중 하나로 실행하세요.

### Windows

**방법 A – 바로가기 수정**

1. Chrome 바로가기 우클릭 → **속성**
2. **대상** 칸 끝에 한 칸 띄고 아래 추가  
   `--remote-debugging-port=9222`
3. 확인 후, 이 바로가기로 Chrome 실행

**방법 B – 명령어로 실행**

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

(Chrome이 다른 경로에 있으면 그 경로로 바꿔서 실행)

### Mac

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

## 2단계: 네이버 로그인

- 디버깅 포트로 연 Chrome에서 **네이버에 로그인**합니다.
- 통계를 수집할 **블로그의 소유자 또는 관리 권한**이 있는 계정이어야 합니다.

## 3단계: 설정

`config.json`을 열어 블로그 ID를 넣습니다.

```json
{
  "blog": {
    "blogId": "실제_블로그ID"
  }
}
```

- 블로그 주소가 `https://blog.naver.com/animal_hospital` 이면 `blogId`는 `animal_hospital` 입니다.

통계 페이지 URL을 이미 알고 있다면 `statsUrl`에 직접 넣어도 됩니다.

```json
{
  "blog": {
    "blogId": "animal_hospital",
    "statsUrl": "https://blog.naver.com/animal_hospital/manage/visit/stat"
  }
}
```

## 4단계: 수집 실행

Chrome(디버깅 포트)은 **연 채로 두고**, 터미널에서:

### 블로그 ID를 명령줄로 지정 (config.json 수정 없이)

```bash
node index.js howtoanimal
```

또는

```bash
npm run collect -- howtoanimal
```

여러 블로그를 각기 다른 계정으로 수집할 때: 계정 전환 후 `node index.js 블로그ID`만 바꿔서 실행하면 됩니다. Excel 파일은 하나이며, 블로그별로 시트가 분리됩니다.

Supabase `core.hospitals.naver_blog_id`에 블로그 ID(예: `howtoanimal`)를 넣어두면, 실행 시 해당 컬럼으로 병원을 매핑해 `hospital_id`/`hospital_name`을 함께 저장합니다. 지표 원본은 `analytics.analytics_daily_metrics`에 저장됩니다.

### config.json의 blogId 사용

블로그 ID를 넘기지 않으면 config.json의 `blog.blogId`가 사용됩니다.

```bash
npm run collect
```

또는

```bash
node index.js
```

- 스크립트가 Chrome에 연결 → 블로그 관리/통계 페이지로 이동 → 조회수·순방문자 수집
- 결과는 `data/naver-blog-stat.xlsx`에 저장됩니다. 여러 블로그 수집 시 블로그별 시트로 구분됩니다.

## 결과 파일 예시

```json
{
  "stats": {
    "수집일시": "2025-02-15T12:00:00.000Z",
    "조회수": 12345,
    "순방문자수": 3200,
    "방문횟수": 15000,
    "평균방문횟수": 4.2,
    "재방문율": "35%"
  },
  "blogId": "animal_hospital"
}
```

## 포트 변경

`config.json`의 `chrome.debuggingPort`를 바꾸면, Chrome 실행 시 사용하는 포트만 같은 값으로 맞추면 됩니다.

```json
"chrome": {
  "debuggingPort": 9223
}
```

Chrome 실행 예: `--remote-debugging-port=9223`

## 주의사항

- 네이버 블로그 페이지 구조가 바뀌면 선택자나 파싱 로직을 조금 수정해야 할 수 있습니다.
- 수집 빈도는 네이버 이용약관·정책을 지키는 범위에서 사용하세요.
- 이 도구는 네이버 공식 API가 아니라 브라우저 자동화 방식입니다.

## 트러블슈팅

| 현상 | 확인할 것 |
|------|------------|
| Chrome에 연결할 수 없음 | Chrome을 `--remote-debugging-port=9222`로 실행했는지, 다른 Chrome 창이 먼저 떠 있지 않은지 확인 |
| "관리" 링크를 찾을 수 없음 | 해당 계정으로 블로그 관리 권한이 있는지, 블로그 홈에서 로그인 상태인지 확인 |
| 조회수/순방문자가 null | 통계 페이지가 완전히 로드된 뒤 수집되는지 확인. 필요 시 `config.json`에 `statsUrl` 직접 지정 |

Chrome 디버깅 모드로 실행하는 방법을 확인하려면:

```bash
node scripts/launch-chrome-debug.js
```

위 명령으로 현재 설정 포트 기준 실행 예시가 출력됩니다.

## Vercel 배포 (dashboard)

웹 대시보드는 `dashboard` 폴더의 Next.js 앱입니다. Vercel에서 아래처럼 설정하면 배포할 수 있습니다.

1. Vercel에서 `New Project` -> 이 GitHub 저장소 선택
2. `Root Directory`를 `dashboard`로 지정
3. Environment Variables 추가
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy 실행

### 배포 전 체크

- Supabase 프로젝트 API 설정에서 `analytics`, `core` 스키마가 노출되어 있어야 합니다.
- `core.users`에 `role`, `hospital_id`가 채워져 있어야 로그인 후 데이터가 보입니다.
- RLS 정책이 적용된 최신 `supabase/schema.sql`이 실행되어 있어야 합니다.
