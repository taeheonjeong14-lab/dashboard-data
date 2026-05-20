'use client';

import type { ReactElement } from 'react';
import type { HealthReportPreviewModel } from '@/lib/chart-app/health-report-preview-model';
import { HealthReportCoverSheet } from '@/app/components/report/health-report-cover-sheet';
import { HealthReportOuterCoverSheet } from '@/app/components/report/health-report-outer-cover-sheet';
import { HealthReportSummarySheet } from '@/app/components/report/health-report-summary-sheet';
import {
  HEALTH_REPORT_PAGE_DENTAL_SKIN,
  HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND,
  HEALTH_REPORT_PAGE_SYSTEMS,
  HEALTH_REPORT_PAGE_SYSTEMS_B,
  HealthSystemsReportSheet,
} from '@/app/components/report/health-systems-report-sheet';
import type { LabReportCategoryGroup } from '@/app/components/report/health-lab-report-sheet';
import { HealthLabReportSheet } from '@/app/components/report/health-lab-report-sheet';

export type HealthPreviewEditableSection =
  | 'cover'
  | 'summary'
  | 'systemsPage3'
  | 'systemsPage3b'
  | 'systemsPage4'
  | 'systemsPage5'
  | 'lab'
  | 'none';

export type HealthPreviewPageDescriptor = {
  title: string;
  section: HealthPreviewEditableSection;
  render: () => ReactElement;
};

export function buildHealthReportPreviewPages(model: HealthReportPreviewModel): HealthPreviewPageDescriptor[] {
  const pages: HealthPreviewPageDescriptor[] = [
    {
      title: '표지',
      section: 'cover',
      render: () => <HealthReportCoverSheet {...(model.coverProps as Parameters<typeof HealthReportCoverSheet>[0])} />,
    },
    {
      title: '종합 소견',
      section: 'summary',
      render: () => <HealthReportSummarySheet {...(model.summaryProps as Parameters<typeof HealthReportSummarySheet>[0])} />,
    },
    {
      title: '장기계 평가 1',
      section: 'systemsPage3',
      render: () => (
        <HealthSystemsReportSheet
          hospitalLogoSrc={model.coverProps.hospitalLogoSrc as string | undefined}
          hospitalLogoAlt={model.coverProps.hospitalLogoAlt as string}
          hospitalNameKo={model.coverProps.hospitalNameKo as string}
          hospitalNameEn={model.coverProps.hospitalNameEn as string}
          blocks={model.systemsPage3Blocks}
          pageNumber={HEALTH_REPORT_PAGE_SYSTEMS}
          tokenOverrides={model.tokenOverrides ?? undefined}
        />
      ),
    },
    {
      title: '장기계 평가 2',
      section: 'systemsPage3b',
      render: () => (
        <HealthSystemsReportSheet
          hospitalLogoSrc={model.coverProps.hospitalLogoSrc as string | undefined}
          hospitalLogoAlt={model.coverProps.hospitalLogoAlt as string}
          hospitalNameKo={model.coverProps.hospitalNameKo as string}
          hospitalNameEn={model.coverProps.hospitalNameEn as string}
          blocks={model.systemsPage3bBlocks}
          pageNumber={HEALTH_REPORT_PAGE_SYSTEMS_B}
          tokenOverrides={model.tokenOverrides ?? undefined}
        />
      ),
    },
    {
      title: '치과/피부/외이도',
      section: 'systemsPage4',
      render: () => (
        <HealthSystemsReportSheet
          hospitalLogoSrc={model.coverProps.hospitalLogoSrc as string | undefined}
          hospitalLogoAlt={model.coverProps.hospitalLogoAlt as string}
          hospitalNameKo={model.coverProps.hospitalNameKo as string}
          hospitalNameEn={model.coverProps.hospitalNameEn as string}
          blocks={model.systemsPage4Blocks}
          pageNumber={HEALTH_REPORT_PAGE_DENTAL_SKIN}
          tokenOverrides={model.tokenOverrides ?? undefined}
        />
      ),
    },
    {
      title: '방사선/초음파',
      section: 'systemsPage5',
      render: () => (
        <HealthSystemsReportSheet
          hospitalLogoSrc={model.coverProps.hospitalLogoSrc as string | undefined}
          hospitalLogoAlt={model.coverProps.hospitalLogoAlt as string}
          hospitalNameKo={model.coverProps.hospitalNameKo as string}
          hospitalNameEn={model.coverProps.hospitalNameEn as string}
          blocks={model.systemsPage5Blocks}
          pageNumber={HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND}
          tokenOverrides={model.tokenOverrides ?? undefined}
        />
      ),
    },
  ];

  model.labPages.forEach((page, idx) => {
    pages.push({
      title: `혈액검사 ${idx + 1}`,
      section: 'lab',
      render: () => (
        <HealthLabReportSheet
          hospitalLogoSrc={model.coverProps.hospitalLogoSrc as string | undefined}
          hospitalLogoAlt={model.coverProps.hospitalLogoAlt as string}
          hospitalNameKo={model.coverProps.hospitalNameKo as string}
          hospitalNameEn={model.coverProps.hospitalNameEn as string}
          groups={page.groups as LabReportCategoryGroup[]}
          pageNumber={HEALTH_REPORT_PAGE_RADIOLOGY_ULTRASOUND + 1 + idx}
          tokenOverrides={model.tokenOverrides ?? undefined}
          interpretation={idx === 0 ? model.labInterpretation : undefined}
        />
      ),
    });
  });

  pages.push({
    title: '아우터 커버',
    section: 'none',
    render: () => <HealthReportOuterCoverSheet {...(model.outerCoverProps as Parameters<typeof HealthReportOuterCoverSheet>[0])} />,
  });

  return pages;
}

type HealthReportPreviewPagesProps = {
  model: HealthReportPreviewModel;
  currentPageIndex?: number;
};

export function HealthReportPreviewPages({ model, currentPageIndex }: HealthReportPreviewPagesProps) {
  const pages = buildHealthReportPreviewPages(model);
  const safeIndex =
    typeof currentPageIndex === 'number'
      ? Math.min(Math.max(currentPageIndex, 0), Math.max(0, pages.length - 1))
      : null;

  if (safeIndex === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        {pages.map((page, idx) => <div key={idx}>{page.render()}</div>)}
      </div>
    );
  }

  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>{pages[safeIndex]?.render() ?? null}</div>;
}
