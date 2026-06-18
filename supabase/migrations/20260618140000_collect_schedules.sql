-- 데이터 수집 스케줄러: admin 에서 설정한 자동 수집 일정을 저장.
-- Vercel 크론(매시)이 이 테이블을 읽어 '지금 실행할' 스케줄의 collect_jobs 를 생성한다.
create table if not exists analytics.collect_schedules (
  id            uuid primary key default gen_random_uuid(),
  label         text not null default '',
  enabled       boolean not null default true,
  -- 수집 항목(blog_metrics/smartplace/keyword_rank/searchad/place_reviews). 빈 배열 = 전체 항목.
  steps         text[] not null default '{}',
  -- 대상 범위: 'all'(전체 병원 배치) | 'hospitals'(지정 병원들)
  scope         text not null default 'all' check (scope in ('all', 'hospitals')),
  hospital_ids  uuid[] not null default '{}',
  -- 주기: 'daily'(매일) | 'weekly'(지정 요일들). hour = KST 0~23. weekdays = weekly 일 때 0(일)~6(토) 다중.
  frequency     text not null default 'daily' check (frequency in ('daily', 'weekly')),
  hour          int  not null default 5 check (hour >= 0 and hour <= 23),
  weekdays      int[] not null default '{}',
  -- searchad 단계용 옵션(선택)
  searchad_start_date   date,
  searchad_end_date     date,
  searchad_campaign_ids text[],
  -- 중복 실행 방지용 마지막 발화 시각
  last_fired_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

grant select, insert, update, delete on analytics.collect_schedules to service_role;
