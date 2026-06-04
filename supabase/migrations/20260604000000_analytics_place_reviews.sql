-- 플레이스(네이버 스마트플레이스) 리뷰 + LLM 감성 레이블 저장 테이블
-- 수집(스크래퍼)·레이블링(LLM)은 별도 단계에서 채운다. sentiment 가 null 이면 미분류.

create schema if not exists analytics;

create table if not exists analytics.analytics_place_reviews (
  hospital_id text not null,
  review_id text not null,                 -- 네이버 리뷰 고유 id(없으면 본문+작성자+날짜 해시)
  author_id text,                          -- 작성자 아이디/닉네임
  review_date date not null,               -- 리뷰 작성일(Asia/Seoul 기준 date)
  content text,                            -- 리뷰 본문
  rating numeric,                          -- 별점(있을 때)
  sentiment text,                          -- 'positive' | 'negative' | 'neutral' | null(미분류)
  sentiment_score numeric,                 -- 모델 신뢰도(선택)
  sentiment_model text,                    -- 레이블링한 모델명(예: gemini-2.5-flash)
  sentiment_labeled_at timestamptz,        -- 레이블링 시각
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  primary key (hospital_id, review_id)
);

create index if not exists idx_place_reviews_hospital_date
  on analytics.analytics_place_reviews (hospital_id, review_date desc);

-- 미분류 리뷰를 빠르게 집어오기 위한 부분 인덱스(레이블링 잡용)
create index if not exists idx_place_reviews_unlabeled
  on analytics.analytics_place_reviews (hospital_id, review_date desc)
  where sentiment is null;

-- 감성별 조회(긍정지수·부정 목록)용
create index if not exists idx_place_reviews_sentiment
  on analytics.analytics_place_reviews (hospital_id, sentiment, review_date desc);

alter table analytics.analytics_place_reviews
  drop constraint if exists analytics_place_reviews_sentiment_chk;
alter table analytics.analytics_place_reviews
  add constraint analytics_place_reviews_sentiment_chk
  check (sentiment is null or sentiment in ('positive', 'negative', 'neutral'));

grant select, insert, update on table analytics.analytics_place_reviews to service_role;
grant select on table analytics.analytics_place_reviews to authenticated;

alter table analytics.analytics_place_reviews enable row level security;

drop policy if exists "place_reviews_select_assigned_hospitals" on analytics.analytics_place_reviews;
create policy "place_reviews_select_assigned_hospitals"
  on analytics.analytics_place_reviews
  for select
  to authenticated
  using (
    exists (
      select 1
      from core.users u
      where u.id::text = auth.uid()::text
        and (
          lower(coalesce(u.role, 'member')) = 'admin'
          or u.hospital_id = analytics_place_reviews.hospital_id
        )
    )
  );
