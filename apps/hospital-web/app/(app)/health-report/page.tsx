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
  | 'saving-images'
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

  // Form visibility
  const [showForm, setShowForm] = useState(false);

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

  // Fetch hospitalId on mount
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .schema('core')
        .from('users')
        .select('hospital_id')
        .eq('id', user.id)
        .single();
      if (profile?.hospital_id) {
        setHospitalId(profile.hospital_id as string);
      }
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

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // ---------------------------------------------------------------------------
  // PDF file handling
  // ---------------------------------------------------------------------------
  const handlePdfFile = useCallback((file: File) => {
    setPdfError(null);
    if (file.type !== 'application/pdf') {
      setPdfError('PDF 파일만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setPdfError(`파일 크기는 30MB 이하여야 합니다. (현재: ${formatBytes(file.size)})`);
      return;
    }
    setPdfFile(file);
  }, []);

  const onPdfDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handlePdfFile(file);
    },
    [handlePdfFile],
  );

  // ---------------------------------------------------------------------------
  // Upload PDF via signed URL
  // ---------------------------------------------------------------------------
  function uploadPdfWithProgress(
    signedUrl: string,
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<void> {
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
  // Submit handler
  // ---------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!pdfFile) return;
    if (!hospitalId) {
      setErrorMessage('병원 정보를 불러올 수 없습니다. 다시 로그인해 주세요.');
      setStage('error');
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
      const { signedUrl, storagePath, bucket } = (await urlRes.json()) as {
        signedUrl: string;
        storagePath: string;
        bucket: string;
      };

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
      setProgressMessage('');
      setShowForm(false);
      resetForm();
      await loadList();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.');
      setStage('error');
    }
  };

  // ---------------------------------------------------------------------------
  // Reset form
  // ---------------------------------------------------------------------------
  function resetForm() {
    setPdfFile(null);
    setPdfError(null);
    setEmphasisText('');
    setStage('idle');
    setUploadProgress(0);
    setProgressMessage('');
    setErrorMessage('');
  }

  function handleCloseForm() {
    resetForm();
    setShowForm(false);
  }

  const isProcessing =
    stage === 'getting-url' ||
    stage === 'uploading-pdf' ||
    stage === 'extracting' ||
    stage === 'saving-images';

  const canSubmit = !!pdfFile && !isProcessing;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ maxWidth: '760px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
            건강검진 리포트
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
            PDF를 제출하면 1영업일 내에 검토 링크를 보내드립니다.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{
              padding: '9px 16px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + 새 분석 요청
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* NEW REQUEST FORM (collapsible)                                       */}
      {/* ------------------------------------------------------------------ */}
      {showForm && (
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            marginBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
              새 건강검진 분석 요청
            </h2>
            <button
              onClick={handleCloseForm}
              disabled={isProcessing}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '18px',
                cursor: 'pointer',
                padding: '0 4px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          {/* Error */}
          {stage === 'error' && (
            <div style={{ background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '12px 14px', fontSize: '13px', color: 'var(--text)' }}>
              <span style={{ fontWeight: 700, color: 'var(--danger)', marginRight: '8px' }}>오류</span>
              {errorMessage}
            </div>
          )}

          {/* Chart type */}
          <FormField label="차트 종류" required>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value as ChartType)}
              disabled={isProcessing}
              style={selectStyle}
            >
              {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((k) => (
                <option key={k} value={k}>{CHART_TYPE_LABELS[k]}</option>
              ))}
            </select>
          </FormField>

          {/* PDF upload */}
          <FormField label="차트 PDF 업로드" required>
            <div
              onDrop={onPdfDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => !isProcessing && pdfInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--accent)' : pdfError ? 'var(--danger)' : 'var(--border-strong)'}`,
                borderRadius: 'var(--radius)',
                padding: '24px 16px',
                textAlign: 'center',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
              }}
            >
              <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); }} />
              {pdfFile ? (
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '2px' }}>{pdfFile.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatBytes(pdfFile.size)}</div>
                  {!isProcessing && <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '4px' }}>클릭하여 다시 선택</div>}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '22px', marginBottom: '6px', color: 'var(--text-muted)' }}>📄</div>
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '2px' }}>PDF를 여기에 끌어다 놓거나 클릭하여 선택</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>.pdf 형식, 최대 30MB</div>
                </div>
              )}
            </div>
            {pdfError && <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--danger)' }}>{pdfError}</div>}

            {/* Progress */}
            {(stage === 'uploading-pdf' || stage === 'getting-url') && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ height: '5px', background: 'var(--bg-raised)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--accent)', transition: 'width 0.2s' }} />
                </div>
                <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>{progressMessage}</div>
              </div>
            )}
          </FormField>

          {/* Emphasis */}
          <FormField label="강조사항" hint="선택사항">
            <textarea
              value={emphasisText}
              onChange={(e) => setEmphasisText(e.target.value)}
              disabled={isProcessing}
              rows={3}
              placeholder="보호자에게 강조할 사항이나 특이사항을 입력하세요"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            />
          </FormField>

          {/* Extracting progress */}
          {stage === 'extracting' && (
            <div style={{ background: 'var(--accent-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Spinner />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)' }}>분석 진행 중</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{progressMessage} (30초~2분 소요)</div>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              width: '100%',
              padding: '11px 20px',
              background: canSubmit ? 'var(--accent)' : 'var(--bg-raised)',
              color: canSubmit ? '#fff' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {isProcessing ? <><Spinner />분석 요청 중…</> : '분석 요청 제출'}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* REQUEST LIST                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>요청 목록</span>
          <button
            onClick={() => void loadList()}
            style={{ background: 'none', border: 'none', fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px' }}
          >
            새로고침
          </button>
        </div>

        {listLoading ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>불러오는 중…</div>
        ) : listError ? (
          <div style={{ padding: '24px 20px', fontSize: '13px', color: 'var(--danger)' }}>{listError}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>📋</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>아직 요청이 없습니다</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>우측 상단의 "새 분석 요청" 버튼을 눌러 시작하세요.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle)' }}>
                {['요청일', '환자명', '보호자명', '상태 / 검토 링크'].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {formatDate(item.createdAt)}
                    {item.friendlyId && (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>#{item.friendlyId}</div>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text)' }}>{item.patientName ?? '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text)' }}>{item.ownerName ?? '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {item.shareUrl ? (
                      <a
                        href={item.shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '5px 12px',
                          background: 'var(--accent)',
                          color: '#fff',
                          borderRadius: 'var(--radius)',
                          fontSize: '12px',
                          fontWeight: 600,
                          textDecoration: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        검토 링크 열기 →
                      </a>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--warning, #f59e0b)', flexShrink: 0 }} />
                        검토 중 · 1영업일 내 링크 제공
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
  );
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function FormField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '7px' }}>
        <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: '3px' }}>*</span>}
        </label>
        {hint && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '14px',
  appearance: 'none',
  backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%236b7280\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: '32px',
  cursor: 'pointer',
};

function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: '13px', height: '13px', border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
