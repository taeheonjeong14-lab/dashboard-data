-- 외부 블로그 글 검수 이력(admin '글 검수' 메뉴). 내부(위저드) 검수는 runId 기반이라
-- health_report.generated_run_content(content_type='blog_review')에 저장되고, 여기엔 저장하지 않는다.
-- 쓰기/읽기 모두 service_role 만 — admin 화면은 API 라우트를 거친다.
create table if not exists health_report.blog_reviews (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null default 'external',   -- 현재는 'external' 만 적재
  source_url   text,                                -- 네이버 블로그 링크(붙여넣기 검수는 null)
  input_text   text not null,                       -- 검수한 본문(가져온/붙여넣은 원문)
  hospital_id  text,                                -- 과금 귀속 병원(바른플랜 환불 대상 판정에 사용)
  created_by   text,                                -- 실행 admin 사용자
  report       jsonb not null,                      -- BlogReview 결과(신호등·findings·지표)
  created_at   timestamptz not null default now()
);

create index if not exists idx_blog_reviews_created
  on health_report.blog_reviews (created_at desc);
create index if not exists idx_blog_reviews_hospital
  on health_report.blog_reviews (hospital_id, created_at desc);

alter table health_report.blog_reviews enable row level security;
-- 정책 없음 = authenticated/anon 접근 불가. service_role 은 RLS 우회.

grant select, insert, delete on health_report.blog_reviews to service_role;

comment on table health_report.blog_reviews is
  '외부 블로그 글 검수 이력. 내부(위저드) 검수는 generated_run_content(content_type=blog_review)에 저장.';
