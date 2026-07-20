-- 진료케이스 블로그 글 "AI 초안(BEFORE) vs 확정본(AFTER)" 비교 분석(프롬프트 개선용).
--
-- 건강검진(report_draft_diffs)과 달리 admin 이 대상을 고르지 않는다 — 모든 케이스가 자동으로 잡힌다.
--   BEFORE: 2→3단계에서 chart-api 가 blog_post 를 **전체 생성**할 때마다 갱신(재생성하면 마지막 AI 버전이 기준).
--           섹션 단위 재생성·간결화는 부분 수정이라 BEFORE 를 건드리지 않는다.
--   AFTER : 4단계 검수 후 담당자가 '확정' 을 누른 시점의 글. 이때 1회 분석한다.
-- (generated_run_content 는 편집이 같은 행을 덮어써서 초안이 남지 않으므로 별도 보관)
create table if not exists health_report.blog_draft_diffs (
  id            uuid primary key default gen_random_uuid(),
  parse_run_id  uuid not null unique,
  hospital_id   uuid,
  -- blog_post 를 전체 생성한 시점의 AI 초안 스냅샷 { title, bodyMarkdown, tags, charCount }.
  draft         jsonb not null,
  -- draft(초안만 있음) → running(분석 중) → done(완료) / error(실패). 확정 1회만 분석.
  status        text not null default 'draft',
  -- 확정 시점의 최종본(비교 원본을 남겨 재분석 가능하게).
  final_payload jsonb,
  -- LLM 분석 결과. 이 분석은 **말 표현 변경**만 본다(정보량이 같은데 텍스트가 바뀐 경우).
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  analyzed_at   timestamptz
);

create index if not exists idx_blog_draft_diffs_status
  on health_report.blog_draft_diffs (status, created_at desc);
create index if not exists idx_blog_draft_diffs_created
  on health_report.blog_draft_diffs (created_at desc);

alter table health_report.blog_draft_diffs enable row level security;
-- 정책 없음 = authenticated/anon 접근 불가. service_role(서버 라우트)만 접근한다.

grant select, insert, update, delete on health_report.blog_draft_diffs to service_role;

comment on table health_report.blog_draft_diffs is
  '진료케이스 블로그 글 AI 초안 vs 확정본 비교 분석(말 표현 변경 중심). admin 프롬프트 개선 메뉴에서 조회.';
