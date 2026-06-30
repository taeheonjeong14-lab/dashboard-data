-- 작업 현황판 '작업 목록' 탭 — 내부 인원 간 블로그 작업 의뢰(드래그 배치).
--  board: 'blog_write'(요청→작성완료) | 'blog_save'(작성완료→저장완료)
--  카드가 다음 단계로 넘어가는 것은 실제 작업 시 status 가 자동 반영되므로, 여기선
--  '누가/언제까지 해달라'는 의뢰(요청자·마감일·요청일시)와 드래그 순서만 기록한다.
create schema if not exists health_report;

create table if not exists health_report.work_requests (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null,                              -- chart_pdf.parse_runs.id (블로그 아이템)
  board       text not null check (board in ('blog_write','blog_save')),
  requester   text,                                       -- 요청자(자유 입력)
  due_date    date,                                       -- 마감일
  sort_order  double precision not null default 0,        -- 드래그 순서(작을수록 위)
  created_at  timestamptz not null default now(),         -- 요청일시(자동)
  created_by  uuid                                        -- 작성 admin user(선택)
);

-- 같은 아이템을 같은 보드에 중복 배치 금지
create unique index if not exists work_requests_run_board_uniq
  on health_report.work_requests (board, run_id);
create index if not exists work_requests_board_sort_idx
  on health_report.work_requests (board, sort_order);

-- 서버 라우트는 service_role 로 접근한다.
grant select, insert, update, delete on health_report.work_requests to service_role;
