-- 건강검진 리포트 "초안 vs 병원 최종본" 비교 분석(프롬프트 개선용).
-- admin 이 분석 대상으로 고른 run 만 여기에 행이 생기고, 그 순간의 콘텐츠를 draft 로 스냅샷한다.
-- (generated_run_content 는 병원 편집이 같은 행을 덮어쓰므로 초안이 남지 않는다 → 별도 보관)
-- 분석은 병원의 종료 행동(카카오 발송 / 공유 페이지 PDF 다운로드) 시 1회만 실행된다.
create table if not exists health_report.report_draft_diffs (
  id            uuid primary key default gen_random_uuid(),
  parse_run_id  uuid not null unique,
  hospital_id   uuid,
  -- admin 이 '분석 대상'으로 고른 시점의 생성 콘텐츠 스냅샷(= 병원에 넘긴 버전).
  draft         jsonb not null,
  -- selected(대기) → done(분석 완료) / error(분석 실패). 최초 트리거 1회만 실행.
  status        text not null default 'selected',
  -- 무엇이 분석을 발동시켰나: 'kakao' | 'download'
  triggered_by  text,
  -- 분석 시점의 병원 최종본(비교 대상 원본을 남겨 재분석 가능하게).
  final_payload jsonb,
  -- LLM 분석 결과(변경 필드별 지적 + 프롬프트 개선 제안).
  result        jsonb,
  error         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  analyzed_at   timestamptz
);

create index if not exists idx_report_draft_diffs_status
  on health_report.report_draft_diffs (status, created_at desc);
create index if not exists idx_report_draft_diffs_created
  on health_report.report_draft_diffs (created_at desc);

alter table health_report.report_draft_diffs enable row level security;
-- 정책 없음 = authenticated/anon 접근 불가. service_role(서버 라우트)만 접근한다.

grant select, insert, update, delete on health_report.report_draft_diffs to service_role;

comment on table health_report.report_draft_diffs is
  '건강검진 리포트 초안(admin 승인본) vs 병원 최종본 비교 분석. admin 프롬프트 개선 메뉴에서 조회.';
