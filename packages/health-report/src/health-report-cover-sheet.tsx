import "./health-report-cover-sheet.css";

export const HEALTH_REPORT_PAGE_COVER = 1;

/**
 * 인쇄·PDF·보고서 미리보기 표지용. 저장값이 숫자만이면 뒤에 「세」를 붙인다.
 * 이미 「세」로 끝나거나 생년월일 등 비숫자 문자열은 그대로 둔다.
 */
function formatAgeForPrintedReport(ageRaw: string | undefined): string {
  const t = (ageRaw ?? "").trim();
  if (!t) return "";
  if (/세\s*$/.test(t)) return t;
  if (/^\d+$/.test(t)) return `${t}세`;
  return t;
}

export type HealthReportCoverCheckup = {
  date?: string;
  program?: string;
  veterinarian?: string;
};

export type HealthReportCoverPet = {
  name?: string;
  species?: string;
  /** 품종 (종과 별도) */
  breed?: string;
  sex?: string;
  age?: string;
  weight?: string;
};

export type HealthReportCoverOwner = {
  name?: string;
};

export type HealthReportCoverSheetProps = {
  hospitalNameKo?: string;
  hospitalNameEn?: string;
  /** 우측 상단 로고 — 제공 시 `<img>` */
  hospitalLogoSrc?: string;
  hospitalLogoAlt?: string;
  /** 좌측 대형 종 라벨 (예: DOG, CAT) */
  speciesLabel?: string;
  /** 반려동물 사진 — `public/` 경로 또는 URL */
  petImageSrc?: string;
  petImageAlt?: string;
  checkup?: HealthReportCoverCheckup;
  pet?: HealthReportCoverPet;
  owner?: HealthReportCoverOwner;
  footerTaglineLine1?: string;
  footerTaglineLine2?: string;
  footerPhone?: string;
  footerAddress?: string;
  /** report-a4-tokens CSS 변수 오버라이드(병원별 테마) */
  tokenOverrides?: Record<string, string>;
  /** 큰 제목 1줄 (기본: hospitalNameKo) */
  coverTitleLine1?: string;
  /** 큰 제목 2줄 (기본: 「건강검진 보고서」) */
  coverTitleLine2?: string;
};

function HeaderMarks() {
  return (
    <div className="hrc-header-marks" aria-hidden>
      <svg className="hrc-mark" viewBox="0 0 32 32">
        <g fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth={9}>
          <line x1="16" y1="8" x2="16" y2="24" />
          <line x1="8" y1="16" x2="24" y2="16" />
        </g>
      </svg>
      <svg className="hrc-mark hrc-mark--rot45" viewBox="0 0 32 32">
        <g fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth={9}>
          <line x1="16" y1="8" x2="16" y2="24" />
          <line x1="8" y1="16" x2="24" y2="16" />
        </g>
      </svg>
      <svg className="hrc-mark" viewBox="0 0 32 32">
        <g fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth={9}>
          <line x1="16" y1="8" x2="16" y2="24" />
          <line x1="8" y1="16" x2="24" y2="16" />
        </g>
      </svg>
    </div>
  );
}

/**
 * 인쇄·PDF·미리보기 표지 체중 표시용.
 * 숫자가 있으면 단위 `kg`를 보장한다.
 */
function formatWeightForPrintedReport(weightRaw: string | undefined): string {
  const t = (weightRaw ?? "").trim();
  if (!t) return "";
  if (!/\d/.test(t)) return t;
  if (/kg\s*$/i.test(t)) return t.replace(/kg\s*$/i, "kg");
  return `${t}kg`;
}

