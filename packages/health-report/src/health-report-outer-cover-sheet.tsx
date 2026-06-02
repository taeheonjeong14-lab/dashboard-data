import "./health-report-outer-cover-sheet.css";

/** 인쇄·미리보기에서 겉표지 순서(표지=1 기준). */
export const HEALTH_REPORT_PAGE_OUTER_COVER = 7;

export type HealthReportOuterCoverSheetProps = {
  hospitalNameKo?: string;
  hospitalLogoSrc?: string;
  hospitalLogoAlt?: string;
  footerTaglineLine1?: string;
  footerTaglineLine2?: string;
  footerPhone?: string;
  footerAddress?: string;
  /**
   * `report-a4-tokens`·겉표지 변수. 로고는 기본 흰 실루엣 필터 — 흰 PNG만 쓰려면
   * `{ "--hroc-logo-on-brand-filter": "none" }` 전달.
   */
  tokenOverrides?: Record<string, string>;
};

export function HealthReportOuterCoverSheet({
  hospitalNameKo = "도담동물의료센터",
  hospitalLogoSrc,
  hospitalLogoAlt = "",
  footerTaglineLine1 = "정성으로 케어하고,",
  footerTaglineLine2 = "실력으로 치료합니다.",
  footerPhone,
  footerAddress,
  tokenOverrides,
}: HealthReportOuterCoverSheetProps) {
  return (
    <div className="report-a4-tokens hroc-root hroc-sheet" style={tokenOverrides}>
      <header className="hroc-top">
        <p className="hroc-tagline">{footerTaglineLine1}</p>
        <p className="hroc-tagline">{footerTaglineLine2}</p>
      </header>

      <div className="hroc-center">
        {hospitalLogoSrc ? (
          <img
            className="hroc-logo"
            src={hospitalLogoSrc}
            alt={hospitalLogoAlt || hospitalNameKo}
            decoding="async"
          />
        ) : null}
      </div>

      <footer className="hroc-bottom">
        <p className="hroc-hospital">{hospitalNameKo}</p>
        {footerPhone?.trim() ? <p className="hroc-contact-line">{footerPhone.trim()}</p> : null}
        {footerAddress?.trim() ? <p className="hroc-contact-line">{footerAddress.trim()}</p> : null}
      </footer>
    </div>
  );
}
