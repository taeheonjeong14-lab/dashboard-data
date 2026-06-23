'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, X } from 'lucide-react';
import {
  buildPreview,
  collapseRowsForDedupeUpload,
  fileToSha256,
  parseIntoVetWorkbook,
  parseWoorienPmsWorkbook,
  parseEFriendsFile,
} from '@dashboard/chart-ingest';
import { formatSupabaseError } from '@/lib/format-supabase-error';
import type { ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';

const CHART_TYPES = [
  { value: 'intovet', label: '인투벳' },
  { value: 'woorien_pms', label: '우리엔PMS' },
  { value: 'efriends', label: '이프렌즈' },
];
const AMOUNT_COLUMNS = ['BS', 'CB', 'CC'];
const ACCEPT = '.xls,.xlsx,.csv';

type Snapshot = { name: string; size: number; bytes: ArrayBuffer };

export default function AdminStatsUpload({
  hospitals,
  hospitalsLoading,
  hospitalsError,
}: {
  hospitals: ChartHospitalOption[];
  hospitalsLoading: boolean;
  hospitalsError: string | null;
}) {
  const [hospitalId, setHospitalId] = useState('');
  const [chartType, setChartType] = useState('intovet');
  const [amountColumn, setAmountColumn] = useState('BS');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [preview, setPreview] = useState<
    (ReturnType<typeof buildPreview> & { estimatedDbRowsAfterDedupe?: number }) | null
  >(null);
  const [previewRows, setPreviewRows] = useState<unknown[]>([]);
  const [previewErrors, setPreviewErrors] = useState<unknown[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isIntovet = chartType === 'intovet';

  function resetDownstream() {
    setPreview(null);
    setPreviewRows([]);
    setPreviewErrors([]);
    setResult(null);
    setMessage(null);
    setIsError(false);
  }

  async function takeFile(file: File | undefined | null) {
    resetDownstream();
    if (!file) {
      setSnapshot(null);
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      setSnapshot({ name: file.name, size: file.size, bytes });
    } catch (err) {
      setSnapshot(null);
      setIsError(true);
      setMessage(`파일을 읽지 못했습니다: ${formatSupabaseError(err)}`);
    }
  }

  async function onPreview() {
    if (!hospitalId) return fail('업로드할 병원을 먼저 선택해 주세요.');
    if (!chartType) return fail('차트 종류를 먼저 선택해 주세요.');
    if (!snapshot) return fail('업로드 파일을 선택해 주세요.');
    setLoading(true);
    setMessage(null);
    setIsError(false);
    setResult(null);
    try {
      let parsed;
      if (chartType === 'intovet') {
        parsed = await parseIntoVetWorkbook(snapshot.bytes, hospitalId, { amountColumn });
      } else if (chartType === 'woorien_pms') {
        parsed = await parseWoorienPmsWorkbook(snapshot.bytes, hospitalId);
      } else if (chartType === 'efriends') {
        parsed = await parseEFriendsFile(snapshot, hospitalId);
      } else {
        throw new Error(`아직 지원하지 않는 차트 종류입니다: ${chartType}`);
      }
      const collapsed = collapseRowsForDedupeUpload(parsed.chartType || chartType, parsed.rows);
      const p = buildPreview(parsed.rows, parsed.errors);
      setPreview({ ...p, estimatedDbRowsAfterDedupe: collapsed.length });
      setPreviewRows(parsed.rows);
      setPreviewErrors(parsed.errors);
    } catch (e) {
      fail(`미리보기 실패: ${formatSupabaseError(e)}`);
      setPreview(null);
      setPreviewRows([]);
      setPreviewErrors([]);
    } finally {
      setLoading(false);
    }
  }

  async function onConfirm() {
    if (!hospitalId || !chartType || !snapshot) return;
    if (!previewRows.length && !previewErrors.length) return fail('먼저 미리보기를 실행해 주세요.');
    setLoading(true);
    setMessage(null);
    setIsError(false);
    try {
      const fileHash = await fileToSha256(snapshot.bytes);
      const res = await fetch('/api/admin/data/chart-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalId,
          chartType,
          sourceFileName: snapshot.name,
          sourceFileHash: fileHash,
          parsedRows: previewRows,
          parseErrors: previewErrors,
        }),
      });
      const data = (await res.json()) as Record<string, unknown> & { error?: string };
      if (!res.ok) throw new Error(data.error || '업로드 실패');
      setResult(data);
      setMessage('업로드가 완료되었습니다.');
      setIsError(false);
      setPreview(null);
      setPreviewRows([]);
      setPreviewErrors([]);
      setSnapshot(null);
    } catch (e) {
      fail(`업로드 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function fail(msg: string) {
    setIsError(true);
    setMessage(msg);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {/* 4개 입력 */}
      <div style={fieldGrid}>
        <Field label="병원">
          {hospitalsLoading ? (
            <p style={hint}>불러오는 중…</p>
          ) : hospitalsError ? (
            <p style={{ ...hint, color: 'var(--danger)' }}>{hospitalsError}</p>
          ) : (
            <select value={hospitalId} onChange={(e) => { setHospitalId(e.target.value); resetDownstream(); }} disabled={loading} style={selectStyle}>
              <option value="">병원을 선택하세요</option>
              {hospitals.map((h) => (
                <option key={h.id} value={h.id}>{h.name_ko}</option>
              ))}
            </select>
          )}
        </Field>

        <Field label="차트 종류">
          <select
            value={chartType}
            onChange={(e) => { setChartType(e.target.value); resetDownstream(); }}
            disabled={loading}
            style={selectStyle}
          >
            {CHART_TYPES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>

        {isIntovet && (
          <Field label="금액 컬럼" hint="인투벳 전용">
            <select
              value={amountColumn}
              onChange={(e) => { setAmountColumn(e.target.value); resetDownstream(); }}
              disabled={loading}
              style={selectStyle}
            >
              {AMOUNT_COLUMNS.map((col) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {/* 파일 드래그앤드롭 */}
      <div style={{ marginTop: 16 }}>
        <div style={fieldLabel}>업로드 파일</div>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            void takeFile(e.dataTransfer.files?.[0]);
          }}
          style={{
            ...dropzone,
            border: `1.5px dashed ${isDragOver ? 'var(--accent)' : snapshot ? 'var(--success)' : 'var(--border-strong)'}`,
            background: isDragOver ? 'var(--accent-subtle)' : snapshot ? 'var(--success-subtle)' : 'var(--bg-subtle)',
          }}
        >
          {snapshot ? (
            <>
              <FileSpreadsheet size={30} style={{ color: 'var(--success)' }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--success)' }}>{snapshot.name}</p>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  {(snapshot.size / 1024).toFixed(0)} KB · 클릭 또는 드래그해서 다시 선택
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void takeFile(null); }}
                style={clearFileBtn}
              >
                <X size={13} /> 파일 제거
              </button>
            </>
          ) : (
            <>
              <Upload size={30} style={{ color: isDragOver ? 'var(--accent)' : 'var(--text-muted)' }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  엑셀 파일을 드래그하거나 클릭해서 선택
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                  XLSX · XLS · CSV
                </p>
              </div>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      {/* 액션 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" className="adminLegacySecondaryBtn" onClick={() => void onPreview()} disabled={loading || !snapshot || !hospitalId}>
          미리보기
        </button>
        <button
          type="button"
          className="adminLegacyPrimaryBtn"
          onClick={() => void onConfirm()}
          disabled={loading || (!previewRows.length && !previewErrors.length)}
        >
          업로드 확정
        </button>
      </div>

      {/* 상태 메시지 */}
      {message && (
        <p style={{ margin: '12px 0 0', fontSize: 13, fontWeight: 600, color: isError ? 'var(--danger)' : 'var(--success)' }}>
          {loading ? '처리 중…' : message}
        </p>
      )}

      {/* 미리보기 요약 */}
      {preview && (
        <div style={summaryCard}>
          <div style={summaryRow}><span>기간</span><strong>{preview.startDate || '-'} ~ {preview.endDate || '-'}</strong></div>
          <div style={summaryRow}><span>정상 행</span><strong>{preview.totalRows.toLocaleString()}행</strong></div>
          {preview.errorRows > 0 && <div style={summaryRow}><span style={{ color: 'var(--danger)' }}>오류 행</span><strong style={{ color: 'var(--danger)' }}>{preview.errorRows.toLocaleString()}행</strong></div>}
          <div style={summaryRow}><span>예상 매출 합계</span><strong>{preview.estimatedSalesAmount.toLocaleString()}원</strong></div>
          <div style={summaryRow}><span>예상 진료건수</span><strong>{preview.uniqueVisitCount.toLocaleString()}건</strong></div>
        </div>
      )}

      {/* 업로드 결과 요약 */}
      {result && (
        <div style={{ ...summaryCard, borderColor: 'rgba(22,163,74,0.3)', background: 'var(--success-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, fontWeight: 700, color: 'var(--success)' }}>
            <CheckCircle2 size={15} /> 업로드 완료
          </div>
          <div style={summaryRow}><span>적재 행</span><strong>{String(result.importedRows ?? '-')}</strong></div>
          <div style={summaryRow}><span>오류 행</span><strong>{String(result.errorRows ?? '-')}</strong></div>
          <div style={summaryRow}><span>영향 일자</span><strong>{String(result.affectedDays ?? '-')}</strong></div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint: h, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <div style={fieldLabel}>
        {label}
        {h && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 5 }}>{h}</span>}
      </div>
      {children}
    </div>
  );
}

const fieldGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};
const fieldLabel: CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' };
const hint: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
const selectStyle: CSSProperties = {
  width: '100%',
  padding: '9px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 13.5,
  cursor: 'pointer',
};
const dropzone: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  minHeight: 180,
  borderRadius: 'var(--radius-lg, 12px)',
  padding: '28px 20px',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'border-color 0.15s, background 0.15s',
};
const clearFileBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  background: 'var(--bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius)',
  padding: '4px 10px',
  cursor: 'pointer',
};
const summaryCard: CSSProperties = {
  marginTop: 16,
  display: 'grid',
  gap: 6,
  padding: '14px 16px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  fontSize: 13,
  color: 'var(--text-secondary)',
};
const summaryRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 };