export function HealthReportCoverSheet({
  hospitalNameKo = "도담동물의료센터",
  hospitalNameEn = "Dodam Animal Medical Center",
  hospitalLogoSrc,
  hospitalLogoAlt = "",
  speciesLabel = "DOG",
  petImageSrc,
  petImageAlt = "반려동물 사진",
  checkup = {},
  pet = {},
  owner = {},
  footerTaglineLine1 = "정성으로 케어하고,",
  footerTaglineLine2 = "실력으로 치료합니다.",
  footerPhone = "031-638-8875",
  footerAddress = "경기 이천시 이섭대천로 1458 1동 202호",
  tokenOverrides,
  coverTitleLine1,
  coverTitleLine2,
}: HealthReportCoverSheetProps) {
  const c = checkup;
  const p = pet;
  const o = owner;
  const titleLine1 = coverTitleLine1 ?? hospitalNameKo;
  const titleLine2 = coverTitleLine2 ?? "건강검진 보고서";

  return (
    <div className="report-a4-tokens hrc-root hrc-sheet" style={tokenOverrides}>
      <header className="hrc-header">
        <HeaderMarks />
        <div className="hrc-header-brand">
          {hospitalLogoSrc ? (
            <img
              className="hrc-header-logo"
              src={hospitalLogoSrc}
              alt={hospitalLogoAlt || hospitalNameKo}
              decoding="async"
            />
          ) : null}
        </div>
      </header>

      <div className="hrc-title-block">
        <h1 className="hrc-title-main">
          <span className="hrc-title-main__line hrc-title-main__line--first">{titleLine1}</span>
          <span className="hrc-title-main__line hrc-title-main__line--second">{titleLine2}</span>
        </h1>
        <p className="hrc-title-sub">
          <span style={{ display: "block" }}>{hospitalNameEn.toUpperCase()}</span>
          <span style={{ display: "block" }}>HEALTH CHECKUP REPORT</span>
        </p>
      </div>

      <main className="hrc-main">
        <div className="hrc-main-left">
          <p className="hrc-species-label">{speciesLabel}</p>
          {petImageSrc ? (
            <div className="hrc-pet-photo">
              <img src={petImageSrc} alt={petImageAlt} decoding="async" />
            </div>
          ) : null}
        </div>

        <div className="hrc-main-right">
          <div className="hrc-meta hrc-meta--rule-top">
            <div className="hrc-meta-head">
              <span className="hrc-meta-num">01</span>
              <span className="hrc-meta-label">검진</span>
            </div>
            <dl className="hrc-meta-dl">
              <div className="hrc-meta-row">
                <dt>일자</dt>
                <dd>{c.date ?? "—"}</dd>
              </div>
              <div className="hrc-meta-row">
                <dt className="hrc-meta-row">프로그램</dt>
                <dd>{c.program ?? "—"}</dd>
              </div>
              <div className="hrc-meta-row">
                <dt>수의사</dt>
                <dd>{c.veterinarian ?? "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="hrc-meta">
            <div className="hrc-meta-head">
              <span className="hrc-meta-num">02</span>
              <span className="hrc-meta-label">반려동물</span>
            </div>
            <dl className="hrc-meta-dl">
              <div className="hrc-meta-row">
                <dt>이름</dt>
                <dd>{p.name ?? "—"}</dd>
              </div>
              <div className="hrc-meta-row">
                <dt>종</dt>
                <dd>{p.species ?? "—"}</dd>
              </div>
              <div className="hrc-meta-row">
                <dt>품종</dt>
                <dd>{p.breed ?? "—"}</dd>
              </div>
              <div className="hrc-meta-row">
                <dt>성별</dt>
                <dd>{p.sex ?? "—"}</dd>
              </div>
              <div className="hrc-meta-row">
                <dt>나이</dt>
                <dd>{formatAgeForPrintedReport(p.age) || "—"}</dd>
              </div>
              <div className="hrc-meta-row">
                <dt>체중</dt>
                <dd>{formatWeightForPrintedReport(p.weight) || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="hrc-meta hrc-meta--rule-bottom">
            <div className="hrc-meta-head">
              <span className="hrc-meta-num">03</span>
              <span className="hrc-meta-label">보호자</span>
            </div>
            <dl className="hrc-meta-dl">
              <div className="hrc-meta-row">
                <dt>성함</dt>
                <dd>{o.name ?? "—"}</dd>
              </div>
            </dl>
          </div>
        </div>
      </main>

      <footer className="hrc-footer">
        <div className="hrc-footer__left">
          <p>{footerTaglineLine1}</p>
          <p>{footerTaglineLine2}</p>
        </div>
        <div className="hrc-footer__right">
          <p className="hrc-footer__hospital">{hospitalNameKo}</p>
          <p className="hrc-footer__contact">
            {footerPhone}
            <span className="hrc-footer__contact-sep" aria-hidden>
              |
            </span>
            {footerAddress}
          </p>
        </div>
      </footer>
    </div>
  );
}
