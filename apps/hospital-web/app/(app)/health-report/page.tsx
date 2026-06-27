'use client';

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { compressPdfIfNeeded, PdfCompressError } from '@/lib/pdf-compress';
import { useHospital } from '@/components/shell/hospital-context';
import { CenteredSpinner } from '@/components/ui/loading-spinner';
import { StickyHeader } from '@/components/ui/sticky-header';
import { primaryPillStyle } from '@/lib/form-styles';
import { SectionTitle, FieldLabel } from '@/components/ui/typography';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChartType = 'intovet' | 'plusvet' | 'efriends' | 'woorien_pms';

type UploadStage =
  | 'idle'
  | 'getting-url'
  | 'uploading-pdf'
  | 'extracting'
  | 'saving'
  | 'done'
  | 'error';

type RequestItem = {
  id: string;
  createdAt: string;
  friendlyId: string | null;
  patientName: string | null;
  ownerName: string | null;
  shareUrl: string | null;
  expiresAt: string | null;
  shareExpired?: boolean;
  status?: 'done' | 'processing' | 'error';
  errorText?: string;
};

const CASE_IMAGE_BUCKET = 'case-image';
const MAX_FILE_SIZE = 30 * 1024 * 1024;
// 업로드 가능한 사진 최대 수(처리 시간/안정성 고려).
const MAX_IMAGES = 30;

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  intovet: '인투벳',
  plusvet: '플러스벳',
  efriends: '이프렌즈',
  woorien_pms: '우리엔PMS',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------
