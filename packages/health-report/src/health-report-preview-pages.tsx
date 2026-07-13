"use client";

/**
 * 건강검진 리포트 페이지 조립 — admin 미리보기·외부 검토 링크·인쇄(PDF) 공용 단일 소스.
 *
 * 이전에는 admin-web 과 chart-api 가 같은 이름의 파일을 각자 들고 있어(복제) 두 화면이 어긋났다.
 * 시트 컴포넌트뿐 아니라 "몇 페이지로 어떻게 조립할지"도 여기 한 곳에서만 정한다.
 *
 * 질환 소개 박스(diseaseInfo) 삽입은 서버(chart-api preview-model)가 이미 끝낸 상태로 온다.
 * 여기서는 모델을 그대로 그리기만 한다 — 규칙을 두 곳에 두지 않는다.
 */
import type { ReactElement } from "react";
import {
  HEALTH_REPORT_PAGE_DENTAL_SKIN,
  HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND,
  HEALTH_REPORT_PAGE_SYSTEMS,
  HEALTH_REPORT_PAGE_SYSTEMS_B,
} from "./health-systems-report-sheet";
import { HealthLabReportSheet, type LabReportCategoryGroup } from "./health-lab-report-sheet";
import { HealthReportCoverSheet, type HealthReportCoverSheetProps } from "./health-report-cover-sheet";
import { HealthReportOuterCoverSheet, type HealthReportOuterCoverSheetProps } from "./health-report-outer-cover-sheet";
import {
  HealthReportSummarySheet,
  shouldSplitHealthSummary,
  type HealthReportSummarySheetProps,
} from "./health-report-summary-sheet";
import { HealthSystemsReportSheet } from "./health-systems-report-sheet";

/** chart-api `POST /api/report/health-checkup/preview[-by-share]` 응답의 `model` JSON. */
export type HealthReportPreviewModelJson = {
  coverProps: Record<string, unknown>;
  summaryProps: Record<string, unknown>;
  outerCoverProps: Record<string, unknown>;
  tokenOverrides: Record<string, string> | null;
  systemsPage3Blocks: unknown[];
  systemsPage3bBlocks: unknown[];
  systemsPage4Blocks: unknown[];
  systemsPage5Blocks: unknown[];
  labPages: { groups: unknown[] }[];
  labInterpretation: string;
};

/** 편집 가능한 섹션(외부 검토 화면에서 페이지 ↔ 편집 폼 연결용). */
export type HealthPreviewEditableSection =
  | "cover"
  | "summary"
  | "systemsPage3"
  | "systemsPage3b"
  | "systemsPage4"
  | "systemsPage5"
  | "lab"
  | "none";

export type HealthPreviewPageDescriptor = {
  title: string;
  section: HealthPreviewEditableSection;
  render: () => ReactElement;
};

/** 리포트 페이지 목록(순서·제목·섹션 귀속). 한 페이지씩 보여주는 화면은 이걸 쓴다. */
export function buildHealthReportPreviewPages(
  model: HealthReportPreviewModelJson,
): HealthPreviewPageDescriptor[] {
  const coverProps = model.coverProps as HealthReportCoverSheetProps;
  const summaryProps = model.summaryProps as HealthReportSummarySheetProps;
  const outerCoverProps = model.outerCoverProps as HealthReportOuterCoverSheetProps;

  const systemsSheet = (blocks: unknown[], pageNumber: number) => (
    <HealthSystemsReportSheet
      hospitalLogoSrc={coverProps.hospitalLogoSrc}
      hospitalLogoAlt={coverProps.hospitalLogoAlt}
      hospitalNameKo={coverProps.hospitalNameKo}
      hospitalNameEn={coverProps.hospitalNameEn}
      blocks={blocks as never}
      pageNumber={pageNumber}
      tokenOverrides={model.tokenOverrides ?? undefined}
    />
  );

  const pages: HealthPreviewPageDescriptor[] = [
    {
      title: "표지",
      section: "cover",
      render: () => <HealthReportCoverSheet {...coverProps} />,
    },
    // 종합소견/사후관리가 길면 요약을 2페이지로 쪼갠다(종합 소견 / 사후 관리·재검진·서명).
    ...(shouldSplitHealthSummary(summaryProps.overallSummary, summaryProps.followUpPlan)
      ? [
          {
            title: "종합 소견",
            section: "summary" as const,
            render: () => <HealthReportSummarySheet {...summaryProps} part="overall" />,
          },
          {
            title: "사후 관리·재검진",
            section: "summary" as const,
            render: () => <HealthReportSummarySheet {...summaryProps} part="rest" />,
          },
        ]
      : [
          {
            title: "종합 소견",
            section: "summary" as const,
            render: () => <HealthReportSummarySheet {...summaryProps} part="all" />,
          },
        ]),
    {
      title: "장기계 평가 1",
      section: "systemsPage3",
      render: () => systemsSheet(model.systemsPage3Blocks, HEALTH_REPORT_PAGE_SYSTEMS),
    },
    {
      title: "장기계 평가 2",
      section: "systemsPage3b",
      render: () => systemsSheet(model.systemsPage3bBlocks, HEALTH_REPORT_PAGE_SYSTEMS_B),
    },
    {
      title: "치과/피부/외이도",
      section: "systemsPage4",
      render: () => systemsSheet(model.systemsPage4Blocks, HEALTH_REPORT_PAGE_DENTAL_SKIN),
    },
    {
      title: "방사선/초음파",
      section: "systemsPage5",
      render: () => systemsSheet(model.systemsPage5Blocks, HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND),
    },
  ];

  model.labPages.forEach((page, idx) => {
    pages.push({
      title: `혈액검사 ${idx + 1}`,
      section: "lab",
      render: () => (
        <HealthLabReportSheet
          hospitalLogoSrc={coverProps.hospitalLogoSrc}
          hospitalLogoAlt={coverProps.hospitalLogoAlt}
          hospitalNameKo={coverProps.hospitalNameKo}
          hospitalNameEn={coverProps.hospitalNameEn}
          groups={page.groups as LabReportCategoryGroup[]}
          pageNumber={HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND + 1 + idx}
          tokenOverrides={model.tokenOverrides ?? undefined}
          // 해석 요약은 첫 lab 페이지에만.
          interpretation={idx === 0 ? model.labInterpretation : undefined}
        />
      ),
    });
  });

  pages.push({
    title: "아우터 커버",
    section: "none",
    render: () => <HealthReportOuterCoverSheet {...outerCoverProps} />,
  });

  return pages;
}

export type HealthReportPreviewPagesProps = {
  model: HealthReportPreviewModelJson;
  /** 지정하면 그 페이지 1장만(외부 검토 화면), 없으면 전체를 세로로 쌓아 렌더(admin 미리보기·인쇄). */
  currentPageIndex?: number;
};

export function HealthReportPreviewPages({ model, currentPageIndex }: HealthReportPreviewPagesProps) {
  const pages = buildHealthReportPreviewPages(model);
  const safeIndex =
    typeof currentPageIndex === "number"
      ? Math.min(Math.max(currentPageIndex, 0), Math.max(0, pages.length - 1))
      : null;

  if (safeIndex !== null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {pages[safeIndex]?.render() ?? null}
      </div>
    );
  }

  return (
    <div className="report-a4-tokens" style={{ background: "#ffffff" }}>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
        {pages.map((page, idx) => (
          <div key={idx}>{page.render()}</div>
        ))}
      </div>
    </div>
  );
}
