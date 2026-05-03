-- Run in Supabase SQL Editor (read-only checks).
-- Finds triggers/functions/views that may still reference old column names or fragile patterns.

-- ---------------------------------------------------------------------------
-- 1) Triggers on core.users (what runs on every INSERT/UPDATE — 스키마 변경 후 깨지기 쉬움)
-- ---------------------------------------------------------------------------
select
  tr.tgname as trigger_name,
  pg_get_triggerdef(tr.oid, true) as trigger_def
from pg_trigger tr
join pg_class rel on rel.oid = tr.tgrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'core'
  and rel.relname = 'users'
  and not tr.tgisinternal
order by tr.tgname;

-- ---------------------------------------------------------------------------
-- 2) PL/pgSQL 함수 본문에 예전 컬럼/패턴이 남아 있는지 (prosrc 일부 환경에서만 유효)
--    – "hospitalId" 는 20260503180000 이후 users 테이블에 없어야 함
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('core', 'robovet', 'public', 'extensions')
  and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
  and p.prosrc is not null
  and (
    p.prosrc ilike '%"hospitalId"%'
    or p.prosrc ilike '%.hospitalId%'
  )
order by 1, 2;

-- ---------------------------------------------------------------------------
-- 3) SQL/일반 언어 함수도 포함해 넓게 검색 (정규식으로 줄바꿈 무시)
--    집계 함수(prokind = 'a')는 pg_get_functiondef() 대상이 아니라 에러 남 — 제외
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  p.proname as function_name,
  l.lanname as lang
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname in ('core', 'robovet', 'public', 'extensions')
  and p.prokind <> 'a'
  and pg_get_functiondef(p.oid) ~* 'hospitalId'
order by 1, 2;

-- ---------------------------------------------------------------------------
-- 4) core / robovet 뷰 정의에 특정 토큰이 있는지 (뷰는 컬럼 드롭 후 깨짐)
-- ---------------------------------------------------------------------------
select
  schemaname,
  viewname,
  definition
from pg_views
where schemaname in ('core', 'robovet')
  and (
    definition ilike '%"hospitalId"%'
    or definition ilike '%users.hospitalId%'
  );

-- ---------------------------------------------------------------------------
-- 5) (선택) materialized views
-- ---------------------------------------------------------------------------
select
  n.nspname,
  c.relname as matview_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'm'
  and n.nspname in ('core', 'robovet', 'public');
