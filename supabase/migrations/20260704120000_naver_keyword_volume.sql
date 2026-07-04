-- Incremental migration (idempotent): 네이버 키워드 월간 검색량 스냅샷.
-- 검색량은 전국 수치(계정·병원 무관)라 키워드 단위로 전역 저장한다.
-- 월별로 쌓아 최신값 표시 + 추세 비교에 사용.

create schema if not exists analytics;

create table if not exists analytics.naver_keyword_volume (
  keyword       text        not null,             -- 정규화(공백 제거)한 키워드
  year_month    text        not null,             -- 데이터 기준 월 'YYYY-MM'
  pc_count      integer     not null default 0,
  mobile_count  integer     not null default 0,
  total_count   integer     not null default 0,
  comp_idx      text        not null default '',  -- 경쟁정도(높음/중간/낮음)
  under10       boolean     not null default false,-- '< 10' 저검색량 여부
  checked_at    timestamptz not null default now(),
  primary key (keyword, year_month)
);

-- 키워드로 최신 월을 빠르게 찾기 위한 인덱스.
create index if not exists naver_keyword_volume_keyword_month_idx
  on analytics.naver_keyword_volume (keyword, year_month desc);
