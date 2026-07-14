'use client';

import { useEffect, useState } from 'react';

type StepResult = { ok: boolean; detail: string; data?: Record<string, unknown> };
type DiagResult = { ok: boolean; steps: Record<string, StepResult> };

type LastRunResult = {
  run: { id: string; createdAt: string; friendlyId: string | null; status: string; errorMessage: string | null } | null;
  dbCounts?: { chartByDate: number; labItems: number; vaccination: number; vitals: number };
  basicInfo?: Record<string, unknown> | null;
  payloadSummary?: {
    chartBodyByDateCount: number | string;
    labItemsByDateCount: number | string;
    bucketSizes: Record<string, number> | null;
    llmLineCount: number | null;
    ocrRowCount: number | null;
    effectivePdfLineCount: number | null;
    effectiveHead: string[] | null;
  } | null;
  error?: string;
};

const STEP_LABELS: Record<string, string> = {
  '1_env_vars': '1. 환경변수',
  '2_supabase_storage': '2. Supabase Storage',
  '3_postgres_db': '3. PostgreSQL DB',
  '4_chart_api_connectivity': '4. chart-api 연결',
  '5_chart_api_text_bucketing': '5. chart-api 인증',
  '6_supabase_parse_runs': '6. parse_runs 조회',
};

export default function DebugPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<LastRunResult | null>(null);
  const [lastRunLoading, setLastRunLoading] = useState(false);

  async function runDiag() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/debug/chart-pipeline', { credentials: 'include' });
      setResult(await res.json() as DiagResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  }

  async function loadLastRun() {
    setLastRunLoading(true);
    try {
      const res = await fetch('/api/admin/debug/last-run', { credentials: 'include' });
      setLastRun(await res.json() as LastRunResult);
    } catch (e) {
      setLastRun({ run: null, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLastRunLoading(false);
    }
  }

  useEffect(() => {
    void runDiag();
    void loadLastRun();
  }, []);

  const ps = lastRun?.payloadSummary;
  const llmCount = ps?.llmLineCount;
  const effectiveCount = ps?.effectivePdfLineCount;
  const buckets = ps?.bucketSizes;
  const dbCounts = lastRun?.dbCounts;

  // 진단 메시지 자동 추론
  let diagnosis = '';
  if (lastRun?.run && ps !== undefined) {
    if (llmCount === 0 && (effectiveCount ?? 0) === 0) {
      diagnosis = '❌ LLM이 PDF에서 텍스트를 전혀 추출하지 못했습니다. 이미지 기반(스캔) PDF이거나 LLM API 응답이 비어있을 수 있습니다.';
    } else if (llmCount === 0 && (effectiveCount ?? 0) > 0) {
      diagnosis = '⚠️ LLM 추출은 0줄이지만 OCR이 보완했습니다. OCR 텍스트만으로 버케팅이 작동하는지 확인 필요합니다.';
    } else if ((llmCount ?? 0) > 0 && (buckets?.chartBody ?? 0) === 0 && (buckets?.basicInfo ?? 0) === 0) {
      diagnosis = '⚠️ LLM이 텍스트를 읽었지만 버케팅 규칙이 아무 줄도 분류하지 못했습니다. 차트 형식이 규칙과 맞지 않을 수 있습니다.';
    } else if ((llmCount ?? 0) > 0 && ((dbCounts?.chartByDate ?? 0) > 0 || (dbCounts?.labItems ?? 0) > 0)) {
      diagnosis = '✅ 추출·저장이 정상으로 보입니다.';
    } else if (llmCount === null) {
      diagnosis = 'ℹ️ LLM 줄 수 정보가 없습니다. raw_payload에 _debug 정보가 없는 버전의 chart-api입니다.';
    }
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, fontFamily: 'monospace' }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px', fontFamily: 'sans-serif' }}>
        차트 파이프라인 진단
      </h1>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px', fontFamily: 'sans-serif' }}>
        환경변수·DB·chart-api 연결 상태와 마지막 추출 결과를 확인합니다.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => void runDiag()} disabled={loading}
          style={{ padding: '8px 18px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'sans-serif' }}>
          {loading ? '진단 중…' : '인프라 재진단'}
        </button>
        <button onClick={() => void loadLastRun()} disabled={lastRunLoading}
          style={{ padding: '8px 18px', background: '#334155', color: '#fff', border: 'none', borderRadius: 6, cursor: lastRunLoading ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'sans-serif' }}>
          {lastRunLoading ? '불러오는 중…' : '마지막 추출 새로고침'}
        </button>
        <a href="/admin/debug/buckets"
          style={{ padding: '8px 18px', background: '#fff', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: 6, fontSize: 13, fontFamily: 'sans-serif', textDecoration: 'none', fontWeight: 600 }}>
          버킷 상세 디버그 →
        </a>
      </div>

      {/* 마지막 추출 결과 */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 10px', fontFamily: 'sans-serif' }}>
          마지막 PDF 추출 결과
        </h2>
        {lastRunLoading ? (
          <p style={{ fontSize: 13, color: '#64748b', fontFamily: 'sans-serif' }}>불러오는 중…</p>
        ) : lastRun?.error ? (
          <p style={{ fontSize: 13, color: '#b91c1c', fontFamily: 'sans-serif' }}>오류: {lastRun.error}</p>
        ) : !lastRun?.run ? (
          <p style={{ fontSize: 13, color: '#94a3b8', fontFamily: 'sans-serif' }}>저장된 run이 없습니다.</p>
        ) : (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            {/* run 헤더 */}
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'sans-serif', display: 'flex', gap: 16 }}>
              <span><strong>ID:</strong> {lastRun.run.friendlyId ?? lastRun.run.id}</span>
              <span><strong>시각:</strong> {new Date(lastRun.run.createdAt).toLocaleString('ko-KR')}</span>
              <span><strong>상태:</strong> {lastRun.run.status}</span>
            </div>

            {/* 진단 메시지 */}
            {diagnosis && (
              <div style={{ padding: '10px 14px', background: diagnosis.startsWith('✅') ? '#f0fdf4' : diagnosis.startsWith('❌') ? '#fef2f2' : '#fffbeb', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'sans-serif', fontWeight: 600, color: diagnosis.startsWith('✅') ? '#15803d' : diagnosis.startsWith('❌') ? '#b91c1c' : '#92400e' }}>
                {diagnosis}
              </div>
            )}

            {/* 핵심 수치 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 1, background: '#e2e8f0' }}>
              {[
                { label: 'LLM 추출 줄', value: llmCount ?? '정보없음', warn: llmCount === 0 },
                { label: 'OCR 줄', value: ps?.ocrRowCount ?? '?' },
                { label: '유효 줄 합계', value: effectiveCount ?? '?' },
                { label: 'DB 차트행', value: dbCounts?.chartByDate ?? '?', warn: (dbCounts?.chartByDate ?? -1) === 0 },
                { label: 'DB 검사항목', value: dbCounts?.labItems ?? '?' },
                { label: '기본정보버킷', value: buckets?.basicInfo ?? '?', warn: (buckets?.basicInfo ?? -1) === 0 },
                { label: '차트본문버킷', value: buckets?.chartBody ?? '?', warn: (buckets?.chartBody ?? -1) === 0 },
                { label: '검사버킷', value: buckets?.lab ?? '?', warn: (buckets?.lab ?? -1) === 0 },
              ].map(({ label, value, warn }) => (
                <div key={label} style={{ background: '#fff', padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'sans-serif', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: warn ? '#b91c1c' : '#0f172a' }}>{String(value)}</div>
                </div>
              ))}
            </div>

            {/* 추출된 첫 줄들 */}
            {ps?.effectiveHead && ps.effectiveHead.length > 0 && (
              <div style={{ borderTop: '1px solid #e2e8f0' }}>
                <div style={{ padding: '8px 14px 4px', fontSize: 11, fontWeight: 700, color: '#64748b', fontFamily: 'sans-serif' }}>
                  추출된 첫 줄들 (LLM+OCR)
                </div>
                <pre style={{ margin: 0, padding: '0 14px 10px', fontSize: 11, lineHeight: 1.7, background: '#f8fafc', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {ps.effectiveHead.join('\n')}
                </pre>
              </div>
            )}

            {/* raw_payload에 effectiveHead 없을 때 안내 */}
            {llmCount === null && (
              <div style={{ padding: '10px 14px', fontSize: 13, color: '#64748b', fontFamily: 'sans-serif', borderTop: '1px solid #e2e8f0' }}>
                ℹ️ LLM 줄 수 정보가 없습니다. chart-api를 새 버전으로 배포하면 상세 정보가 표시됩니다.
                <br />DB에 저장된 정보 기준 — 차트행: {dbCounts?.chartByDate ?? '?'}건, 검사항목: {dbCounts?.labItems ?? '?'}건
              </div>
            )}
          </div>
        )}
      </div>

      {/* 인프라 진단 */}
      {error && <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 16, fontFamily: 'sans-serif' }}>오류: {error}</p>}
      {result && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 10px', fontFamily: 'sans-serif' }}>인프라 진단</h2>
          <div style={{ display: 'inline-block', marginBottom: 12, padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 700, fontFamily: 'sans-serif', background: result.ok ? '#f0fdf4' : '#fef2f2', color: result.ok ? '#15803d' : '#b91c1c', border: `1px solid ${result.ok ? 'rgba(22,163,74,0.3)' : 'rgba(185,28,28,0.3)'}` }}>
            {result.ok ? '✓ 모든 단계 통과' : '✗ 실패한 단계 있음'}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {Object.entries(result.steps).map(([key, step]) => (
              <div key={key} style={{ border: `1px solid ${step.ok ? '#e2e8f0' : 'rgba(185,28,28,0.35)'}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: step.ok ? '#f8fafc' : '#fef2f2' }}>
                  <span style={{ fontSize: 18 }}>{step.ok ? '✅' : '❌'}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'sans-serif', color: '#0f172a' }}>{STEP_LABELS[key] ?? key}</span>
                  <span style={{ fontSize: 13, color: step.ok ? '#15803d' : '#b91c1c', marginLeft: 'auto' }}>{step.detail}</span>
                </div>
                {step.data && (
                  <pre style={{ margin: 0, padding: '10px 14px', fontSize: 11, lineHeight: 1.7, background: '#f1f5f9', borderTop: '1px solid #e2e8f0', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {JSON.stringify(step.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
