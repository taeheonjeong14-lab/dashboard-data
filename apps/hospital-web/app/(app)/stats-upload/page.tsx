'use client';

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';

type ChartType = 'intovet' | 'woorien_pms' | 'efriends';

type UploadStage = 'idle' | 'uploading' | 'done' | 'error';

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  intovet: 'IntoVet EMR',
  woorien_pms: '우리엔 PMS',
  efriends: 'eFriends EMR',
};

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UploadResult = {
  rowCount: number;
  dateFrom: string | null;
  dateTo: string | null;
};

export default function StatsUploadPage() {
  const [chartType, setChartType] = useState<ChartType>('intovet');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setFileError(null);
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls'].includes(ext ?? '')) {
      setFileError('엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.');
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError(`파일 크기는 20MB 이하여야 합니다. (현재: ${formatBytes(f.size)})`);
      return;
    }
    setFile(f);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

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
      const fd = new FormData();
      fd.set('file', file);
      fd.set('chartType', chartType);

      const res = await fetch('/api/stats-upload', { method: 'POST', body: fd });
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
    <div style={{ maxWidth: '620px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 헤더 */}
      <div>
        <h1 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
          경영통계 제출
        </h1>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
          차트 시스템에서 내보낸 엑셀 파일을 업로드하면 자동으로 처리됩니다.
        </p>
      </div>

      {/* 완료 상태 */}
      {stage === 'done' && result && (
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              background: 'var(--success-subtle)',
              borderBottom: '1px solid var(--border)',
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '20px' }}>✓</span>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--success)' }}>
              업로드 완료
            </div>
          </div>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '24px' }}>
              <Stat label="처리된 행 수" value={`${result.rowCount.toLocaleString()}건`} />
              {result.dateFrom && result.dateTo && (
                <Stat label="데이터 기간" value={`${result.dateFrom} ~ ${result.dateTo}`} />
              )}
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', background: 'var(--bg-subtle)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>
              관리자에서 전체 결과 확인 가능합니다.
            </p>
            <button
              onClick={handleReset}
              style={{
                alignSelf: 'flex-start',
                padding: '9px 18px',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius)',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              새 파일 제출
            </button>
          </div>
        </div>
      )}

      {/* 오류 배너 */}
      {stage === 'error' && (
        <div
          style={{
            background: 'var(--danger-subtle)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius)',
            padding: '14px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <span style={{ color: 'var(--danger)', fontWeight: 700, flexShrink: 0 }}>오류</span>
          <div style={{ flex: 1, fontSize: '13px', color: 'var(--text)' }}>{errorMessage}</div>
          <button
            onClick={() => setStage('idle')}
            style={{
              background: 'none',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              borderRadius: 'var(--radius)',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 폼 */}
      {stage !== 'done' && (
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
          }}
        >
          {/* 차트 종류 */}
          <FormField label="차트 종류" required>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value as ChartType)}
              disabled={isProcessing}
              style={selectStyle}
            >
              {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((k) => (
                <option key={k} value={k}>
                  {CHART_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </FormField>

          {/* 파일 업로드 */}
          <FormField label="엑셀 파일 업로드" required>
            <div
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => !isProcessing && inputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--accent)' : fileError ? 'var(--danger)' : 'var(--border-strong)'}`,
                borderRadius: 'var(--radius)',
                padding: '28px 20px',
                textAlign: 'center',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                style={{ display: 'none' }}
                onChange={onInputChange}
              />
              {file ? (
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
                    {file.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatBytes(file.size)}</div>
                  {!isProcessing && (
                    <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '6px' }}>
                      클릭하여 다시 선택
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '24px', marginBottom: '8px', color: 'var(--text-muted)' }}>📊</div>
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    엑셀 파일을 여기에 끌어다 놓거나 클릭하여 선택
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>.xlsx, .xls 형식, 최대 20MB</div>
                </div>
              )}
            </div>
            {fileError && (
              <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--danger)' }}>{fileError}</div>
            )}
          </FormField>

          {/* 제출 */}
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            style={{
              width: '100%',
              padding: '12px 20px',
              background: canSubmit ? 'var(--accent)' : 'var(--bg-raised)',
              color: canSubmit ? '#fff' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: '15px',
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 0.15s',
            }}
          >
            {isProcessing ? (
              <>
                <Spinner />
                처리 중…
              </>
            ) : (
              '제출'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '8px' }}>
        <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: '3px' }}>*</span>}
        </label>
        {hint && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-subtle)', borderRadius: 'var(--radius)', padding: '10px 14px', minWidth: 120 }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
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
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%236b7280\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: '32px',
  cursor: 'pointer',
};

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '14px',
        height: '14px',
        border: '2px solid rgba(255,255,255,0.35)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
