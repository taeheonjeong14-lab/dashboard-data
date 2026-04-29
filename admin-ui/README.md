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

## 병원 실적 업로드 (차트 업로드)

업로드 화면에서 병원 + 차트 종류 + 엑셀을 선택하고 아래 순서로 실행합니다.

1. `미리보기`
   - 유효 행/오류 행
   - 기간
   - 예상 매출 합계
   - 예상 진료건수(일자+고객+환자 unique, 미상 이름 제외)
2. `업로드 확정`
   - raw line item 적재: `analytics.chart_transactions_raw`
   - 고객 마스터 병합: `analytics.chart_customer_master`
   - 고객-환자 링크 병합: `analytics.chart_customer_patients`
   - 일간 KPI upsert: `analytics.chart_daily_kpis`
   - 오류 행 저장: `analytics.chart_upload_errors`
   - 실행 이력 저장: `analytics.chart_upload_runs`

`신규고객 수`는 고객 마스터의 `first_visit_date` 기준으로 계산합니다.

### 차트 종류별 기준 차이 (중요)

- 차트 종류마다 원천 데이터 구조가 달라 지표 해석 기준이 다를 수 있습니다.
- 특히 `visit_count`(방문수) 기준은 차트 종류별로 다를 수 있으니, 동일 병원이라도 다른 차트의 값을 직접 비교할 때 주의하세요.
- **IntoVet / Woorien PMS**
  - 방문수: `(일자 + 고객 + 환자) unique`
  - IntoVet 중복 덮어쓰기: `(진료일자 + 고객번호(B열) + 보호자명 + 영수증번호(F열) + 금액)`이 같으면 같은 거래로 간주하고, 병원 전체 업로드 이력 기준으로 최신 업로드 데이터로 치환됩니다.
  - IntoVet 환불 상계 제외: 동일 `(일자 + 고객 + 영수증번호)` 그룹의 금액 합이 0이면 raw에는 남겨두되 KPI(매출/방문/신규고객) 계산에서는 제외합니다.
  - IntoVet 부분환불 처리: 동일 `(일자 + 고객 + 영수증번호)` 그룹의 금액 합이 0보다 크면 KPI에서는 해당 그룹을 1건으로 보고 순금액(합산값)만 반영합니다.
  - Woorien PMS 중복 덮어쓰기: `(진료일자 + 보호자명 + 환자명 + 진료내용(F열))`이 같으면 병원 전체 업로드 이력 기준으로 최신 업로드 데이터로 치환됩니다.
- **eFriends**
  - eFriends 중복 덮어쓰기: `(진료일자 + 고객명 + 청구서번호(G열))`이 같으면 병원 전체 업로드 이력 기준으로 최신 업로드 데이터로 치환됩니다.
  - 보호자 1명이 여러 환자를 보유하는 경우 실제 방문 환자 특정이 어려울 수 있어, 방문수는 **환자 구분 없이 `(일자 + 고객)` 기준으로 해석**하는 것을 권장합니다.
  - 괄호 안 환자명은 참고용이며, KPI 방문 구분 기준으로 강제 사용하지 않습니다.
  - 동명이인(고객명 동일) 구분을 위해 보유 환자 목록 유사도 기반으로 고객을 분리/병합할 수 있으며(서버 재빌드 단계), 이로 인해 동일 고객명이더라도 고객이 여러 개로 분리될 수 있습니다.

### 미상 이름 처리 규칙

- 고객명 또는 환자명이 비어 있는 row는 오류로 버리지 않고 업로드합니다.
- 비어 있는 이름은 각각 `(고객명 미상)`, `(환자명 미상)`으로 저장됩니다.
- IntoVet B컬럼 고객번호가 있어도, 미상 row에서는 고객 식별키 계산에 사용하지 않습니다.
- 미상 row는 `sales_amount`에는 포함되지만, `visit_count`와 `new_customer_count`에서는 제외됩니다.

## 검증 시나리오

1. **중복 업로드 방지**
   - IntoVet에서 동일 `(진료일자 + 보호자명 + 영수증번호)` 행을 포함한 파일을 다시 업로드
   - 기대 결과: `chart_transactions_raw`는 해당 중복 키 기준으로 1건만 남고 최신 업로드(`run_id`)로 갱신
2. **에러 행 분리 저장**
   - A(일자) 또는 D(환자명) 누락 행이 포함된 파일 업로드
   - 기대 결과: 정상 행은 적재, 누락 행은 `chart_upload_errors` 저장
3. **신규고객 계산**
   - 첫 업로드 후 다음 날짜 파일 재업로드
   - 기대 결과: 이미 존재 고객은 `new_customer_count`에 재집계되지 않음
4. **미상 이름 건 처리**
   - 고객명 또는 환자명이 비어 있는 행 + 금액 행을 포함해 업로드
   - 기대 결과: 해당 행은 raw에 저장되고 `sales_amount`에는 반영되지만, `visit_count`/`new_customer_count`는 증가하지 않음
5. **주/월 조회**
   - `chart_daily_kpis`가 생성된 뒤 `chart_kpis_period_view` 조회
   - 기대 결과: `period_type='week'|'month'` 합계가 일간 합과 일치

## 주의

- 이 UI는 로컬 운영 도구용이며 service role key를 사용합니다.
- `.env.local`은 절대 Git에 커밋하지 마세요.
