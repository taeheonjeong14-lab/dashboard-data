import "./health-report-summary-sheet.css";
import { HealthReportInnerSheetHeader } from "./health-report-inner-sheet-header";
import { formatKoreanShortDateKst } from "./kst-date-format";
import { formatDirectorHospitalLine } from "./report-director-line";

/** 문단 단위로 쪼갠다. \n\n 있으면 그걸 기준으로, 없으면 \n 기준. */
function splitParagraphs(text: string): string[] {
  const byDouble = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (byDouble.length > 1) return byDouble;
  return text.split(/\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * 종합소견·사후관리 문단 렌더.
 * 「번호. 주제명」으로 시작하는 줄(첫 줄)은 bold 처리하고, 그 아래 본문 줄은 기본 굵기로 둔다.
 */
function renderSummaryParagraph(para: string, i: number) {
  const nl = para.indexOf("\n");
  const firstLine = nl === -1 ? para : para.slice(0, nl);
  const rest = nl === -1 ? null : para.slice(nl);
  const numbered = /^\s*\d+\.\s/.test(firstLine);
  return (
    <p key={i} className="hrss-placeholder-text">
      {numbered ? <span className="hrss-topic-num">{firstLine}</span> : firstLine}
      {rest}
    </p>
  );
}

export type HealthReportSummaryTimelineItem = {
  intervalLabel: string;
  /** 카드 상단 제목(비우면 미표시). 저장 문자열은 첫 줄바꿈 기준으로 제목/본문 분리 */
  cardTitle?: string;
  cardBody: string;
};

export type HealthReportSummarySheetProps = {
  hospitalNameKo?: string;
  hospitalNameEn?: string;
  hospitalLogoSrc?: string;
  hospitalLogoAlt?: string;
  overallSummary?: string;
  followUpPlan?: string;
  /** 기본 4칸 — 개수만큼 렌더 */
  timelineItems?: HealthReportSummaryTimelineItem[];
  reportDateLine?: string;
  /** `○○병원 원장` */
  directorTitleLine?: string;
  /** 성명(글자 간 공백). 비우면 제목만 표시 */
  directorNameSpread?: string;
  /** 직인 이미지 — 제공 시 푸터 우측 */
  sealImageSrc?: string;
  sealImageAlt?: string;
  /** report-a4-tokens CSS 변수 오버라이드(병원별 테마) */
  tokenOverrides?: Record<string, string>;
};

const DEFAULT_TIMELINE: HealthReportSummaryTimelineItem[] = [
  { intervalLabel: "1-2주 이내", cardTitle: "혈압", cardBody: "집에서 매일 측정·기록, 이상 시 내원" },
  { intervalLabel: "1개월 이내", cardTitle: "귀·피부", cardBody: "외이염 경과 및 처방 연고 사용 여부 확인" },
  { intervalLabel: "3개월 이내", cardTitle: "복부초음파", cardBody: "간·담낭 소견 변화 추적" },
  { intervalLabel: "6개월 이내", cardTitle: "정기 검진", cardBody: "혈액·기본신체검사 포함 종합 검진" },
];

export function HealthReportSummarySheet({
  hospitalNameKo = "도담동물의료센터",
  hospitalLogoSrc,
  hospitalLogoAlt = "",
  overallSummary = "",
  followUpPlan = "",
  timelineItems = DEFAULT_TIMELINE,
  reportDateLine,
  directorTitleLine = formatDirectorHospitalLine(hospitalNameKo),
  directorNameSpread,
  sealImageSrc,
  sealImageAlt = "직인",
  tokenOverrides,
}: HealthReportSummarySheetProps) {
  const items = timelineItems.length > 0 ? timelineItems : DEFAULT_TIMELINE;
  const resolvedReportDateLine = reportDateLine ?? formatKoreanShortDateKst(new Date());
  const sealSrc = sealImageSrc?.trim() || undefined;
  const directorName = directorNameSpread?.trim() || undefined;

  return (
    <div className="report-a4-tokens hrss-root hrss-sheet" style={tokenOverrides}>
      <HealthReportInnerSheetHeader
        hospitalLogoSrc={hospitalLogoSrc}
        hospitalLogoAlt={hospitalLogoAlt}
        hospitalNameKo={hospitalNameKo}
      />

      <main className="hrss-main">
        <section className="hrss-section hrss-section--opinion">
          <div className="hrss-section-head">
            <h2 className="hrss-section-title">
              종합 소견
              <span className="hrss-section-title__en">Overall Opinion</span>
            </h2>
            <hr className="hrss-section-bar" />
          </div>
          <div className="hrss-section-body">
            {splitParagraphs(overallSummary || " ").map(renderSummaryParagraph)}
          </div>
        </section>

        <section className="hrss-section hrss-section--followup">
          <div className="hrss-section-head">
            <h2 className="hrss-section-title">
              사후 관리 방안
              <span className="hrss-section-title__en">Follow-up Plan</span>
            </h2>
            <hr className="hrss-section-bar" />
          </div>
          <div className="hrss-section-body">
            {splitParagraphs(followUpPlan || " ").map(renderSummaryParagraph)}
          </div>
        </section>

        <section className="hrss-section hrss-section--timeline">
          <div className="hrss-section-head">
            <h2 className="hrss-section-title">
              권장 재검진 일정
              <span className="hrss-section-title__en">Recommended Re-examination Schedule</span>
            </h2>
            <hr className="hrss-section-bar" />
          </div>

          <div className="hrss-timeline-bg">
            <div className="hrss-timeline">
              <div
                className="hrss-timeline-cols hrss-timeline-cols--labels"
                style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
              >
                {items.map((it, i) => (
                  <p key={`lb-${i}`} className="hrss-tl-label">
                    {it.intervalLabel}
                  </p>
                ))}
              </div>

              <div className="hrss-timeline-nodes" aria-hidden>
                <span className="hrss-timeline-nodes__line" />
                <div
                  className="hrss-timeline-dots"
                  style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
                >
                  {items.map((_, i) => (
                    <span key={`dot-${i}`} className="hrss-timeline-dot-cell">
                      <span className="hrss-timeline-dot" />
                    </span>
                  ))}
                </div>
              </div>

              <div
                className="hrss-timeline-cols hrss-timeline-cols--cards"
                style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
              >
                {items.map((it, i) => {
                  const title = it.cardTitle?.trim() ?? "";
                  const body = it.cardBody?.trim() ?? "";
                  const isCompletelyEmpty = !title && !body;
                  return (
                    <div key={`${it.intervalLabel}-${i}`} className="hrss-tl-col">
                      <div className="hrss-tl-card">
                        <div className="hrss-tl-card__inner">
                          {title ? (
                            <p className="hrss-tl-card__title">{title}</p>
                          ) : isCompletelyEmpty ? (
                            // 비어 있을 때 제목 자리만큼 보이지 않는 placeholder 를 두어,
                            // fallback 문구가 일반 카드의 본문 첫째 줄 위치에 떨어지도록 한다.
                            <p
                              className="hrss-tl-card__title"
                              aria-hidden="true"
                              style={{ visibility: "hidden" }}
                            >
                              {" "}
                            </p>
                          ) : null}
                          <p className="hrss-tl-card__text">
                            {isCompletelyEmpty ? "별도의 재검 일정은 없습니다" : body || " "}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <footer className="hrss-footer">
              <div className="hrss-footer-cluster">
                <div className="hrss-footer-copy">
                  <p className="hrss-footer-date">{resolvedReportDateLine}</p>
                  <p className="hrss-footer-director">
                    <span className="hrss-footer-director__title">{directorTitleLine}</span>
                    {directorName ? (
                      <span className="hrss-footer-director__name">{directorName}</span>
                    ) : null}
                    <span className="hrss-seal-slot">
                      <span className="hrss-seal-mark" aria-hidden>
                        (인)
                      </span>
                      <span className="hrss-seal-overlay" aria-hidden>
                        {sealSrc ? (
                          <img
                            className="hrss-seal"
                            src={sealSrc}
                            alt={sealImageAlt}
                            decoding="async"
                          />
                        ) : (
                          <span className="hrss-seal hrss-seal--placeholder" />
                        )}
                      </span>
                    </span>
                  </p>
                </div>
              </div>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