export default function HealthReportPage() {
  // List
  const [items, setItems] = useState<RequestItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Form
  const [chartType, setChartType] = useState<ChartType>('intovet');
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [emphasisText, setEmphasisText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isImageDragging, setIsImageDragging] = useState(false);

  // Upload/processing
  const [stage, setStage] = useState<UploadStage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // 이미지 일부/전부 업로드 실패 시 소프트 경고(제출 자체는 성공 — 강조·스티커는 저장됨).
  const [imageWarning, setImageWarning] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);

  const { hospitalId } = useHospital();

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { imagePreviews.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------
  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/health-report/list');
      const data = (await res.json()) as { items?: RequestItem[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? '목록을 불러오지 못했습니다.');
      setItems(data.items ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  // 처리중(분석 중) 접수가 있으면 주기적으로 목록을 갱신해 완료/실패를 반영한다.
  useEffect(() => {
    if (!items.some((it) => it.status === 'processing')) return;
    const t = setInterval(() => void loadList(), 10000);
    return () => clearInterval(t);
  }, [items, loadList]);

  // ---------------------------------------------------------------------------
  // PDF handling
  // ---------------------------------------------------------------------------
  const handlePdfFiles = useCallback(async (files: File[]) => {
    setPdfError(null);
    const pdfs = files.filter((f) => {
      if (f.type !== 'application/pdf') { setPdfError('PDF 파일만 업로드할 수 있습니다.'); return false; }
      return true;
    });
    const needsCompress = pdfs.some((f) => f.size > MAX_FILE_SIZE);
    if (needsCompress) setCompressing(true);
    const toAdd: File[] = [];
    try {
      for (const file of pdfs) {
        if (file.size <= MAX_FILE_SIZE) { toAdd.push(file); continue; }
        // 30MB 초과 → 브라우저에서 압축 시도. 실패해도 정상 업로드엔 영향 없고 안내만 띄운다.
        try {
          toAdd.push(await compressPdfIfNeeded(file, MAX_FILE_SIZE));
        } catch (e) {
          setPdfError(
            e instanceof PdfCompressError && e.kind === 'too_large'
              ? `압축해도 30MB를 초과합니다. (${file.name}) 해당 진료분 페이지만 잘라서 올려주세요.`
              : `PDF 압축에 실패했습니다. (${file.name}) 파일을 30MB 이하로 줄여 다시 올려주세요.`,
          );
        }
      }
    } finally {
      if (needsCompress) setCompressing(false);
    }
    if (toAdd.length > 0) { setPdfFiles((prev) => [...prev, ...toAdd]); setStage('idle'); }
  }, []);

  const removePdfFile = useCallback((idx: number) => {
    setPdfFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const onPdfDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []); if (files.length) void handlePdfFiles(files);
  }, [handlePdfFiles]);

  // ---------------------------------------------------------------------------
  // Image handling
  // ---------------------------------------------------------------------------
  const addImageFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;

    // 최대 MAX_IMAGES 장. 초과분은 받지 않고 안내한다.
    const available = MAX_IMAGES - imageFiles.length;
    if (available <= 0) {
      setImageError(`사진은 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`);
      return;
    }
    const accepted = images.slice(0, available);
    setImageError(
      accepted.length < images.length
        ? `사진은 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다. (${images.length - accepted.length}장 제외됨)`
        : null,
    );

    const previews = accepted.map((f) => URL.createObjectURL(f));
    setImageFiles((prev) => [...prev, ...accepted]);
    setImagePreviews((prev) => [...prev, ...previews]);
  };

  const onImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    addImageFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const onImageDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsImageDragging(false);
    addImageFiles(Array.from(e.dataTransfer.files ?? []));
  }, [addImageFiles]);

  const removeImage = (idx: number) => {
    URL.revokeObjectURL(imagePreviews[idx]);
    setImageFiles((prev) => prev.filter((_, i) => i !== idx));
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---------------------------------------------------------------------------
  // PDF upload via signed URL
  // ---------------------------------------------------------------------------
  function uploadPdfWithProgress(signedUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signedUrl);
      const formData = new FormData();
      formData.append('cacheControl', '3600');
      formData.append('', file);
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Storage upload failed: HTTP ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new Error('네트워크 오류로 PDF 업로드에 실패했습니다.')));
      xhr.send(formData);
    });
  }

  // ---------------------------------------------------------------------------
  // Image upload — 서버에서 발급한 서명 URL로 case-image 버킷에 직접 업로드.
  // (서비스 롤이 경로/URL을 발급하므로 클라이언트 스토리지 RLS·함수 본문 크기 제한에 의존하지 않음)
  // ---------------------------------------------------------------------------
  async function uploadImages(submissionId: string): Promise<{ paths: string[]; failed: number }> {
    if (imageFiles.length === 0) return { paths: [], failed: 0 };
    const supabase = createClient();
    const exts = imageFiles.map((f) => (f.name.split('.').pop() || 'jpg').toLowerCase());
    const signRes = await fetch('/api/health-report/case-images/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, exts }),
    });
    // ok 체크를 .json() 앞에 둔다 — 타임아웃/에러 시 비-JSON 응답이 와도 "JSON" 파싱 에러가 아니라 진짜 원인이 뜨도록.
    if (!signRes.ok) {
      const err = (await signRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `이미지 업로드 URL 생성에 실패했습니다. (HTTP ${signRes.status})`);
    }
    const signData = (await signRes.json().catch(() => ({}))) as {
      uploads?: { path: string; token: string }[];
    };
    const uploads = signData.uploads ?? [];

    // 동시 업로드 개수를 제한하고, 개별 실패는 허용한다(best-effort). 한 장이 실패해도 전체를 죽이지 않음.
    const CONCURRENCY = 6;
    const paths: string[] = [];
    let failed = 0;
    for (let i = 0; i < uploads.length; i += CONCURRENCY) {
      const batch = uploads.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async ({ path, token }, j) => {
          const file = imageFiles[i + j];
          if (!file) return;
          try {
            const { error } = await supabase.storage
              .from(CASE_IMAGE_BUCKET)
              .uploadToSignedUrl(path, token, file, { contentType: file.type });
            if (error) throw error;
            paths.push(path);
          } catch {
            failed += 1;
          }
        }),
      );
    }
    return { paths, failed };
  }

  // ---------------------------------------------------------------------------
  // Submit (비동기 접수)
  // ---------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (pdfFiles.length === 0 || !hospitalId) {
      if (!hospitalId) { setErrorMessage('병원 정보를 불러올 수 없습니다. 다시 로그인해 주세요.'); setStage('error'); }
      return;
    }

    setStage('getting-url');
    setProgressMessage('업로드 URL 생성 중…');
    setUploadProgress(0);
    setErrorMessage('');
    setImageWarning('');

    try {
      // 제출ID — 추출 전(runId 없음)에도 이미지를 이 ID 경로로 올려 연결한다.
      const submissionId = crypto.randomUUID();

      // Step 1·2 — 각 PDF signed URL 발급 + 업로드 (같은 진료분의 차트본문/검사결과 등 여러 PDF 지원)
      const storagePaths: string[] = [];
      let bucket = '';
      for (let i = 0; i < pdfFiles.length; i++) {
        const f = pdfFiles[i];
        setStage('getting-url');
        setProgressMessage('업로드 URL 생성 중…');
        const urlRes = await fetch('/api/health-report/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: f.name, fileType: f.type, fileSize: f.size }),
        });
        if (!urlRes.ok) {
          const err = (await urlRes.json()) as { error?: string };
          throw new Error(err.error ?? '업로드 URL 생성에 실패했습니다.');
        }
        const { signedUrl, storagePath, bucket: b } = (await urlRes.json()) as {
          signedUrl: string; storagePath: string; bucket: string;
        };
        bucket = b;

        setStage('uploading-pdf');
        const label = pdfFiles.length > 1 ? `(${i + 1}/${pdfFiles.length}) ` : '';
        await uploadPdfWithProgress(signedUrl, f, (pct) => {
          setUploadProgress(pct);
          setProgressMessage(`PDF 업로드 중… ${label}${pct}%`);
        });
        storagePaths.push(storagePath);
      }
      setUploadProgress(100);

      // Step 3 — 이미지 업로드(submissionId 경로, best-effort)
      setStage('saving');
      setProgressMessage('이미지 업로드 중…');
      let imagePaths: string[] = [];
      let imgFailed = 0;
      let imgStepFailed = false;
      try {
        const r = await uploadImages(submissionId);
        imagePaths = r.paths;
        imgFailed = r.failed;
      } catch {
        imgStepFailed = true; // 서명 URL 단계 실패 등 — 그래도 접수는 진행
      }

      // Step 4 — 비동기 접수(추출·저장은 백그라운드). 사용자는 기다리지 않아도 됨.
      setProgressMessage('접수 중…');
      const submitRes = await fetch('/api/health-report/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'hospital_notes',
          chartType,
          storageBucket: bucket,
          storagePaths,
          emphasisText,
          imagePaths,
        }),
      });
      const submitData = (await submitRes.json().catch(() => ({}))) as { jobId?: string; error?: string };
      if (!submitRes.ok || !submitData.jobId) {
        throw new Error(submitData.error ?? '접수에 실패했습니다.');
      }
      setImageWarning(
        imgStepFailed
          ? '이미지 업로드에 실패했습니다. 접수는 되었으나 이미지는 다시 등록해 주세요.'
          : imgFailed > 0
            ? `이미지 ${imgFailed}장 업로드에 실패했습니다. (접수는 됨)`
            : '',
      );

      setStage('done');
      setPdfFiles([]);
      setImageFiles([]);
      setImageError(null);
      imagePreviews.forEach((u) => URL.revokeObjectURL(u));
      setImagePreviews([]);
      setEmphasisText('');
      setUploadProgress(0);
      setProgressMessage('');
      await loadList();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.');
      setStage('error');
    }
  };

  const isProcessing = stage === 'getting-url' || stage === 'uploading-pdf' || stage === 'extracting' || stage === 'saving';
  const canSubmit = pdfFiles.length > 0 && !isProcessing;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div>
      <StickyHeader>
        {/* 헤더 */}
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>건강검진 리포트</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            차트 PDF를 업로드해 보호자용 건강검진 리포트 생성을 요청하고, 진행 상태를 확인합니다.
          </p>
        </div>
      </StickyHeader>

      <div style={{ display: 'flex', gap: '0', alignItems: 'stretch', maxWidth: '1100px' }}>

      {/* ================================================================== */}
      {/* LEFT — Request list                                                  */}
      {/* ================================================================== */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: '24px' }}>
        <div>
          <div style={{ padding: '0 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>리포트 목록</span>
            <button onClick={() => void loadList()} style={{ background: 'none', border: 'none', fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}>새로고침</button>
          </div>

          {listLoading ? (
            <CenteredSpinner minHeight={200} />
          ) : listError ? (
            <div style={{ padding: '20px 18px', fontSize: '13px', color: 'var(--danger)' }}>{listError}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '48px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>📋</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>아직 요청이 없습니다</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>오른쪽에서 PDF를 업로드해 첫 요청을 시작하세요.</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle)' }}>
                  {['요청일', '환자명', '보호자명', '상태'].map((h) => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '11px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '11px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {formatDate(item.createdAt)}
                      {item.friendlyId && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>#{item.friendlyId}</div>}
                    </td>
                    <td style={{ padding: '11px 14px', color: 'var(--text)' }}>{item.patientName ?? '—'}</td>
                    <td style={{ padding: '11px 14px', color: 'var(--text)' }}>{item.ownerName ?? '—'}</td>
                    <td style={{ padding: '11px 14px' }}>
                      {/* 처리중/실패 접수면 상태 배지, 아니면 링크/완료 표시. */}
                      {item.status === 'processing' ? (
                        <span style={{ display: 'inline-block', padding: '3px 10px', background: 'var(--accent-subtle)', color: 'var(--accent)', borderRadius: '999px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          분석 중…
                        </span>
                      ) : item.status === 'error' ? (
                        <span title={item.errorText} style={{ display: 'inline-block', padding: '3px 10px', background: 'var(--danger-subtle)', color: 'var(--danger)', borderRadius: '999px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help' }}>
                          실패
                        </span>
                      ) : item.shareUrl ? (
                        <a href={item.shareUrl} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', fontSize: '12px', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          리포트 확인
                        </a>
                      ) : item.shareExpired ? (
                        <span title={item.expiresAt ? `${formatDate(item.expiresAt)} 만료` : undefined} style={{ display: 'inline-block', padding: '3px 10px', background: 'var(--danger-subtle)', color: 'var(--danger)', borderRadius: '999px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', cursor: item.expiresAt ? 'help' : 'default' }}>
                          검토 링크 만료
                        </span>
                      ) : (
                        <span style={{ display: 'inline-block', padding: '3px 10px', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', borderRadius: '999px', fontSize: '11px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                          요청 완료
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* RIGHT — New request form (sticky)                                    */}
      {/* ================================================================== */}
      <div style={{ width: '340px', flexShrink: 0, borderLeft: '1px solid var(--border-strong)', paddingLeft: '24px' }}>
        <div style={{ position: 'sticky', top: '24px' }}>
          <div style={{ padding: '0 0 10px' }}>
            <SectionTitle>리포트 생성 요청</SectionTitle>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>차트 PDF를 업로드해 주세요</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Error */}
            {stage === 'error' && (
              <div style={{ background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: '12px', color: 'var(--text)' }}>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>오류 </span>{errorMessage}
              </div>
            )}

            <>
              {/* Chart type */}
              <FormField label="차트 종류">
                <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} disabled={isProcessing} style={selectStyle}>
                  {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((k) => (
                    <option key={k} value={k}>{CHART_TYPE_LABELS[k]}</option>
                  ))}
                </select>
              </FormField>

              {/* PDF */}
              <FormField label="차트 PDF" required hint="여러 개 가능">
                <div
                  onDrop={onPdfDrop}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onClick={() => !isProcessing && pdfInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDragging ? 'var(--accent)' : pdfError ? 'var(--danger)' : 'var(--border-strong)'}`,
                    borderRadius: 'var(--radius)', padding: '18px 12px', textAlign: 'center',
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void handlePdfFiles(fs); e.target.value = ''; }} />
                  {pdfFiles.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
                      {pdfFiles.map((f, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 10px' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all' }}>{f.name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>{formatBytes(f.size)}</div>
                          </div>
                          {!isProcessing && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removePdfFile(idx); }}
                              aria-label="삭제"
                              style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', lineHeight: 1 }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      {!isProcessing && <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '2px', textAlign: 'center' }}>+ 클릭하여 PDF 추가</div>}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '20px', marginBottom: '5px' }}>📄</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>끌어다 놓거나 클릭하여 선택</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>PDF · 최대 30MB · 여러 개 가능</div>
                    </>
                  )}
                </div>
                {compressing && <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--accent)' }}>PDF 용량이 커서 압축 중이에요… 잠시만 기다려주세요.</div>}
                {pdfError && <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--danger)' }}>{pdfError}</div>}
              </FormField>

              {/* Images */}
              <FormField label="사진 자료" hint={`선택 · 최대 ${MAX_IMAGES}장`}>
                <div
                  onDrop={onImageDrop}
                  onDragOver={(e) => { e.preventDefault(); if (!isProcessing) setIsImageDragging(true); }}
                  onDragLeave={() => setIsImageDragging(false)}
                  onClick={() => !isProcessing && imageInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isImageDragging ? 'var(--accent)' : 'var(--border-strong)'}`,
                    borderRadius: 'var(--radius)', padding: '18px 12px', textAlign: 'center',
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    background: isImageDragging ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <input ref={imageInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/*" multiple style={{ display: 'none' }} onChange={onImageChange} />
                  <div style={{ fontSize: '20px', marginBottom: '5px' }}>🖼️</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>끌어다 놓거나 클릭하여 선택</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    최대 {MAX_IMAGES}장 · jpg / png / webp{imageFiles.length > 0 ? ` · ${imageFiles.length}/${MAX_IMAGES}장` : ''}
                  </div>
                </div>
                {imageError && (
                  <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--danger)' }}>{imageError}</div>
                )}
                {imagePreviews.length > 0 && (
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {imagePreviews.map((src, idx) => (
                      <div key={idx} style={{ position: 'relative', width: '60px', height: '60px' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={imageFiles[idx]?.name ?? `img-${idx}`} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} />
                        {!isProcessing && (
                          <button onClick={(e) => { e.stopPropagation(); removeImage(idx); }}
                            style={{ position: 'absolute', top: '-5px', right: '-5px', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </FormField>

              {/* Emphasis */}
              <FormField label="강조사항" hint="선택">
                <textarea
                  value={emphasisText} onChange={(e) => setEmphasisText(e.target.value)}
                  disabled={isProcessing} rows={3}
                  placeholder="보호자에게 강조할 사항을 입력하세요"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', outline: 'none', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </FormField>

              {/* Submit */}
              <button onClick={handleSubmit} disabled={!canSubmit}
                style={{ ...primaryPillStyle(!canSubmit), width: '100%', padding: '10px', fontSize: '13px' }}>
                {isProcessing ? <><Spinner />파일 업로드 중…</> : '리포트 생성 요청'}
              </button>
              {stage === 'done' && (
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--success)', textAlign: 'center', lineHeight: 1.5 }}>
                  접수되었습니다 · 분석이 끝나면 왼쪽 목록에 표시됩니다
                  {imageWarning && (
                    <div style={{ marginTop: '6px', fontWeight: 600, color: 'var(--danger)' }}>{imageWarning}</div>
                  )}
                </div>
              )}
            </>
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function FormField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel required={required} hint={hint}>{label}</FieldLabel>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
  backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '13px',
  appearance: 'none',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%236b7280\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '28px', cursor: 'pointer',
};

function Spinner({ accent }: { accent?: boolean }) {
  const c = accent ? 'var(--accent)' : 'rgba(255,255,255,0.4)';
  const t = accent ? 'var(--accent)' : '#fff';
  return (
    <span style={{ display: 'inline-block', width: '12px', height: '12px', border: `2px solid ${c}`, borderTopColor: t, borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
}
