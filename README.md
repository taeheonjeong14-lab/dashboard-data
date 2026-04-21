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

3. Supabase SQL 적용 (둘 중 하나)
   - **새 프로젝트·초기 구축**: SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql) 전체 실행
   - **이미 운영 중인 DB** (전체 스크립트 재실행이 부담스러울 때): SQL Editor에서 [`supabase/migrations/20260416120000_analytics_blog_keyword_targets.sql`](supabase/migrations/20260416120000_analytics_blog_keyword_targets.sql) 한 번 실행 (멱등)
4. Supabase Dashboard → **Settings → Data API**(또는 API)에서 스키마 **`analytics`** 가 PostgREST에 노출되어 있는지 확인하고, 테이블 **`analytics_blog_keyword_targets`** 가 클라이언트에서 접근 가능한지 확인합니다. (`core` 스키마도 대시보드·RLS에 필요합니다.)
5. (로컬) `npm install` 후 **`npm run verify:supabase`** — collector 루트 `.env` 또는 `.env.local`을 읽습니다. **`SUPABASE_URL`** 과 **`SUPABASE_SERVICE_ROLE_KEY`(service_role)** 가 있어야 전체 검사가 통과합니다.

환경변수가 없으면 기존처럼 엑셀만 저장됩니다.

## 블로그 키워드 순위: DB 직접 적재

`scripts/naver-rank-main.py`는 순위 수집 결과를 기본적으로 Supabase에 바로 적재합니다.

- 기본 동작: DB 업로드 (엑셀 저장 안 함)
- 적재 대상: `analytics.analytics_blog_keyword_ranks`
- 기본 입력 소스: DB (`analytics.analytics_blog_keyword_targets`)
- 키워드 1행당 `섹션별 4건 + best 1건` 총 5건 upsert

예시:

```bash
python scripts/naver-rank-main.py
```

옵션:

- `--metric-date YYYY-MM-DD`: 적재 기준일 지정 (미지정 시 KST 오늘)
- `--no-db`: DB 업로드 없이 실행
- `--export-excel`: 결과를 `output.xlsx`로도 저장
- `--use-debug-chrome`: 통계 수집과 같은 디버깅 Chrome 세션(CDP) 공유
- `--debug-port 9222`: CDP 포트 지정 (`--use-debug-chrome`과 함께 사용)
- `--input-source db|excel`: 입력 소스 선택 (기본 `db`)

입력 타깃 테이블(`analytics.analytics_blog_keyword_targets`) 예시 컬럼:

- `account_id` (블로그 ID)
- `hospital_id` (선택, 권한 필터용)
- `keyword`
- `is_active` (true만 수집)

키워드 입력·관리 UI는 분리된 dashboard 리포(권장 위치: `C:\Projects\dashboard-ui`)에서 운영합니다. 이 collector 리포는 DB 스키마·마이그레이션·수집 스크립트만 관리합니다.

같은 디버깅 Chrome 창 공유 예시:

```bash
python scripts/naver-rank-main.py --use-debug-chrome --debug-port 9222
```

환경변수로도 설정할 수 있습니다:

```bash
RANK_USE_DEBUG_CHROME=1 CHROME_DEBUGGING_PORT=9222 RANK_INPUT_SOURCE=db python scripts/naver-rank-main.py
```

엑셀 입력을 계속 사용하려면:

```bash
python scripts/naver-rank-main.py input.xlsx --input-source excel
```

## 블로그 관리자 지표(조회수/순방문자): 분리 수집 + 분리 테이블

기존 `index.js`는 블로그/플레이스를 한 번에 수집해 `analytics.analytics_daily_metrics`에 적재했지만, DB를 분리해서 관리하려면 아래 2개 스크립트를 사용합니다.

- 블로그 조회수/순방문자: `analytics.analytics_blog_daily_metrics`

```bash
npm run collect:blog-metrics -- howtoanimal
```

- 스마트플레이스 유입수: `analytics.analytics_smartplace_daily_metrics`

```bash
npm run collect:smartplace-inflow -- howtoanimal
```

