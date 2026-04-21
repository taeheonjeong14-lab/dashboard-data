# IntoVet Handoff (2026-04-21)

## 목적
IntoVet 엑셀 업로드를 통해 병원 실적을 표준화 적재하고, 일간 KPI(매출/진료건수/신규고객수)를 안정적으로 조회 가능하게 만든다.

## 오늘 합의된 핵심 (최종)
- IntoVet 기준에서 `customer_no`는 **사람(고객)** 기준이다.
- 한 사람이 여러 동물을 키워도, IntoVet transaction은 사람 기준으로 잡히므로:
  - transaction 집계 기준 = 고객(사람)
  - master 기준 = 고객(사람)
  - 신규 기준 = 신규고객(사람)
- 병원 간 고객번호 충돌이 가능하므로, 고객 키에는 병원 구분이 반드시 포함되어야 한다.
- `chart_type`는 환자/고객 키에 굳이 넣지 않아도 된다는 사용자 의견이 있었음.

## 현재 구현 상태 (코드 기준)
- admin-ui에 IntoVet 업로드 UI/파서/업로드 유틸이 추가된 상태.
- 다만 코드 일부는 초기 `patient` 용어/컬럼(`new_patient_count` 등) 관점이 남아 있어,
  내일 `customer` 기준으로 최종 정리 필요.

## DB 모델 방향 (내일 확정/정리)
- `analytics.chart_transactions_raw`
  - line item raw 저장
  - `customer_key_norm`는 고객(사람) 기준
  - `raw_payload(jsonb)`로 원본 행 보존
- `analytics.chart_customer_master` (권장)
  - 고객(사람) 마스터
  - `first_visit_date`로 신규고객 판단
- `analytics.chart_daily_kpis`
  - `sales_amount`
  - `visit_count` (일자+customer unique)
  - `new_customer_count` (first_visit_date 기준)
- `analytics.chart_upload_runs`, `analytics.chart_upload_errors`
  - 업로드 이력/오류행 관리

## SQL 실행 이슈
- 사용자가 SQL 실행 중 아래 오류를 경험:
  - `ERROR: 42P01: relation "analytics.chart_transactions_raw" does not exist`
- 원인: 테이블 생성 전에 후속 ALTER/INDEX SQL이 먼저 실행됨 (실행 순서 문제).

## 내일 시작 시 해야 할 일 (순서)
1. 현재 DB 상태 점검 (이미 생성된 테이블/컬럼 확인)
2. 단일 SQL로 정리:
   - create table if not exists ...
   - 인덱스
   - trigger(updated_at)
   - view(`chart_kpis_period_view`)
   - RLS + policy + grants
3. `patient` 용어를 `customer` 기준으로 코드/컬럼/문서 일치화
4. 업로드 1회 실제 검증:
   - raw 건수
   - customer master 증가
   - daily kpi 일치

## 검증 쿼리 체크리스트 (내일 바로 실행)
- 테이블 존재 여부:
  - `analytics.chart_upload_runs`
  - `analytics.chart_transactions_raw`
  - `analytics.chart_customer_master`
  - `analytics.chart_daily_kpis`
  - `analytics.chart_upload_errors`
- KPI 컬럼 확인:
  - `new_customer_count` 존재 여부
- 뷰 확인:
  - `analytics.chart_kpis_period_view`

## 내일 재개용 한 줄 프롬프트
`어제 IntoVet 하던 것 이어서. 고객(사람) 기준으로 SQL 단일 실행본부터 만들고, 현재 DB 상태 점검 후 코드/문서까지 customer 용어로 마무리해줘.`

## 참고
- 이 파일은 handoff 메모용이며, 계획 원문은 별도 plan 파일에 있음.
