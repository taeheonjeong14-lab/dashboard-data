/**
 * 건강검진 인쇄 HTML — vet-report `app/runs/[runId]/report/print/page.tsx` 와 동일 구조.
 * Chart API는 Postgres(pool)로 조회한다.
 */
import { notFound } from 'next/navigation';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-sans-kr/900.css';
// Pretendard 는 report-a4-tokens 폰트 스택의 1순위. 서버 chromium 에는 시스템 폰트로 깔려있지
// 않아 fallback(NotoSansKR) 로 떨어져 글자 폭 차이로 줄바꿈이 어긋났다 — 같은 family 를 화면·PDF 양쪽에 강제 로드한다.
import '@fontsource/pretendard/400.css';
import '@fontsource/pretendard/500.css';
import '@fontsource/pretendard/700.css';
import '@fontsource/pretendard/900.css';
import { PARSE_RUN_UUID_RE, parseRunExists } from '@/lib/parse-run-check';
import { getChartPgPool } from '@/lib/db';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import type { HospitalRow } from '@/lib/chart-app/hospitals-types';
import { getHealthCheckupGeneratedContentForRun } from '@/lib/generated-run-content';
import { loadReportSourceData } from '@/lib/chart-app/report-source';
import { buildHealthReportPreviewModel } from '@/lib/chart-app/health-report-preview-model';
import { signImageSlotsInBlocks } from '@/lib/chart-app/health-report-blocks-sign-images';
import type { HealthReportCoverSheetProps } from '@/app/components/report/health-report-cover-sheet';
import { HealthReportCoverSheet } from '@/app/components/report/health-report-cover-sheet';
import type { HealthReportOuterCoverSheetProps } from '@/app/components/report/health-report-outer-cover-sheet';
import { HealthReportOuterCoverSheet } from '@/app/components/report/health-report-outer-cover-sheet';
import type { HealthReportSummarySheetProps } from '@/app/components/report/health-report-summary-sheet';
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

export default async function HealthReportPrintPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  if (!runId || !PARSE_RUN_UUID_RE.test(runId)) notFound();

  const runOk = await parseRunExists(runId);
  if (!runOk) notFound();

  const pool = getChartPgPool();
  const generatedRow = await getHealthCheckupGeneratedContentForRun(null, runId);
  if (!generatedRow) notFound();

  const { rows: prRows } = await pool.query<{ hospital_id: string | null }>(
    `SELECT hospital_id FROM chart_pdf.parse_runs WHERE id = $1::uuid LIMIT 1`,
    [runId],
  );
  const hospitalId = prRows[0]?.hospital_id ?? null;

  let hospitalRow: HospitalRow | null = null;
  if (hospitalId) {
    const { rows } = await pool.query(`SELECT * FROM core.hospitals WHERE id::text = $1 LIMIT 1`, [
      String(hospitalId),
    ]);
    hospitalRow = hospitalRowFromDb(rows[0] ?? null);
  }

  const source = await loadReportSourceData(runId);
  const model = buildHealthReportPreviewModel({
    source,
    generated: generatedRow.payload,
    hospital: hospitalRow,
  });

  await Promise.all([
    signImageSlotsInBlocks(model.systemsPage4Blocks),
    signImageSlotsInBlocks(model.systemsPage5Blocks),
  ]);

  const coverProps = model.coverProps as HealthReportCoverSheetProps;
  const summaryProps = model.summaryProps as HealthReportSummarySheetProps;
  const outerCoverProps = model.outerCoverProps as HealthReportOuterCoverSheetProps;

  return (
    <div style={{ background: '#ffffff' }}>
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
        blocks={model.systemsPage3Blocks}
        pageNumber={HEALTH_REPORT_PAGE_SYSTEMS}
        tokenOverrides={model.tokenOverrides ?? undefined}
      />
      <HealthSystemsReportSheet
        hospitalLogoSrc={coverProps.hospitalLogoSrc}
        hospitalLogoAlt={coverProps.hospitalLogoAlt}
        hospitalNameKo={coverProps.hospitalNameKo}
        hospitalNameEn={coverProps.hospitalNameEn}
        blocks={model.systemsPage3bBlocks}
        pageNumber={HEALTH_REPORT_PAGE_SYSTEMS_B}
        tokenOverrides={model.tokenOverrides ?? undefined}
      />
      <HealthSystemsReportSheet
        hospitalLogoSrc={coverProps.hospitalLogoSrc}
        hospitalLogoAlt={coverProps.hospitalLogoAlt}
        hospitalNameKo={coverProps.hospitalNameKo}
        hospitalNameEn={coverProps.hospitalNameEn}
        blocks={model.systemsPage4Blocks}
        pageNumber={HEALTH_REPORT_PAGE_DENTAL_SKIN}
        tokenOverrides={model.tokenOverrides ?? undefined}
      />
      <HealthSystemsReportSheet
        hospitalLogoSrc={coverProps.hospitalLogoSrc}
        hospitalLogoAlt={coverProps.hospitalLogoAlt}
        hospitalNameKo={coverProps.hospitalNameKo}
        hospitalNameEn={coverProps.hospitalNameEn}
        blocks={model.systemsPage5Blocks}
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