**일별 수집 구간(공통 규칙):** 각 스크립트는 해당 적재 테이블에서 `account_id`(블로그·스마트플레이스) 또는 SearchAd의 `(hospital_id, customer_id)` 기준으로 `metric_date`의 **최댓값 다음날**부터 **KST 어제**까지만 채웁니다. 기존 행이 없으면 **KST 어제 포함 30일**을 한 번에 가져옵니다(초기 백필 일수는 `BLOG_METRICS_INITIAL_DAYS`, `SMARTPLACE_METRICS_INITIAL_DAYS`, `SEARCHAD_METRICS_INITIAL_DAYS`로 변경 가능). 이미 어제까지 반영돼 있으면 아무 것도 하지 않습니다.

## 원클릭 전체 수집 (권장)

분리된 수집기를 한 번에 실행하려면 아래 명령을 사용합니다.

```bash
npm run collect:all -- <core.hospitals.id>
```

- 실행 순서(고정): 블로그 지표 → 스마트플레이스 유입 → 블로그/플레이스 키워드 순위 → SearchAd
- 실패 정책: 중간 단계 실패 시 즉시 종료(fail-fast)
- 인자는 `core.hospitals.id`(hospital_id) 입니다.
- `collect:all`은 hospital_id로 `core.hospitals.naver_blog_id`를 조회해 블로그/스마트플레이스 수집을 실행합니다.
- 키워드 순위/SearchAd는 `COLLECT_HOSPITAL_ID` 필터를 적용해 해당 병원 데이터만 수집합니다.
- 키워드 순위(`naver-rank-main.py`)는 기존과 동일하게 환경변수/DB 입력 규칙을 따릅니다.
- SearchAd는 기본 증분 수집이며, `SEARCHAD_METRIC_DATE`를 지정하면 해당 **하루만** 강제 수집합니다.
- Chrome 포트 선택은 `core.hospitals.debug_port`(있으면 우선) → `config.json.hospitalPorts[hospital_id]` → `config.json.chrome.debuggingPort` 순으로 fallback 합니다.

주요 환경변수(기존과 동일):

- 공통 DB: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- 순위 수집: `RANK_INPUT_SOURCE`, `RANK_METRIC_DATE`, `RANK_USE_DEBUG_CHROME`, `CHROME_DEBUGGING_PORT`
- SearchAd: `SEARCHAD_METRIC_DATE`(선택, 지정 시 단일일만), `SEARCHAD_SECRET_PASSPHRASE`, `SEARCHAD_API_BASE_URL`, `SEARCHAD_METRICS_INITIAL_DAYS`(선택)
- 오케스트레이션 필터: `COLLECT_HOSPITAL_ID` (`collect:all` 실행 시 자동 주입)

## 블로그 키워드 순위: DB에서 엑셀 다운로드용 생성

사용자가 엑셀을 원할 때는 DB 데이터를 기준으로 엑셀을 생성합니다.

```bash
npm run export:ranks -- output.xlsx
```

기간 필터(선택):

```bash
RANK_EXPORT_START_DATE=2026-04-01 RANK_EXPORT_END_DATE=2026-04-30 npm run export:ranks -- april-output.xlsx
```

## 플레이스 순위: DB 직접 적재

`scripts/naver-rank-main.py`는 플레이스 결과도 Supabase에 업서트합니다.

- 적재 대상: `analytics.analytics_place_keyword_ranks`
- 업서트 키: `(metric_date, keyword, store_name, section, metric_key)`
- 현재 기본값: `section='플레이스'`, `metric_key='place_rank_integrated'`

주의:

- `--input-source db`일 때 플레이스 입력은 `analytics.analytics_place_keyword_targets`에서 읽습니다.
- 상호명은 별도 입력 없이 `core.hospitals.name`을 사용합니다.
- `core.hospitals.name`이 비어 있으면 해당 병원 키워드는 스킵됩니다.
- 엑셀 입력(`--input-source excel`)도 기존대로 사용 가능합니다.

## 네이버 검색광고(SearchAd): 병원별 계정 수집

`scripts/naver-searchad-main.py`는 병원별 광고계정을 순회하면서 검색광고 API 데이터를 수집해
`analytics.analytics_searchad_daily_metrics`에 업서트합니다.

