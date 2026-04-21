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
- IntoVet 실적 업로드 (`analytics.chart_*`)

## IntoVet 업로드

업로드 화면에서 병원 + IntoVet 엑셀(`.xls`)을 선택하고 아래 순서로 실행합니다.

1. `미리보기`
   - 유효 행/오류 행
   - 기간
   - 예상 매출 합계
   - 예상 진료건수(일자+환자 unique)
2. `업로드 확정`
   - raw line item 적재: `analytics.chart_transactions_raw`
   - 환자 마스터 병합: `analytics.chart_patient_master`
   - 일간 KPI upsert: `analytics.chart_daily_kpis`
   - 오류 행 저장: `analytics.chart_upload_errors`
   - 실행 이력 저장: `analytics.chart_upload_runs`

`신규환자 수`는 환자 마스터의 `first_visit_date` 기준으로 계산합니다.

## 검증 시나리오

1. **중복 업로드 방지**
   - 같은 파일을 2회 업로드
   - 기대 결과: `chart_upload_runs`는 같은 `source_file_hash` 기준으로 1건 유지, raw는 중복 없이 upsert
2. **에러 행 분리 저장**
   - A(일자) 또는 D(환자명) 누락 행이 포함된 파일 업로드
   - 기대 결과: 정상 행은 적재, 누락 행은 `chart_upload_errors` 저장
3. **신규환자 계산**
   - 첫 업로드 후 다음 날짜 파일 재업로드
   - 기대 결과: 이미 존재 환자는 `new_patient_count`에 재집계되지 않음
4. **주/월 조회**
   - `chart_daily_kpis`가 생성된 뒤 `chart_kpis_period_view` 조회
   - 기대 결과: `period_type='week'|'month'` 합계가 일간 합과 일치

## 주의

- 이 UI는 로컬 운영 도구용이며 service role key를 사용합니다.
- `.env.local`은 절대 Git에 커밋하지 마세요.
