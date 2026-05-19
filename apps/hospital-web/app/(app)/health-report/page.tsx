'use client';

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChartType = 'intovet' | 'plusvet' | 'efriends' | 'other';

type UploadStage =
  | 'idle'
  | 'getting-url'
  | 'uploading-pdf'
  | 'extracting'
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
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
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------
export default function HealthReportPage() {
  // List state
  const [items, setItems] = useState<RequestItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Form state
  const [chartType, setChartType] = useState<ChartType>('intovet');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [emphasisText, setEmphasisText] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Upload/processing state
  const [stage, setStage] = useState<UploadStage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Hospital ID
  const [hospitalId, setHospitalId] = useState<string | null>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .schema('core')
        .from('users')
        .select('hospital_id')
        .eq('id', user.id)
        .single();
      if (profile?.hospital_id) setHospitalId(profile.hospital_id as string);
    })();
  }, []);

  // ---------------------------------------------------------------------------
  // List fetching
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
  // PDF file handling
  // ---------------------------------------------------------------------------
  const handlePdfFile = useCallback((file: File) => {
    setPdfError(null);
    if (file.type !== 'application/pdf') { setPdfError('PDF 파일만 업로드할 수 있습니다.'); return; }
    if (file.size > MAX_FILE_SIZE) { setPdfError(`파일 크기는 30MB 이하여야 합니다. (현재: ${formatBytes(file.size)})`); return; }
    setPdfFile(file);
  }, []);

  const onPdfDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handlePdfFile(file);
  }, [handlePdfFile]);

  // ---------------------------------------------------------------------------
  // Upload
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
  // Submit
  // ---------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!pdfFile || !hospitalId) {
      if (!hospitalId) { setErrorMessage('병원 정보를 불러올 수 없습니다. 다시 로그인해 주세요.'); setStage('error'); }
      return;
    }

    setStage('getting-url');
    setProgressMessage('업로드 URL 생성 중…');
    setUploadProgress(0);
    setErrorMessage('');

    try {
      const urlRes = await fetch('/api/health-report/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: pdfFile.name, fileType: pdfFile.type, fileSize: pdfFile.size }),
      });
      if (!urlRes.ok) {
        const err = (await urlRes.json()) as { error?: string };
        throw new Error(err.error ?? '업로드 URL 생성에 실패했습니다.');
      }
      const { signedUrl, storagePath, bucket } = (await urlRes.json()) as { signedUrl: string; storagePath: string; bucket: string };

      setStage('uploading-pdf');
      setProgressMessage('PDF 업로드 중…');
      await uploadPdfWithProgress(signedUrl, pdfFile, (pct) => {
        setUploadProgress(pct);
        setProgressMessage(`PDF 업로드 중… ${pct}%`);
      });
      setUploadProgress(100);

      setStage('extracting');
      const msgs = ['텍스트 추출 중…', '데이터 구조화 중…', 'AI 분석 중…', '결과 저장 중…'];
      let mi = 0;
      setProgressMessage(msgs[0]);
      const iv = setInterval(() => { mi = (mi + 1) % msgs.length; setProgressMessage(msgs[mi]); }, 4000);

      try {
        const extractRes = await fetch('/api/health-report/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath, storageBucket: bucket, chartType, hospitalId, emphasisText }),
        });
        const extractData = (await extractRes.json()) as { error?: string };
        if (!extractRes.ok) throw new Error(extractData.error ?? '차트 분석에 실패했습니다.');
      } finally {
        clearInterval(iv);
      }

      setStage('done');
      setPdfFile(null);
      setEmphasisText('');
      setUploadProgress(0);
      setProgressMessage('');
      await loadList();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.');
      setStage('error');
    }
  };

  function resetForm() {
    setPdfFile(null);
    setPdfError(null);
    setEmphasisText('');
    setStage('idle');
    setUploadProgress(0);
    setProgressMessage('');
    setErrorMessage('');
  }

  const isProcessing = stage === 'getting-url' || stage === 'uploading-pdf' || stage === 'extracting';
  const canSubmit = !!pdfFile && !isProcessing;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', maxWidth: '1100px' }}>

      {/* ================================================================== */}
      {/* LEFT — Request list                                                  */}
      {/* ================================================================== */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: '16px' }}>
          <h1 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700, color: 'var(--text)' }}>
            건강검진 리포트
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
            PDF 제출 후 1영업일 내에 검토 링크를 보내드립니다.
          </p>
        </div>

        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>요청 목록</span>
            <button onClick={() => void loadList()} style={{ background: 'none', border: 'none', fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}>
              새로고침
            </button>
          </div>

          {listLoading ? (
            <div style={{ padding: '40px 18px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>불러오는 중…</div>
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
                      {item.shareUrl ? (
                        <a href={item.shareUrl} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', fontSize: '12px', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          검토 링크 →
                        </a>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-muted)' }}>
                          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                          검토 중
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
      <div style={{ width: '340px', flexShrink: 0, position: 'sticky', top: '24px' }}>
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

          {/* Form header */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>새 분석 요청</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>차트 PDF를 업로드해 주세요</div>
          </div>

          <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Success banner */}
            {stage === 'done' && (
              <div style={{ background: 'var(--success-subtle, #f0fdf4)', border: '1px solid var(--success, #16a34a)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: '13px', color: 'var(--success, #16a34a)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span>✓ 요청이 접수되었습니다</span>
                <button onClick={resetForm} style={{ background: 'none', border: 'none', fontSize: '11px', color: 'var(--success, #16a34a)', cursor: 'pointer', textDecoration: 'underline', padding: 0, whiteSpace: 'nowrap' }}>새 요청</button>
              </div>
            )}

            {/* Error banner */}
            {stage === 'error' && (
              <div style={{ background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: '12px', color: 'var(--text)' }}>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>오류 </span>{errorMessage}
              </div>
            )}

            {stage !== 'done' && (<>
              {/* Chart type */}
              <FormField label="차트 종류">
                <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} disabled={isProcessing} style={selectStyle}>
                  {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((k) => (
                    <option key={k} value={k}>{CHART_TYPE_LABELS[k]}</option>
                  ))}
                </select>
              </FormField>

              {/* PDF upload */}
              <FormField label="차트 PDF">
                <div
                  onDrop={onPdfDrop}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onClick={() => !isProcessing && pdfInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDragging ? 'var(--accent)' : pdfError ? 'var(--danger)' : 'var(--border-strong)'}`,
                    borderRadius: 'var(--radius)',
                    padding: '20px 12px',
                    textAlign: 'center',
                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                    background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); }} />
                  {pdfFile ? (
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '2px', wordBreak: 'break-all' }}>{pdfFile.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatBytes(pdfFile.size)}</div>
                      {!isProcessing && <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '4px' }}>클릭하여 다시 선택</div>}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: '20px', marginBottom: '5px' }}>📄</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>끌어다 놓거나 클릭하여 선택</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>PDF · 최대 30MB</div>
                    </div>
                  )}
                </div>
                {pdfError && <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--danger)' }}>{pdfError}</div>}

                {/* Progress bar */}
                {(stage === 'uploading-pdf' || stage === 'getting-url') && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ height: '4px', background: 'var(--bg)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--accent)', transition: 'width 0.2s' }} />
                    </div>
                    <div style={{ marginTop: '3px', fontSize: '11px', color: 'var(--text-muted)' }}>{progressMessage}</div>
                  </div>
                )}
              </FormField>

              {/* Emphasis */}
              <FormField label="강조사항" hint="선택">
                <textarea
                  value={emphasisText}
                  onChange={(e) => setEmphasisText(e.target.value)}
                  disabled={isProcessing}
                  rows={3}
                  placeholder="보호자에게 강조할 사항을 입력하세요"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', outline: 'none', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </FormField>

              {/* Extracting progress */}
              {stage === 'extracting' && (
                <div style={{ background: 'var(--accent-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Spinner accent />
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>분석 진행 중</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>{progressMessage}</div>
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: canSubmit ? 'var(--accent)' : 'var(--bg-subtle)',
                  color: canSubmit ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${canSubmit ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'background 0.15s',
                }}
              >
                {isProcessing ? <><Spinner />{' '}요청 중…</> : '분석 요청 제출'}
              </button>
            </>)}
          </div>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '6px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>{label}</label>
        {hint && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '13px',
  appearance: 'none',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%236b7280\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: '28px',
  cursor: 'pointer',
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
