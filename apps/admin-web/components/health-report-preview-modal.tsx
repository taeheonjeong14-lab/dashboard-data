'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HealthReportPreviewPages,
  type HealthReportPreviewModelJson,
} from '@/components/health-report-preview-pages';
import type { HealthCheckupGeneratedContent } from '@/lib/health-report-admin/types';

type PreviewResponse = {
  runId?: string;
  updatedAt?: string;
  model?: HealthReportPreviewModelJson;
  error?: string;
  detail?: string;
  chartApiBase?: string;
  chartApiFetchBase?: string;
  chartApiPath?: string;
  hint?: string;
};

// chart-api가 (옛 코드 등으로) diseaseOptions를 떨궈도 admin 미리보기는 draft를 직접 들고 있으므로,
// draft의 장기 diseaseOptions를 model 블록에 titleKo 기준으로 덧입혀 박스가 항상 반영되게 한다.
function overlayDiseaseFromDraft(
  model: HealthReportPreviewModelJson,
  draft: HealthCheckupGeneratedContent | null | undefined,
): HealthReportPreviewModelJson {
  if (!draft) return model;
  const apply = (modelBlocks: unknown[], draftBlocks: unknown): unknown[] => {
    if (!Array.isArray(modelBlocks)) return modelBlocks;
    if (modelBlocks.some((b) => (b as { variant?: string })?.variant === 'diseaseInfo')) return modelBlocks;
    const dArr = Array.isArray(draftBlocks) ? draftBlocks : [];
    return modelBlocks.map((b) => {
      const o = b as { variant?: string; titleKo?: string };
      if (o?.variant !== 'rows') return b;
      const src = dArr.find((x) => {
        const xo = x as { variant?: string; titleKo?: string };
        return xo?.variant === 'rows' && xo.titleKo === o.titleKo;
      }) as { diseaseOptions?: unknown } | undefined;
      if (src && Array.isArray(src.diseaseOptions)) return { ...o, diseaseOptions: src.diseaseOptions };
      return b;
    });
  };
  return {
    ...model,
    systemsPage3Blocks: apply(model.systemsPage3Blocks, (draft as Record<string, unknown>).systemsPage3Blocks),
    systemsPage3bBlocks: apply(model.systemsPage3bBlocks, (draft as Record<string, unknown>).systemsPage3bBlocks),
    systemsPage4Blocks: apply(model.systemsPage4Blocks, (draft as Record<string, unknown>).systemsPage4Blocks),
  };
}

export function HealthReportPreviewModal({
  open,
  onClose,
  runId,
  generatedPayload,
}: {
  open: boolean;
  onClose: () => void;
  runId: string;
  /** 있으면 chart-api가 DB 대신 이 draft로 미리보기(저장 전 편집 반영). */
  generatedPayload?: HealthCheckupGeneratedContent | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<HealthReportPreviewModelJson | null>(null);

  const payloadRef = useRef(generatedPayload);
  payloadRef.current = generatedPayload;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setModel(null);
    try {
      const body: Record<string, unknown> = { runId };
      const p = payloadRef.current;
      if (p != null) {
        body.generatedPayload = p;
      }
      const res = await fetch('/api/admin/health-report/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const rawText = await res.text();
      let data: PreviewResponse;
      try {
        data = JSON.parse(rawText) as PreviewResponse;
      } catch {
        throw new Error(`미리보기 응답 파싱 실패 (HTTP ${res.status}): ${rawText.slice(0, 280)}`);
      }
      if (!res.ok) {
        const extra = [
          data.hint?.trim(),
          data.detail?.trim(),
          data.chartApiBase ? `설정 CHART_API_BASE_URL: ${data.chartApiBase}` : '',
          data.chartApiFetchBase && data.chartApiFetchBase !== data.chartApiBase
            ? `서버 연결 시도: ${data.chartApiFetchBase}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');
        throw new Error([data.error ?? `HTTP ${res.status}`, extra].filter(Boolean).join('\n'));
      }
      if (!data.model) throw new Error(data.error ?? 'model 없음');
      setModel(overlayDiseaseFromDraft(data.model, payloadRef.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : '미리보기 실패');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, runId, load]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="건강검진 보고서 미리보기"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10040,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: '24px 12px',
        overflow: 'auto',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 'min(920px, 100%)',
          maxWidth: '100%',
          background: '#fff',
          borderRadius: 10,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(96vh, 1200px)',
        }}
      >
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid rgba(15, 23, 42, 0.12)',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>미리보기</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="adminLegacySmallBtn" disabled={loading} onClick={() => void load()}>
              새로고침
            </button>
            <button type="button" className="adminLegacySecondaryBtn" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
        <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '0 8px 16px' }}>
          {loading ? (
            <p style={{ padding: 24, color: '#64748b', fontSize: 14 }}>불러오는 중…</p>
          ) : error ? (
            <p style={{ padding: 24, color: '#b91c1c', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</p>
          ) : model ? (
            <HealthReportPreviewPages model={model} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
