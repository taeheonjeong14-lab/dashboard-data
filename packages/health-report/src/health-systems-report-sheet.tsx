import { Fragment } from "react";
import "./health-systems-report-sheet.css";
import { HealthReportInnerSheetHeader } from "./health-report-inner-sheet-header";

export type HealthSystemsReportRow = {
  label: string;
  content: string;
};

/** 가로 3칸 이미지 블록의 한 칸. `src` 없으면 렌더 시 미디어 박스 없음(캡션만 있을 수 있음). */
export type HealthSystemsImageSlot = {
  src?: string;
  alt?: string;
  /** 화면에는 `<캡션문구>` 형태(4p `images`, 5p `images4`·`imagesGrid2x3`). 데모는 플레이스홀더, 실제 값은 생성 시 AI 작성 예정. */
  caption?: string;
  /** 이미지 회전 각도(도). 기본 0, 편집 UI에서 90도 단위 회전. */
  rotationDeg?: number;
};

export type HealthSystemsReportBlock =
  | {
      variant: "rows";
      titleKo: string;
      titleEn: string;
      /** 통상 2행(주요 진단·시사점). 레이아웃은 2행 비율 고정. */
      rows: HealthSystemsReportRow[];
      /** true면 표 두 행 높이 비율을 균등에 가깝게(5p 등에서 섹션을 낮게). */
      compact?: boolean;
    }
  | {
      variant: "images";
      titleKo: string;
      titleEn: string;
      /** 정사각형 비율 3열. 항상 3요소. */
      images: readonly [
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
      ];
    }
  | {
      variant: "images4";
      titleKo: string;
      titleEn: string;
      /** 4열 한 줄, 미디어 가로:세로 1:1.67. 슬롯마다 하단 캡션(`caption`, `<…>`). */
      images: readonly [
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
      ];
    }
  | {
      variant: "imagesGrid2x3";
      titleKo: string;
      titleEn: string;
      /** 3열×2행(0–2 첫 줄, 3–5 둘째 줄). 셀 가로:세로 ≈ 1.67:1. 행 아래 12px 캡션(`caption`, `<…>` 표시). */
      images: readonly [
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
      ];
    }
  | {
      variant: "imagesGrid3x3";
      titleKo: string;
      titleEn: string;
      /** 3열×3행(0–2 첫 줄, 3–5 둘째 줄, 6–8 셋째 줄). 셀 가로:세로 ≈ 1.67:1. 행 아래 캡션. */
      images: readonly [
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
        HealthSystemsImageSlot,
      ];
    }
  | {
      variant: "omitted";
      titleKo: string;
      titleEn: string;
      note: string;
    };

/** 인쇄본 3페이지(장기계통 1/2: 순환·소화·내분비). */
export const HEALTH_REPORT_PAGE_SYSTEMS = 3;
/** 인쇄본 4페이지(장기계통 2/2: 신장·비뇨·간담도·근골격). */
export const HEALTH_REPORT_PAGE_SYSTEMS_B = 4;
/** 인쇄본 5페이지(치과·안과 / 이미지 / 피부·외이도 / 이미지). */
export const HEALTH_REPORT_PAGE_DENTAL_SKIN = 5;
/** 인쇄본 6페이지(방사선·초음파 / 이미지 그리드). 요약·장기 시트 다음 장. */
export const HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND = 6;

function blockShowsSectionHead(block: HealthSystemsReportBlock): boolean {
  return block.variant === "rows" || block.variant === "omitted";
}

function imageStripAriaLabel(block: {
  titleKo: string;
  titleEn: string;
}): string {
  const ko = block.titleKo.trim();
  const en = block.titleEn.trim();
  if (ko || en) return [ko, en].filter(Boolean).join(" · ");
  return "참고 이미지";
}

function formatImageCaptionBracketed(caption: string): string {
  const t = caption.trim();
  if (!t) return "";
  if (t.startsWith("<") && t.endsWith(">")) return t;
  return `<${t}>`;
}

function imageRotationStyle(slot: HealthSystemsImageSlot): { transform?: string } {
  const deg = Number.isFinite(slot.rotationDeg) ? (((slot.rotationDeg ?? 0) % 360) + 360) % 360 : 0;
  if (!deg) return {};
  return { transform: `rotate(${deg}deg)` };
}

