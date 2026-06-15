// 건강검진 리포트 PDF를 스토리지에 저장하고 서명 URL을 돌려주는 헬퍼.
// 카톡 발송 시 1회 렌더·저장하고, 고객이 버튼(GET /review/.../pdf)을 누르면 저장본을 빠르게 서빙한다.
import { getChartAppSupabaseService } from '@/lib/chart-app/supabase-service';
import { getPdfUploadsBucket } from '@/lib/chart-app/storage-config';
import { renderPdfFromPageUrl } from '@/lib/playwright-browser';

const PDF_DIR = 'report-pdf';
const SIGNED_TTL_SEC = 60 * 60; // 서명 URL 1시간(파일은 영구 보관, 방문 때마다 새로 서명)

function pdfPath(runId: string): string {
  return `${PDF_DIR}/${runId}.pdf`;
}

/** 저장된 PDF 의 서명 URL. 없으면 null. */
export async function getStoredReportPdfSignedUrl(runId: string): Promise<string | null> {
  const supabase = getChartAppSupabaseService();
  const { data, error } = await supabase.storage.from(getPdfUploadsBucket()).createSignedUrl(pdfPath(runId), SIGNED_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** PDF를 렌더해 저장(덮어쓰기)하고 서명 URL을 돌려준다. */
export async function renderAndStoreReportPdf(
  runId: string,
  printUrl: string,
  requestId?: string,
): Promise<string> {
  const pdf = await renderPdfFromPageUrl(printUrl, { requestId });
  const supabase = getChartAppSupabaseService();
  const bucket = getPdfUploadsBucket();
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(pdfPath(runId), new Uint8Array(pdf), { contentType: 'application/pdf', upsert: true });
  if (upErr) throw new Error(`PDF 저장 실패: ${upErr.message}`);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(pdfPath(runId), SIGNED_TTL_SEC);
  if (error || !data?.signedUrl) throw new Error(`PDF 서명 URL 발급 실패: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}
