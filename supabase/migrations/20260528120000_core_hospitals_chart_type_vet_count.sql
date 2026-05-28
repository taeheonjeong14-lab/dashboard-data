-- 병원 관리(설정 모달)용 컬럼.
-- chart_type: 병원이 사용하는 차트 시스템 (intovet / woorien_pms / efriends).
-- vet_count: 수의사 수 (1~100).
alter table if exists core.hospitals
  add column if not exists chart_type text;

alter table if exists core.hospitals
  add column if not exists vet_count integer;
