/**
 * 공유 토큰 기반 건강검진 인쇄 페이지.
 * export-by-share PDF 생성 시 Playwright 가 이 URL을 엽니다.
 * 이미지 슬롯을 항상 새로 서명(signImageSlotsInBlocks)하므로
 * DB에 만료된 서명 URL이 저장된 경우에도 올바르게 동작합니다.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-sans-kr/900.css';
// 화면(외부 검토)·PDF 의 폰트 일관성을 위해 Pretendard 도 함께 로드 (스택 1순위와 일치).
import '@fontsource/pretendard/400.css';
import '@fontsource/pretendard/500.css';
import '@fontsource/pretendard/700.css';
import '@fontsource/pretendard/900.css';
import { getChartPgPool } from '@/lib/db';
import { hashShareToken } from '@/lib/chart-app/share-token';
import { hospitalRowFromDb } from '@/lib/chart-app/hospital-db';
import type { HospitalRow } from '@/lib/chart-app/hospitals-types';
import { loadReportSourceData } from '@/lib/chart-app/report-source';
import { buildHealthReportPreviewModel } from '@/lib/chart-app/health-report-preview-model';
import { signImageSlotsInBlocks } from '@/lib/chart-app/health-report-blocks-sign-images';
import { getHealthCheckupGeneratedContentForRun } from '@/lib/generated-run-content';
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

const LINK_CONTENT_TYPE = 'health_checkup';
const LEGACY_LINK_CONTENT_TYPE = 'health-checkup';
const GENERATED_CONTENT_TYPE = 'health_checkup';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const fallback: Metadata = { title: '건강검진 결과보고서' };
  try {
    const { token } = await params;
    if (!token) return fallback;
    const pool = getChartPgPool();
    const hash = hashShareToken(token);
    const link = await pool.query<{ parse_run_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT parse_run_id, expires_at, revoked_at FROM health_report.health_review_share_links WHERE token_hash = $1 AND content_type IN ($2, $3) LIMIT 1`,
      [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
    );
    const row = link.rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) return fallback;
    const gen = await pool.query<{ payload: { coverPatientName?: string; coverCheckupDate?: string } }>(
      `SELECT payload FROM health_report.generated_run_content WHERE parse_run_id = $1::uuid AND content_type = $2 LIMIT 1`,
      [row.parse_run_id, GENERATED_CONTENT_TYPE],
    );
    const payload = gen.rows[0]?.payload;
    const name = payload?.coverPatientName?.trim();
    const date = payload?.coverCheckupDate?.trim();
    const suffix = [name, date].filter(Boolean).join(' / ');
    return { title: suffix ? `건강검진 결과보고서 — ${suffix}` : '건강검진 결과보고서' };
  } catch {
    return fallback;
  }
}

export default async function HealthReportSharePrintPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) notFound();

  const pool = getChartPgPool();
  const hash = hashShareToken(token);

  const link = await pool.query<{ parse_run_id: string; expires_at: Date; revoked_at: Date | null }>(
    `SELECT parse_run_id, expires_at, revoked_at
     FROM health_report.health_review_share_links
     WHERE token_hash = $1 AND content_type IN ($2, $3)
     LIMIT 1`,
    [hash, LINK_CONTENT_TYPE, LEGACY_LINK_CONTENT_TYPE],
  );
  const row = link.rows[0];
  if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) notFound();

  const runId = row.parse_run_id;

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
