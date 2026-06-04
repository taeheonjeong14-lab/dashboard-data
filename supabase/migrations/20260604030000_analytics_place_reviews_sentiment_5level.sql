-- 감성 라벨을 3단계 → 5단계로 세분화.
-- strong_positive / positive / neutral / negative / strong_negative

alter table analytics.analytics_place_reviews
  drop constraint if exists analytics_place_reviews_sentiment_chk;

alter table analytics.analytics_place_reviews
  add constraint analytics_place_reviews_sentiment_chk
  check (
    sentiment is null
    or sentiment in ('strong_positive', 'positive', 'neutral', 'negative', 'strong_negative')
  );
