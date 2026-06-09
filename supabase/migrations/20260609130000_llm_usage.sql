-- LLM/AI usage 로깅 (과금 1단계: USD 기준 사용량 적재).
-- 토큰은 프로바이더 간 비교 불가하므로 cost_usd(원천)를 기록. 원화·크레딧 환산은 조회/과금 시점에.
create schema if not exists billing;

create table if not exists billing.llm_usage (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid,                       -- 병원 귀속(없으면 null = 시스템/미귀속)
  user_id         uuid,
  feature         text,                       -- 'blog_causal' | 'blog_outline' | 'blog_post' | 'health_checkup' | 'extract' | 'disease_intro' | 'image_analysis' | 'ocr' ...
  run_id          uuid,
  provider        text not null,              -- 'gemini' | 'openai' | 'anthropic' | 'google_vision'
  model           text not null,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cached_tokens   integer not null default 0, -- 캐시 입력 토큰(저단가)
  thinking_tokens integer not null default 0, -- Gemini thoughts 등(출력 단가로 과금)
  units           integer,                    -- 토큰이 아닌 서비스(OCR 등)의 처리 단위(이미지/페이지 수)
  cost_usd        numeric(12,6) not null default 0,
  meta            jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_llm_usage_hospital_created on billing.llm_usage (hospital_id, created_at desc);
create index if not exists idx_llm_usage_created on billing.llm_usage (created_at desc);
create index if not exists idx_llm_usage_feature on billing.llm_usage (feature);

grant usage on schema billing to service_role;
grant select, insert on billing.llm_usage to service_role;
grant usage on schema billing to authenticated;
grant select on billing.llm_usage to authenticated;
