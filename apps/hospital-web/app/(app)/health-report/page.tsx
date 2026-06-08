'use client';

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useHospital } from '@/components/shell/hospital-context';
import { CenteredSpinner } from '@/components/ui/loading-spinner';
import { StickyHeader } from '@/components/ui/sticky-header';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChartType = 'intovet' | 'plusvet' | 'efriends' | 'other';

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
};

const CASE_IMAGE_BUCKET = 'case-image';
const MAX_FILE_SIZE = 30 * 1024 * 1024;

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  intovet: 'IntoVet EMR',
  plusvet: 'PlusVet EMR',
  efriends: 'eFriends EMR',
  other: '기타',
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

  // ---------------------------------------------------------------------------
  // PDF handling
  // ---------------------------------------------------------------------------
  const handlePdfFiles = useCallback((files: File[]) => {
    setPdfError(null);
    const valid: File[] = [];
    for (const file of files) {
      if (file.type !== 'application/pdf') { setPdfError('PDF 파일만 업로드할 수 있습니다.'); continue; }
      if (file.size > MAX_FILE_SIZE) { setPdfError(`각 파일은 30MB 이하여야 합니다. (${file.name}: ${formatBytes(file.size)})`); continue; }
      valid.push(file);
    }
    if (valid.length > 0) { setPdfFiles((prev) => [...prev, ...valid]); setStage('idle'); }
  }, []);

  const removePdfFile = useCallback((idx: number) => {
    setPdfFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const onPdfDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []); if (files.length) handlePdfFiles(files);
  }, [handlePdfFiles]);

  // ---------------------------------------------------------------------------
  // Image handling
  // ---------------------------------------------------------------------------
  const addImageFiles = useCallback((files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    const previews = images.map((f) => URL.createObjectURL(f));
    setImageFiles((prev) => [...prev, ...images]);
    setImagePreviews((prev) => [...prev, ...previews]);
  }, []);

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
  async function uploadImages(runId: string): Promise<{ paths: string[]; failed: number }> {
    if (imageFiles.length === 0) return { paths: [], failed: 0 };
    const supabase = createClient();
    const exts = imageFiles.map((f) => (f.name.split('.').pop() || 'jpg').toLowerCase());
    const signRes = await fetch('/api/health-report/case-images/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, exts }),
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
  // Save hospital_notes — 서버(서비스 롤)에서 저장. admin 강조사항 pre-fill / 이미지 분류 트리거의 소스.
  // ---------------------------------------------------------------------------
  async function saveHospitalNotes(runId: string, imagePaths: string[]): Promise<void> {
    const res = await fetch('/api/health-report/hospital-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, emphasisText, imagePaths }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? '접수 정보 저장에 실패했습니다.');
    }
  }

  // ---------------------------------------------------------------------------
  // Submit
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

      // Step 3 — extract (병원에는 "분석 중" 노출 안 함, 버튼은 "파일 업로드 중"만)
      setStage('extracting');
      const extractRes = await fetch('/api/health-report/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePaths, storageBucket: bucket, chartType, hospitalId, emphasisText }),
      });
      // 타임아웃/크래시 시 Vercel이 비-JSON 에러 페이지를 주므로 text로 받아 안전 파싱한다.
      const extractRaw = await extractRes.text();
      let extractData: { error?: string; runId?: string } = {};
      try { extractData = extractRaw ? JSON.parse(extractRaw) : {}; } catch { /* 비-JSON(타임아웃 등) */ }
      if (!extractRes.ok || !extractData.runId) {
        const timedOut =
          extractRes.status === 504 ||
          extractRes.status === 408 ||
          /FUNCTION_INVOCATION_TIMEOUT|timeout|timed out/i.test(extractRaw);
        throw new Error(
          timedOut
            ? '파일 용량 초과 - PDF파일이 너무 용량이 크거나 이미지 파일이 너무 많습니다.'
            : (extractData.error ?? '요청 처리에 실패했습니다.'),
        );
      }
      const runId = extractData.runId;

      // Step 4 — 이미지(best-effort) + hospital_notes(항상 저장)
      // 이미지가 일부/전부 실패해도 강조사항·"병원 제출" 스티커(hospital_notes)는 반드시 저장한다.
      setStage('saving');
      setProgressMessage('접수 정보 저장 중…');
      let imagePaths: string[] = [];
      let imgFailed = 0;
      let imgStepFailed = false;
      try {
        const r = await uploadImages(runId);
        imagePaths = r.paths;
        imgFailed = r.failed;
      } catch {
        imgStepFailed = true; // 서명 URL 단계 실패 등 — 그래도 notes는 저장한다
      }
      await saveHospitalNotes(runId, imagePaths);
      setImageWarning(
        imgStepFailed
          ? '이미지 업로드에 실패했지만 강조사항은 저장되었습니다. 이미지는 다시 등록해 주세요.'
          : imgFailed > 0
            ? `이미지 ${imgFailed}장 업로드에 실패했습니다. (강조사항은 저장됨)`
            : '',
      );

      setStage('done');
      setPdfFiles([]);
      setImageFiles([]);
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
                      {/* 활성 검토 링크가 있으면 '리포트 확인' 버튼, 아직 링크 생성 전이면 '요청 완료' 표시. */}
                      {item.shareUrl ? (
                        <a href={item.shareUrl} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', fontSize: '12px', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          리포트 확인
                        </a>
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
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>리포트 생성 요청</div>
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
                    onChange={(e: ChangeEvent<HTMLInputElement>) => { const fs = Array.from(e.target.files ?? []); if (fs.length) handlePdfFiles(fs); e.target.value = ''; }} />
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
                {pdfError && <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--danger)' }}>{pdfError}</div>}
              </FormField>

              {/* Images */}
              <FormField label="사진 자료" hint="선택">
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
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>여러 장 가능 · jpg / png / webp</div>
                </div>
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
                style={{
                  width: '100%', padding: '10px',
                  background: canSubmit ? 'var(--accent)' : 'var(--bg-subtle)',
                  color: canSubmit ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${canSubmit ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)', fontSize: '13px', fontWeight: 600,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  transition: 'background 0.15s',
                }}>
                {isProcessing ? <><Spinner />파일 업로드 중…</> : '리포트 생성 요청'}
              </button>
              {stage === 'done' && (
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--success)', textAlign: 'center' }}>
                  요청 완료
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '6px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: '2px' }}>*</span>}
        </label>
        {hint && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: '13px',
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