export type HealthSystemsReportSheetProps = {
  /** 우측 상단 로고 — 요약 시트 헤더와 동일. 없으면 한·영 병원명 텍스트로 대체 */
  hospitalLogoSrc?: string;
  hospitalLogoAlt?: string;
  hospitalNameKo?: string;
  hospitalNameEn?: string;
  /**
   * 페이지 중앙 워터마크(희미한 배경 로고). 지정 시 이 URL만 사용.
   * 생략하면 `hospitalLogoSrc`와 동일 파일(헤더 로고)을 워터마크로 씀.
   */
  hospitalLogoWatermarkSrc?: string;
  blocks: HealthSystemsReportBlock[];
  /** 하단 중앙 페이지 번호. */
  pageNumber?: number;
  /** report-a4-tokens CSS 변수 오버라이드(병원별 테마) */
  tokenOverrides?: Record<string, string>;
};

export function HealthSystemsReportSheet({
  hospitalLogoSrc,
  hospitalLogoAlt = "",
  hospitalNameKo = "병원명 (플레이스홀더)",
  hospitalNameEn = "Animal Medical Center",
  hospitalLogoWatermarkSrc,
  blocks,
  pageNumber = HEALTH_REPORT_PAGE_SYSTEMS,
  tokenOverrides,
}: HealthSystemsReportSheetProps) {
  const watermarkSrc = hospitalLogoWatermarkSrc ?? hospitalLogoSrc;

  const sheetClasses = ["report-a4-tokens", "hsr-root", "hsr-sheet"];
  if (pageNumber === HEALTH_REPORT_PAGE_DENTAL_SKIN) {
    sheetClasses.push("hsr-sheet--page-dental-skin");
  }
  if (pageNumber === HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND) {
    sheetClasses.push("hsr-sheet--page-radiology-ultrasound");
  }
  if (
    pageNumber === HEALTH_REPORT_PAGE_DENTAL_SKIN ||
    pageNumber === HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND
  ) {
    sheetClasses.push("hsr-sheet--tight-table-image-gap");
  }
  const sheetClass = sheetClasses.join(" ");

  return (
    <div className={sheetClass} style={tokenOverrides}>
      {watermarkSrc ? (
        <div className="hsr-watermark" aria-hidden>
          <img src={watermarkSrc} alt="" decoding="async" />
        </div>
      ) : null}
      <HealthReportInnerSheetHeader
        hospitalLogoSrc={hospitalLogoSrc}
        hospitalLogoAlt={hospitalLogoAlt}
        hospitalNameKo={hospitalNameKo}
        brandNameFallback={{ ko: hospitalNameKo, en: hospitalNameEn }}
      />

      <main className="hsr-main">
        {blocks.map((block, i) => (
          <section
            key={`${block.variant}-${i}`}
            className={`hsr-section ${block.variant === "omitted" ? "hsr-section--omitted" : ""}`}
          >
            {blockShowsSectionHead(block) ? (
              <div className="hsr-section-head">
                <h2 className="hsr-section-title">
                  {block.titleKo}
                  <span className="hsr-section-title__en">{block.titleEn}</span>
                </h2>
                <hr className="hsr-section-bar" />
              </div>
            ) : null}

            {block.variant === "rows" ? (
              <div className="hsr-section-body">
                <div className={`hsr-rows${block.compact ? " hsr-rows--compact" : ""}${block.rows.length === 1 ? " hsr-rows--single" : ""}`}>
                  {block.rows.map((row, j) => (
                    <div key={`${row.label}-${j}`} className="hsr-row">
                      <div className="hsr-row__label">{row.label}</div>
                      <div className="hsr-row__body">{typeof row.content === "string" ? row.content.replace(/\n{2,}/g, "\n") : row.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : block.variant === "images" ? (
              <div className="hsr-section-body">
                <div
                  className="hsr-image-strip hsr-image-strip--slots"
                  aria-label={imageStripAriaLabel(block)}
                >
                  {block.images.map((slot, j) => (
                    <div key={j} className="hsr-image-slot">
                      <div
                        className={`hsr-image-slot__media${
                          slot.src?.trim() ? "" : " hsr-image-slot__media--blank"
                        }`}
                      >
                        {slot.src ? (
                          <img
                            src={slot.src}
                            alt={slot.alt ?? ""}
                            decoding="async"
                            style={imageRotationStyle(slot)}
                          />
                        ) : null}
                      </div>
                      <p
                        className={`hsr-image-slot__caption${
                          !slot.src?.trim() ? " hsr-image-slot__caption--silent" : ""
                        }`}
                      >
                        {slot.src?.trim() && slot.caption?.trim()
                          ? formatImageCaptionBracketed(slot.caption)
                          : slot.src?.trim()
                            ? "\u00a0"
                            : null}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : block.variant === "images4" ? (
              <div className="hsr-section-body">
                <div
                  className="hsr-image-strip hsr-image-strip--slots hsr-image-strip--4"
                  aria-label={imageStripAriaLabel(block)}
                >
                  {block.images.map((slot, j) => (
                    <div key={j} className="hsr-image-slot">
                      <div
                        className={`hsr-image-slot__media${
                          slot.src?.trim() ? "" : " hsr-image-slot__media--blank"
                        }`}
                      >
                        {slot.src ? (
                          <img
                            src={slot.src}
                            alt={slot.alt ?? ""}
                            decoding="async"
                            style={imageRotationStyle(slot)}
                          />
                        ) : null}
                      </div>
                      <p
                        className={`hsr-image-slot__caption${
                          !slot.src?.trim() ? " hsr-image-slot__caption--silent" : ""
                        }`}
                      >
                        {slot.src?.trim() && slot.caption?.trim()
                          ? formatImageCaptionBracketed(slot.caption)
                          : slot.src?.trim()
                            ? "\u00a0"
                            : null}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : block.variant === "imagesGrid2x3" || block.variant === "imagesGrid3x3" ? (
              <div className="hsr-section-body">
                <div
                  className={block.variant === "imagesGrid3x3" ? "hsr-image-grid-3x3" : "hsr-image-grid-2x3"}
                  aria-label={imageStripAriaLabel(block)}
                >
                  {[0, 1, 2].slice(0, block.variant === "imagesGrid3x3" ? 3 : 2).map((rowIdx) => (
                    <Fragment key={`row-group-${rowIdx}`}>
                      <div className="hsr-us-grid-row">
                        {block.images.slice(rowIdx * 3, rowIdx * 3 + 3).map((slot, j) => (
                          <div
                            key={`r${rowIdx}-${j}`}
                            className={`hsr-image-cell hsr-image-cell--wide${
                              slot.src ? "" : " hsr-image-cell--empty"
                            }`}
                          >
                            {slot.src ? (
                              <img
                                src={slot.src}
                                alt={slot.alt ?? ""}
                                decoding="async"
                                style={imageRotationStyle(slot)}
                              />
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <div className="hsr-us-grid-captions">
                        {block.images.slice(rowIdx * 3, rowIdx * 3 + 3).map((slot, j) => (
                          <p
                            key={`c${rowIdx}-${j}`}
                            className={`hsr-image-slot__caption${
                              !slot.src?.trim() ? " hsr-image-slot__caption--silent" : ""
                            }`}
                          >
                            {slot.src?.trim() && slot.caption?.trim()
                              ? formatImageCaptionBracketed(slot.caption)
                              : slot.src?.trim()
                                ? "\u00a0"
                                : null}
                          </p>
                        ))}
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
            ) : (
              <div className="hsr-section-body hsr-section-body--omitted">
                <p className="hsr-omitted">{block.note}</p>
              </div>
            )}
          </section>
        ))}
      </main>

      <footer className="hsr-footer-page">{pageNumber}</footer>
    </div>
  );
}

/** 장기계통 데모 6섹션(인쇄 3p·4p에 각각 앞 3·뒤 3). */
export const DEMO_HEALTH_SYSTEMS_BLOCKS_ALL: HealthSystemsReportBlock[] = [
  {
    variant: "rows",
    titleKo: "순환기&호흡기",
    titleEn: "Circulatory & Respiratory Systems",
    rows: [
      {
        label: "주요 진단 내용",
        content: "플레이스홀더 — 혈압·청진 등 검진 요약이 이 칸에 들어갑니다.",
      },
      {
        label: "시사점",
        content: "플레이스홀더 — 보호자 안내.",
      },
    ],
  },
  {
    variant: "rows",
    titleKo: "소화기",
    titleEn: "Digestive System",
    rows: [
      {
        label: "주요 진단 내용",
        content: "플레이스홀더 — 소화기 관련 검진 요약.",
      },
      {
        label: "시사점",
        content: "플레이스홀더 — 급여·재검 등 안내.",
      },
    ],
  },
  {
    variant: "rows",
    titleKo: "내분비계",
    titleEn: "Endocrine System",
    rows: [
      {
        label: "주요 진단 내용",
        content: "플레이스홀더 — 호르몬·대사·부신·갑상선 등 관련 소견.",
      },
      {
        label: "시사점",
        content: "플레이스홀더 — 관찰·재검 안내.",
      },
    ],
  },
  {
    variant: "rows",
    titleKo: "신장 및 비뇨기계",
    titleEn: "Kidney & Urinary System",
    rows: [
      {
        label: "주요 진단 내용",
        content: "플레이스홀더 — 신장·요로·방광 등 검진 요약.",
      },
      {
        label: "시사점",
        content: "플레이스홀더 — 음수·배뇨·검사 수치 안내.",
      },
    ],
  },
  {
    variant: "rows",
    titleKo: "간담도계",
    titleEn: "Hepatobiliary System",
    rows: [
      {
        label: "주요 진단 내용",
        content: "플레이스홀더 — 간·담도 관련 검진 요약.",
      },
      {
        label: "시사점",
        content: "플레이스홀더 — 관찰·재검 안내.",
      },
    ],
  },
  {
    variant: "rows",
    titleKo: "근골격계",
    titleEn: "Musculoskeletal System",
    rows: [
      {
        label: "주요 진단 내용",
        content: "플레이스홀더 — 관절·보행·근육·골격 검진 요약.",
      },
      {
        label: "시사점",
        content: "플레이스홀더 — 활동량·보행 관찰 안내.",
      },
    ],
  },
];

/** 3p(장기 1/2): 순환기·소화기·내분비 */
export const DEMO_HEALTH_SYSTEMS_BLOCKS: HealthSystemsReportBlock[] = DEMO_HEALTH_SYSTEMS_BLOCKS_ALL.slice(0, 3);

/** 4p(장기 2/2): 신장·비뇨·간담도·근골격 */
export const DEMO_HEALTH_SYSTEMS_PAGE_B_BLOCKS: HealthSystemsReportBlock[] = DEMO_HEALTH_SYSTEMS_BLOCKS_ALL.slice(3, 6);

/** 4p 이미지 슬롯 — 실제 문구는 생성 시 사진 기준으로 AI가 채움. */
export const IMAGE_STRIP_CAPTION_PLACEHOLDER = "플레이스홀더 — 이미지 캡션";

function emptyImageStrip(
  captions: readonly [string, string, string] = [
    IMAGE_STRIP_CAPTION_PLACEHOLDER,
    IMAGE_STRIP_CAPTION_PLACEHOLDER,
    IMAGE_STRIP_CAPTION_PLACEHOLDER,
  ],
): [
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
] {
  return [
    { caption: captions[0] },
    { caption: captions[1] },
    { caption: captions[2] },
  ];
}

/** 치과/피부(5p) 데모: 1·3은 표, 치과는 2x3(6칸), 피부는 3칸. */
export const DEMO_HEALTH_DENTAL_SKIN_BLOCKS: HealthSystemsReportBlock[] = [
  {
    variant: "rows",
    titleKo: "치과 및 안과",
    titleEn: "Dental & Ophthalmology",
    rows: [
      {
        label: "주요 진단 내용",
        content: "플레이스홀더 — 치아·구강·안과 검진 요약.",
      },
      {
        label: "시사점",
        content: "플레이스홀더 — 구강 위생·눈 분비물 등 안내.",
      },
    ],
  },
  {
    variant: "imagesGrid2x3",
    titleKo: "",
    titleEn: "",
    images: emptyImageSix(),
  },
  {
    variant: "rows",
    titleKo: "피부와 외이도",
    titleEn: "Skin & External Ear Canal",
    rows: [
      {
        label: "주요 진단 내용",
        content: "플레이스홀더 — 피부·외이도 검진 요약.",
      },
      {
        label: "시사점",
        content: "플레이스홀더 — 긁음·발적·악취 등 관찰 안내.",
      },
    ],
  },
  {
    variant: "images",
    titleKo: "",
    titleEn: "",
    images: emptyImageStrip(),
  },
];

function emptyImageFour(): [
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
] {
  const c = IMAGE_STRIP_CAPTION_PLACEHOLDER;
  return [{ caption: c }, { caption: c }, { caption: c }, { caption: c }];
}

function emptyImageSix(): [
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
] {
  const c = IMAGE_STRIP_CAPTION_PLACEHOLDER;
  return [
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
  ];
}

function emptyImageNine(): [
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
  HealthSystemsImageSlot,
] {
  const c = IMAGE_STRIP_CAPTION_PLACEHOLDER;
  return [
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
    { caption: c },
  ];
}

/** 방사선·초음파(6p) 데모: 표(compact 단일행) + 엑스레이 4장 + 초음파 2×3(1.67:1). */
export const DEMO_RADIOLOGY_ULTRASOUND_BLOCKS: HealthSystemsReportBlock[] = [
  {
    variant: "rows",
    titleKo: "방사선 검사",
    titleEn: "X-ray",
    compact: true,
    rows: [
      {
        label: "검사 결과 해석",
        content: "플레이스홀더 — 방사선 검사 결과 해석.",
      },
    ],
  },
  {
    variant: "images4",
    titleKo: "",
    titleEn: "",
    images: emptyImageFour(),
  },
  {
    variant: "rows",
    titleKo: "초음파 검사",
    titleEn: "Ultrasonography",
    compact: true,
    rows: [
      {
        label: "검사 결과 해석",
        content: "플레이스홀더 — 초음파 검사 결과 해석.",
      },
    ],
  },
  {
    variant: "imagesGrid3x3",
    titleKo: "",
    titleEn: "",
    images: emptyImageNine(),
  },
];