- 계정 입력 테이블: `analytics.analytics_searchad_accounts`
- 성과 적재 테이블: `analytics.analytics_searchad_daily_metrics`
- 수집 단위: **캠페인 + 광고그룹**
- 기본 수집 구간: 계정별 `analytics_searchad_daily_metrics`의 `max(metric_date)` 다음날 ~ **KST 어제**. 데이터가 없으면 **어제 포함 30일**. `SEARCHAD_METRIC_DATE`를 켜면 증분을 끄고 그날만 수집

사전 준비:

1. Supabase SQL 적용 (둘 중 하나)
   - 신규/전체 반영: `supabase/schema.sql` 실행
   - 운영 DB 증분 반영: `supabase/migrations/20260416183000_analytics_searchad_tables.sql` 실행
2. `analytics.analytics_searchad_accounts`에 병원별 계정 입력
   - `hospital_id`, `customer_id`, `api_license`, `secret_key_encrypted`, `is_active`
   - `secret_key_encrypted`는 `enc::` 접두어 + 암호문(base64)을 권장하며, 이 경우 `SEARCHAD_SECRET_PASSPHRASE` 필요
   - 하위 호환으로 평문 값도 동작하지만 운영에서는 비권장
3. (선택) `.env`에 수집일/패스프레이즈 설정

실행:

```bash
npm run collect:searchad
```

또는:

```bash
python scripts/naver-searchad-main.py
```

검증:

```bash
npm run verify:supabase
```

`verify:supabase`는 SearchAd 관련 테이블 접근(`analytics_searchad_accounts`, `analytics_searchad_daily_metrics`)까지 점검합니다.

## 로컬 운영 UI (admin-ui)

SQL 직접 입력 대신 로컬 UI로 병원/키워드/SearchAd를 관리할 수 있습니다.

1. `admin-ui/.env.example`를 `admin-ui/.env.local`로 복사하고 값 입력
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_SERVICE_ROLE_KEY`
2. 실행:

```bash
npm run admin:dev
```

관리 대상:
- `core.hospitals` (`name`, `naver_blog_id`, `smartplace_stat_url`, `debug_port`)
- `analytics.analytics_blog_keyword_targets`
- `analytics.analytics_place_keyword_targets`
- `analytics.analytics_searchad_accounts`
- `analytics.chart_*` (IntoVet 원본/환자마스터/일간 KPI)

IntoVet 업로드 파이프라인:
- 원본 line item 적재: `analytics.chart_transactions_raw`
- 환자 마스터 갱신(첫방문일 관리): `analytics.chart_patient_master`
- 일간 KPI 적재: `analytics.chart_daily_kpis`
- 업로드 이력/오류: `analytics.chart_upload_runs`, `analytics.chart_upload_errors`
- 기간 조회 뷰: `analytics.chart_kpis_period_view` (`day|week|month`)

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

## Dashboard 리포 분리 안내

- 시각화/관리 UI는 별도 리포에서 운영합니다 (예: `C:\Projects\dashboard-ui`).
- 이 collector 리포에서는 DB 변경(DDL, RLS, migration)과 수집 스크립트 실행만 담당합니다.
- UI 리포는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 사용하고, collector 리포는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 사용합니다.
- 이 리포(`dashboard-data`)는 Vercel 배포 대상이 아닙니다. 실수 배포 방지를 위해 `vercel.json`의 `ignoreCommand`로 모든 Vercel 빌드를 스킵하도록 설정했습니다.

### Vercel 점검 체크리스트 (중요)

1. Vercel Project의 Git Repository가 UI 리포(`dashboard-ui`)를 가리키는지 확인
2. 기존에 이 리포(`dashboard-data`)에 연결된 Vercel Project가 있다면 해제 또는 삭제
3. UI 리포에 필요한 환경변수만 Vercel에 등록 (`NEXT_PUBLIC_*`)
4. 데이터 수집용 비밀키(`SUPABASE_SERVICE_ROLE_KEY`)는 Vercel UI 프로젝트에 넣지 않기
