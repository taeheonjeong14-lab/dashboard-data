-- 병원 유저(마스터/스태프) 알림. 이벤트 1건당 수신자별로 1행(fan-out) 생성, read 는 행 단위.
create table if not exists core.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,        -- 수신자 (core.users.id)
  hospital_id text,
  type        text not null,        -- health_report_ready | case_blog_done | intake_submitted | survey_submitted | staff_approval_request
  title       text not null,
  body        text,
  link        text,                 -- 클릭 시 이동 경로
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifications_user on core.notifications (user_id, read, created_at desc);

grant select, insert, update on core.notifications to service_role;
grant select, update on core.notifications to authenticated;
