'use client';

import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-sans-kr/900.css';
// 폰트 스택 1순위(Pretendard)를 항상 로드해 미리보기·PDF 줄바꿈을 일치시킨다.
import '@fontsource/pretendard/400.css';
import '@fontsource/pretendard/500.css';
import '@fontsource/pretendard/700.css';
import '@fontsource/pretendard/900.css';

import type {
  HealthReportCoverSheetProps,
  HealthReportOuterCoverSheetProps,
  HealthReportSummarySheetProps,
  LabReportCategoryGroup,
} from '@dashboard/health-report';
import {
  HEALTH_REPORT_PAGE_DENTAL_SKIN,
  HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND,
  HEALTH_REPORT_PAGE_SYSTEMS,
  HEALTH_REPORT_PAGE_SYSTEMS_B,
  HealthLabReportSheet,
  HealthReportCoverSheet,
  HealthReportOuterCoverSheet,
  HealthReportSummarySheet,
  HealthSystemsReportSheet,
} from '@dashboard/health-report';

/** chart-api `POST /api/report/health-checkup/preview` 응답의 `model` JSON */
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

export function HealthReportPreviewPages({ model }: { model: HealthReportPreviewModelJson }) {
  const coverProps = model.coverProps as HealthReportCoverSheetProps;
  const summaryProps = model.summaryProps as HealthReportSummarySheetProps;
  const outerCoverProps = model.outerCoverProps as HealthReportOuterCoverSheetProps;

  return (
    <div className="report-a4-tokens" style={{ background: '#ffffff' }}>
      <style>{`
        @page {
          size: A4 portrait;
          margin: 0;
        }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: #fff;
        }
      `}</style>
      <HealthReportCoverSheet {...coverProps} />
      <HealthReportSummarySheet {...summaryProps} />
      <HealthSystemsReportSheet
        hospitalLogoSrc={coverProps.hospitalLogoSrc}
        hospitalLogoAlt={coverProps.hospitalLogoAlt}
        hospitalNameKo={coverProps.hospitalNameKo}
        hospitalNameEn={coverProps.hospitalNameEn}
        blocks={model.systemsPage3Blocks as never}
        pageNumber={HEALTH_REPORT_PAGE_SYSTEMS}
        tokenOverrides={model.tokenOverrides ?? undefined}
      />
      <HealthSystemsReportSheet
        hospitalLogoSrc={coverProps.hospitalLogoSrc}
        hospitalLogoAlt={coverProps.hospitalLogoAlt}
        hospitalNameKo={coverProps.hospitalNameKo}
        hospitalNameEn={coverProps.hospitalNameEn}
        blocks={model.systemsPage3bBlocks as never}
        pageNumber={HEALTH_REPORT_PAGE_SYSTEMS_B}
        tokenOverrides={model.tokenOverrides ?? undefined}
      />
      <HealthSystemsReportSheet
        hospitalLogoSrc={coverProps.hospitalLogoSrc}
        hospitalLogoAlt={coverProps.hospitalLogoAlt}
        hospitalNameKo={coverProps.hospitalNameKo}
        hospitalNameEn={coverProps.hospitalNameEn}
        blocks={model.systemsPage4Blocks as never}
        pageNumber={HEALTH_REPORT_PAGE_DENTAL_SKIN}
        tokenOverrides={model.tokenOverrides ?? undefined}
      />
      <HealthSystemsReportSheet
        hospitalLogoSrc={coverProps.hospitalLogoSrc}
        hospitalLogoAlt={coverProps.hospitalLogoAlt}
        hospitalNameKo={coverProps.hospitalNameKo}
        hospitalNameEn={coverProps.hospitalNameEn}
        blocks={model.systemsPage5Blocks as never}
        pageNumber={HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND}
        tokenOverrides={model.tokenOverrides ?? undefined}
      />
      {model.labPages.map((page, idx) => (
        <HealthLabReportSheet
          key={`lab-${idx}`}
          hospitalLogoSrc={coverProps.hospitalLogoSrc}
          hospitalLogoAlt={coverProps.hospitalLogoAlt}
          hospitalNameKo={coverProps.hospitalNameKo}
          hospitalNameEn={coverProps.hospitalNameEn}
          groups={page.groups as LabReportCategoryGroup[]}
          pageNumber={HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND + 1 + idx}
          tokenOverrides={model.tokenOverrides ?? undefined}
          interpretation={idx === 0 ? model.labInterpretation : undefined}
        />
      ))}
      <HealthReportOuterCoverSheet {...outerCoverProps} />
    </div>
  );
}
