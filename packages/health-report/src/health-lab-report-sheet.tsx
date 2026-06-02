import "./health-lab-report-sheet.css";
import { HealthReportInnerSheetHeader } from "./health-report-inner-sheet-header";
import { parseReferenceRange, valuePositionPercent } from "./lab-range-parse";

export type LabReportItem = {
  itemName: string;
  valueText: string;
  unit: string | null;
  referenceRange: string | null;
  flag: "low" | "high" | "normal" | "unknown";
  categoryKey: string;
  categoryLabel: string;
};

export type LabReportPage = {
  groups: LabReportCategoryGroup[];
};

export type LabReportCategoryGroup = {
  categoryKey: string;
  categoryLabel: string;
  items: LabReportItem[];
};

export type HealthLabReportSheetProps = {
  hospitalLogoSrc?: string;
  hospitalLogoAlt?: string;
  hospitalNameKo?: string;
  hospitalNameEn?: string;
  hospitalLogoWatermarkSrc?: string;
  pageNumber?: number;
  tokenOverrides?: Record<string, string>;
  groups: LabReportCategoryGroup[];
  /** 첫 번째 lab 페이지에만 표시되는 AI 생성 해석 요약 */
  interpretation?: string;
};

function flagLabel(flag: string): string {
  switch (flag) {
    case "high":
      return "High";
    case "low":
      return "Low";
    case "normal":
      return "";
    default:
      return "";
  }
}

function flagClass(flag: string): string {
  switch (flag) {
    case "high":
      return "hlr-cell-flag hlr-cell-flag--high";
    case "low":
      return "hlr-cell-flag hlr-cell-flag--low";
    case "normal":
      return "hlr-cell-flag hlr-cell-flag--normal";
    default:
      return "hlr-cell-flag";
  }
}

function RangeBar({ item }: { item: LabReportItem }) {
  const range = parseReferenceRange(item.referenceRange);
  const pos = valuePositionPercent(item.valueText, range);

  if (range.min == null && range.max == null) {
    return <div className="hlr-bar" />;
  }

  /** 참고치 min~max를 차지하는 녹색 구간: 전체 트랙의 절반만 사용해 범위 이탈 폭을 시각적으로 구분하기 쉽게 함 */
  const barLeft = 25;
  const barWidth = 50;

  const dotFlag = item.flag === "high" || item.flag === "low" ? item.flag : "normal";
  const dotClass = `hlr-bar__dot hlr-bar__dot--${dotFlag}`;

  const dotLeft = pos != null ? Math.max(0, Math.min(100, barLeft + (pos / 100) * barWidth)) : null;

  return (
    <div className="hlr-bar">
      <div
        className="hlr-bar__normal"
        style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
      />
      {dotLeft != null ? (
        <div className={dotClass} style={{ left: `${dotLeft}%` }} />
      ) : null}
    </div>
  );
}

function refMinMax(referenceRange: string | null): { minStr: string; maxStr: string } {
  if (!referenceRange?.trim()) return { minStr: "", maxStr: "" };
  const range = parseReferenceRange(referenceRange);
  return {
    minStr: range.min != null ? String(range.min) : "",
    maxStr: range.max != null ? String(range.max) : "",
  };
}

export function HealthLabReportSheet({
  hospitalLogoSrc,
  hospitalLogoAlt = "",
  hospitalNameKo = "",
  hospitalNameEn = "",
  hospitalLogoWatermarkSrc,
  pageNumber,
  tokenOverrides,
  groups,
  interpretation,
}: HealthLabReportSheetProps) {
  const watermarkSrc = hospitalLogoWatermarkSrc ?? hospitalLogoSrc;

  return (
    <div className="report-a4-tokens hlr-root hlr-sheet" style={tokenOverrides}>
      {watermarkSrc ? (
        <div className="hlr-watermark" aria-hidden>
          <img src={watermarkSrc} alt="" decoding="async" />
        </div>
      ) : null}
      <HealthReportInnerSheetHeader
        hospitalLogoSrc={hospitalLogoSrc}
        hospitalLogoAlt={hospitalLogoAlt}
        hospitalNameKo={hospitalNameKo}
        brandNameFallback={{ ko: hospitalNameKo, en: hospitalNameEn }}
      />
      <div className="hlr-main">
        {interpretation ? (
          <div className="hlr-interp-section">
            <div className="hlr-interp-section__head">
              <p className="hlr-interp-section__title">
                <span className="hlr-interp-section__title-ko">혈액 검사</span>
                <span className="hlr-interp-section__title-en">Blood Test</span>
              </p>
              <hr className="hlr-interp-section__bar" />
            </div>
            <div className="hlr-interp-rows">
              <div className="hlr-interp-row">
                <div className="hlr-interp-row__label">검사 결과 해석</div>
                <div className="hlr-interp-row__body">{interpretation}</div>
              </div>
            </div>
          </div>
        ) : null}

        {groups.map((group) => (
          <div key={group.categoryKey} className="hlr-category">
            <div className="hlr-category__label">{group.categoryLabel}</div>
            <table className="hlr-table">
              <colgroup>
                <col className="hlr-col--w25" />
                <col className="hlr-col--w15" />
                <col className="hlr-col--w15" />
                <col className="hlr-col--w15" />
                <col className="hlr-col--w15" />
                <col className="hlr-col--range" />
                <col className="hlr-col--w20" />
              </colgroup>
              <thead>
                <tr>
                  <th>항목</th>
                  <th>측정값</th>
                  <th>단위</th>
                  <th>최소</th>
                  <th>최대</th>
                  <th>범위</th>
                  <th>판정</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item, idx) => {
                  const { minStr, maxStr } = refMinMax(item.referenceRange);
                  return (
                    <tr key={idx}>
                      <td className="hlr-cell-name">{item.itemName}</td>
                      <td className="hlr-cell-value">{item.valueText}</td>
                      <td className="hlr-cell-unit">{item.unit ?? ""}</td>
                      <td className="hlr-cell-ref">{minStr}</td>
                      <td className="hlr-cell-ref">{maxStr}</td>
                      <td className="hlr-cell-bar">
                        <RangeBar item={item} />
                      </td>
                      <td className={flagClass(item.flag)}>{flagLabel(item.flag)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {pageNumber != null ? (
        <footer className="hlr-footer">{pageNumber}</footer>
      ) : null}
    </div>
  );
}
