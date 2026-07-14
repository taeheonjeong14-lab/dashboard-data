'use client';

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent, type CSSProperties } from 'react';
import { createClient } from '@/lib/supabase/client';

type ChartType = 'intovet' | 'woorien_pms' | 'efriends';
type UploadStage = 'idle' | 'uploading' | 'done' | 'error';

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  intovet: '인투벳',
  woorien_pms: '우리엔PMS',
  efriends: '이프렌즈',
};

const VALID_CHART_TYPES: ChartType[] = ['intovet', 'woorien_pms', 'efriends'];

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UploadResult = { rowCount: number; dateFrom: string | null; dateTo: string | null };

export function StatsUploadButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ padding: '8px 16px', border: 'none', borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
      >
        경영통계 제출
      </button>
      {open && <StatsUploadModal onClose={() => setOpen(false)} />}
    </>
  );
}

function StatsUploadModal({ onClose }: { onClose: () => void }) {
  const [chartType, setChartType] = useState<ChartType>('intovet');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 병원 설정의 기본 차트 종류 (있으면 그걸로 처리, 없으면 선택 UI 노출)
  const [hospitalChartType, setHospitalChartType] = useState<ChartType | null>(null);
  const [showChartSelect, setShowChartSelect] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/hospital');
        const data = (await res.json()) as { hospital?: { chartType?: string } | null };
        const ct = data.hospital?.chartType;
        if (cancelled) return;
        if (ct && VALID_CHART_TYPES.includes(ct as ChartType)) {
          setHospitalChartType(ct as ChartType);
          setChartType(ct as ChartType);
          setShowChartSelect(false);
        } else {
          // 설정된 차트 종류가 없으면 선택 UI 를 바로 보여줌
          setShowChartSelect(true);
        }
      } catch {
        if (!cancelled) setShowChartSelect(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = useCallback((f: File) => {
    setFileError(null);
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
      setFileError('엑셀(.xlsx, .xls) 또는 CSV(.csv) 파일만 업로드할 수 있습니다.');
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError(`파일 크기는 20MB 이하여야 합니다. (현재: ${formatBytes(f.size)})`);
      return;
    }
    setFile(f);
  }, []);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setStage('uploading');
    setErrorMessage('');
    setResult(null);
    try {
      // 1) 서명 업로드 URL 발급
      const signRes = await fetch('/api/stats-upload/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      });
      const sign = (await signRes.json()) as { bucket?: string; path?: string; token?: string; error?: string };
      if (!signRes.ok || !sign.bucket || !sign.path || !sign.token) {
        throw new Error(sign.error ?? '업로드 준비에 실패했습니다.');
      }

      // 2) 파일을 Storage 에 직접 업로드 (Vercel 함수 본문 한도 우회)
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from(sign.bucket)
        .uploadToSignedUrl(sign.path, sign.token, file);
      if (upErr) throw new Error(`파일 업로드 실패: ${upErr.message}`);

      // 3) 서버에 경로만 전달해 파싱·저장 요청
      const res = await fetch('/api/stats-upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storagePath: sign.path, chartType, fileName: file.name }),
      });
      const data = (await res.json()) as { ok?: boolean; rowCount?: number; dateFrom?: string | null; dateTo?: string | null; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '업로드에 실패했습니다.');
      setResult({ rowCount: data.rowCount ?? 0, dateFrom: data.dateFrom ?? null, dateTo: data.dateTo ?? null });
      setStage('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.');
      setStage('error');
    }
  };

  const handleReset = () => {
    setFile(null);
    setFileError(null);
    setStage('idle');
    setErrorMessage('');
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const isProcessing = stage === 'uploading';
  const canSubmit = !!file && !isProcessing && stage !== 'done';

  return (
    <div
      onClick={() => !isProcessing && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>경영통계 제출</h2>
          <button type="button" onClick={() => !isProcessing && onClose()} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-secondary)' }}>
          차트 시스템에서 내보낸 엑셀 또는 CSV 파일을 업로드하면 자동으로 처리됩니다.
        </p>

        {/* 완료 상태 */}
        {stage === 'done' && result && (
          <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ background: 'var(--success-subtle)', borderBottom: '1px solid var(--border)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>✓</span>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--success)' }}>업로드 완료</div>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <Stat label="처리된 행 수" value={`${result.rowCount.toLocaleString()}건`} />
                {result.dateFrom && result.dateTo && (
                  <Stat label="데이터 기간" value={`${result.dateFrom} ~ ${result.dateTo}`} />
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => window.location.reload()}
                  style={{ padding: '9px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  완료
                </button>
                <button onClick={handleReset}
                  style={{ padding: '9px 18px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  새 파일 제출
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 오류 배너 */}
        {stage === 'error' && (
          <div style={{ background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ color: 'var(--danger)', fontWeight: 700, flexShrink: 0 }}>오류</span>
            <div style={{ flex: 1, fontSize: 14, color: 'var(--text)' }}>{errorMessage}</div>
            <button onClick={() => setStage('idle')}
              style={{ background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 'var(--radius)', padding: '4px 10px', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>
              다시 시도
            </button>
          </div>
        )}

        {/* 폼 */}
        {stage !== 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {showChartSelect ? (
              <FormField label="차트 종류" required>
                <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} disabled={isProcessing} style={selectStyle}>
                  {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((k) => (
                    <option key={k} value={k}>{CHART_TYPE_LABELS[k]}</option>
                  ))}
                </select>
              </FormField>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
                  현재 <b style={{ color: 'var(--text)' }}>{CHART_TYPE_LABELS[hospitalChartType ?? chartType]}</b> 차트 기준으로 처리됩니다.
                </p>
                <button
                  type="button"
                  onClick={() => setShowChartSelect(true)}
                  style={{
                    alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0,
                    fontSize: 14, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline',
                  }}
                >
                  혹시 다른 차트 시스템 데이터인가요?
                </button>
              </div>
            )}

            <FormField label="파일 업로드" required>
              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => !isProcessing && inputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? 'var(--accent)' : fileError ? 'var(--danger)' : 'var(--border-strong)'}`,
                  borderRadius: 'var(--radius)', padding: '28px 20px', textAlign: 'center',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                  background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <input ref={inputRef} type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  style={{ display: 'none' }} onChange={onInputChange} />
                {file ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{file.name}</div>
                    <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{formatBytes(file.size)}</div>
                    {!isProcessing && <div style={{ fontSize: 14, color: 'var(--accent)', marginTop: 6 }}>클릭하여 다시 선택</div>}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 8, color: 'var(--text-muted)' }}>📊</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>엑셀 또는 CSV 파일을 여기에 끌어다 놓거나 클릭하여 선택</div>
                    <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>.xlsx, .xls, .csv 형식, 최대 20MB</div>
                  </div>
                )}
              </div>
              {fileError && <div style={{ marginTop: 6, fontSize: 14, color: 'var(--danger)' }}>{fileError}</div>}
            </FormField>

            <button onClick={() => void handleSubmit()} disabled={!canSubmit}
              style={{
                width: '100%', padding: '12px 20px',
                background: canSubmit ? 'var(--accent)' : 'var(--bg-raised)',
                color: canSubmit ? '#fff' : 'var(--text-muted)',
                border: 'none', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              {isProcessing ? (<><Spinner />처리 중…</>) : '제출'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FormField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
        </label>
        {hint && <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-subtle)', borderRadius: 'var(--radius)', padding: '10px 14px', minWidth: 120 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

const selectStyle: CSSProperties = {
  width: '100%', padding: '9px 2px', border: 'none', borderBottom: '1px solid var(--border-strong)', borderRadius: 0,
  background: 'transparent', color: 'var(--text)', fontSize: 14, appearance: 'none',
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%236b7280\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 32, cursor: 'pointer',
};

function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
