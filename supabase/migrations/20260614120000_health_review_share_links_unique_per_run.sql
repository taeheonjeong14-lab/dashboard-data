-- health_report.health_review_share_links: 한 (parse_run_id, content_type) 당 링크 1행만 유지.
-- 기존엔 admin 워크스페이스를 열 때마다 새 행이 INSERT 되어 run 하나에 수십~수백 행이 쌓였다.
-- 이 제약으로 발급(생성 시/재발급)이 INSERT … ON CONFLICT upsert 가 되어 단일 행을 갱신한다.
-- 7일 만료 정책은 그대로 둔다(과금 연동).

-- 1) 중복 제거 — (parse_run_id, content_type) 그룹에서 가장 최근(created_at, tie-break ctid) 1행만 남긴다.
--    hospital 목록이 원래 'ORDER BY created_at DESC LIMIT 1' 로 최신 링크를 골랐으므로 동작 동일.
delete from health_report.health_review_share_links a
using health_report.health_review_share_links b
where a.parse_run_id = b.parse_run_id
  and a.content_type = b.content_type
  and (a.created_at < b.created_at
       or (a.created_at = b.created_at and a.ctid < b.ctid));

-- 2) upsert 를 가능케 하는 unique 제약.
alter table health_report.health_review_share_links
  drop constraint if exists health_review_share_links_run_content_type_key;
alter table health_report.health_review_share_links
  add constraint health_review_share_links_run_content_type_key
  unique (parse_run_id, content_type);
