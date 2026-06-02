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

// 장기 블록에 귀속된 확진 질환(disease.name)이 있으면 그 장기 바로 뒤에 질환 소개 박스를 삽입.
// chart-api(preview-model)도 동일 로직을 수행하므로, 이미 박스가 있으면 건너뛴다(중복 방지).
// admin 미리보기는 클라이언트 렌더라, chart-api 버전과 무관하게 편집 결과가 즉시 반영되도록 여기서도 처리.
type DiseaseOption = { name?: string; body?: string; enabled?: boolean };
function withDiseaseBox(blocks: unknown[]): unknown[] {
  const arr = Array.isArray(blocks) ? blocks : [];
  if (arr.some((b) => (b as { variant?: string })?.variant === 'diseaseInfo')) return arr;
  for (let i = 0; i < arr.length; i += 1) {
    const o = arr[i] as { variant?: string; diseaseOptions?: DiseaseOption[] };
    if (o?.variant !== 'rows' || !Array.isArray(o.diseaseOptions)) continue;
    const opt = o.diseaseOptions.find(
      (d) => d?.enabled && (d.name ?? '').trim() && (d.body ?? '').trim(),
    );
    if (!opt) continue;
    const box = {
      variant: 'diseaseInfo',
      name: (opt.name ?? '').trim(),
      body: (opt.body ?? '').trim().slice(0, 200),
    };
    return [...arr.slice(0, i + 1), box, ...arr.slice(i + 1)];
  }
  return arr;
}

export function HealthReportPreviewPages({ model }: { model: HealthReportPreviewModelJson }) {
  const coverProps = model.coverProps as HealthReportCoverSheetProps;
  const summaryProps = model.summaryProps as HealthReportSummarySheetProps;
  const outerCoverProps = model.outerCoverProps as HealthReportOuterCoverSheetProps;
  const systemsPage3Blocks = withDiseaseBox(model.systemsPage3Blocks);
  const systemsPage3bBlocks = withDiseaseBox(model.systemsPage3bBlocks);

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
        blocks={systemsPage3Blocks as never}
        pageNumber={HEALTH_REPORT_PAGE_SYSTEMS}
        tokenOverrides={model.tokenOverrides ?? undefined}
      />
      <HealthSystemsReportSheet
        hospitalLogoSrc={coverProps.hospitalLogoSrc}
        hospitalLogoAlt={coverProps.hospitalLogoAlt}
        hospitalNameKo={coverProps.hospitalNameKo}
        hospitalNameEn={coverProps.hospitalNameEn}
        blocks={systemsPage3bBlocks as never}
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
