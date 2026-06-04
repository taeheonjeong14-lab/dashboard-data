-- 병원별 스마트플레이스 "리뷰" 페이지 URL.
-- 리뷰 스크래퍼(로그인 불필요, 순위 수집과 별개 매크로)가 이 URL로 리뷰를 긁는다.
-- 기존 smartplace_stat_url(통계용)과 다른 컬럼.

alter table core.hospitals
  add column if not exists smartplace_review_url text;
