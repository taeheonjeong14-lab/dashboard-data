'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  HEALTH_CHECKUP_DENTAL_SKIN_ROW_MAX_CHARS,
  HEALTH_CHECKUP_LAB_INTERP_MAX_CHARS,
  HEALTH_CHECKUP_MAX_COVER_CHECKUP_DATE_CHARS,
  HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS,
  HEALTH_CHECKUP_MAX_COVER_SEX_CHARS,
  HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS,
  HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_MAX_OVERALL_CHARS,
  HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS,
  HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS,
  HEALTH_CHECKUP_MIN_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_MIN_OVERALL_CHARS,
  HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS,
  HEALTH_CHECKUP_SYSTEMS_ROW_MAX_CHARS,
} from '@/lib/health-report-admin/limits';
import { mergeHealthPayloadFromStorage, emptyHealthCheckupPayload } from '@/lib/health-report-admin/payload-defaults';
import type { HealthCheckupGeneratedContent } from '@/lib/health-report-admin/types';
import { joinTimelineCardText, splitTimelineCardText } from '@/lib/health-report-admin/timeline-card';
import type { HealthSystemsReportBlock, HealthSystemsImageSlot } from '@/lib/health-report-admin/health-systems-types';
import { parseHealthSystemsBlocksFromUnknown } from '@/lib/health-report-admin/health-systems-blocks-parse';
import { AdminHealthReportImageSlots, type CaseImageCandidate } from '@/components/admin-health-report-image-slots';
import { AdminRunExtractionDetail } from '@/components/admin-run-extraction-detail';
import { HealthReportPreviewModal } from '@/components/health-report-preview-modal';

const divider = 'rgba(15, 23, 42, 0.1)';
const OVER_MAX_WARNING = ' (최대 글자수를 초과하였습니다. 현재 상태로 보고서를 다운로드할 경우 내용이 잘려 나옵니다.)';

const labelGrid: CSSProperties = { fontSize: 13, display: 'grid', gap: 4 };

const SPECIES_OPTIONS = ['Canine (개)', 'Feline (고양이)'] as const;
const SEX_OPTIONS = ['암컷(중성화)', '수컷(중성화)', '암컷', '수컷'] as const;

const SYSTEM_KEYS = [
  'systemsPage3Blocks',
  'systemsPage3bBlocks',
  'systemsPage4Blocks',
  'systemsPage5Blocks',
] as const;

type SystemKey = (typeof SYSTEM_KEYS)[number];

const SYSTEM_PAGE_LABELS: Record<SystemKey, string> = {
  systemsPage3Blocks: '장기 시트',
  systemsPage3bBlocks: '장기 시트',
  systemsPage4Blocks: '치과·피부',
  systemsPage5Blocks: '영상·초음파',
};

function rowMaxCharsForSystemKey(k: SystemKey): number {
  return k === 'systemsPage5Blocks' ? HEALTH_CHECKUP_DENTAL_SKIN_ROW_MAX_CHARS : HEALTH_CHECKUP_SYSTEMS_ROW_MAX_CHARS;
}

function getStructuredBlocksFromDraft(d: HealthCheckupGeneratedContent, k: SystemKey): HealthSystemsReportBlock[] {
  const v = d[k] as unknown;
  if (!Array.isArray(v) || v.length === 0) return [];
  return parseHealthSystemsBlocksFromUnknown(v) ?? [];
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function isImageVariant(v: string): boolean {
  return v === 'images' || v === 'images4' || v === 'imagesGrid2x3' || v === 'imagesGrid3x3';
}

function appendUnitIfNeeded(value: string, suffix: string): string {
  const t = value.trim();
  if (!t) return t;
  if (t.includes(suffix)) return t;
  if (/\d/.test(t)) return `${t}${suffix}`;
  return t;
}

type ContentItem = {
  id: string;
  contentType: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
};

export function AdminHealthCheckupWorkspace({
  runId,
  hospitalName,
  patientName,
  onRunsChanged,
}: {
  runId: string;
  hospitalName?: string;
  patientName?: string;
  onRunsChanged?: () => void;
}) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState<HealthCheckupGeneratedContent>(() => emptyHealthCheckupPayload());

  const [checkupDate, setCheckupDate] = useState('');
  const [veterinarian, setVeterinarian] = useState('');
  const [mustInclude, setMustInclude] = useState('');
  const [coverProgram, setCoverProgram] = useState('');

  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);
  const [condensingSection, setCondensingSection] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [imageCandidates, setImageCandidates] = useState<CaseImageCandidate[]>([]);
  const [candidatePathMap, setCandidatePathMap] = useState<Map<string, string>>(new Map());

  const [pdfBusy, setPdfBusy] = useState(false);
  const [sharePanel, setSharePanel] = useState<{ shareUrl: string; expiresAt: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [chartHistoryOpen, setChartHistoryOpen] = useState(false);
  const chartHistoryDialogRef = useRef<HTMLDialogElement>(null);

  const healthItem = useMemo(() => items.find((i) => i.contentType === 'health_checkup') ?? null, [items]);
  const hasContent = healthItem != null;

  const loadContent = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/health-report/content?runId=${encodeURIComponent(runId)}`, {
        credentials: 'include',
      });
      const data = (await res.json()) as { runId?: string; items?: ContentItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '불러오기 실패');
      const list = Array.isArray(data.items) ? data.items : [];
      setItems(list);
      const hc = list.find((i) => i.contentType === 'health_checkup');
      if (hc) {
        setDraft(mergeHealthPayloadFromStorage(hc.payload));
        try {
          const shareRes = await fetch('/api/admin/health-report/review-share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ runId }),
          });
          const shareData = (await shareRes.json()) as { shareUrl?: string; expiresAt?: string };
          if (shareData.shareUrl) setSharePanel({ shareUrl: shareData.shareUrl, expiresAt: shareData.expiresAt ?? '' });
        } catch {
          /* 링크 발급 실패는 조용히 무시 */
        }
      } else {
        setDraft(emptyHealthCheckupPayload());
        setSharePanel(null);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '불러오기 실패');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  useEffect(() => {
    setSharePanel(null);
    setPreviewOpen(false);
    setChartHistoryOpen(false);
  }, [runId]);

  useEffect(() => {
    const dialog = chartHistoryDialogRef.current;
    if (!dialog) return;
    if (chartHistoryOpen) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [chartHistoryOpen]);

  function setRecheckField(
    key: keyof Pick<
      HealthCheckupGeneratedContent,
      'recheckWithin1to2Weeks' | 'recheckWithin1Month' | 'recheckWithin3Months' | 'recheckWithin6Months'
    >,
    part: 'title' | 'body',
    value: string,
  ) {
    const cur = draft[key];
    const { cardTitle, cardBody } = splitTimelineCardText(typeof cur === 'string' ? cur : '');
    const nextTitle = part === 'title' ? value : cardTitle;
    const nextBody = part === 'body' ? value : cardBody;
    setDraft((d) => ({ ...d, [key]: joinTimelineCardText(nextTitle, nextBody) }));
  }

  async function saveSectionReview(sectionKey: string) {
    setSavingSection(sectionKey);
    setSaveError(null);
    try {
      const res = await fetch('/api/admin/health-report/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          runId,
          contentType: 'health_checkup',
          payload: draft,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '저장 실패');
      await loadContent();
      onRunsChanged?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingSection(null);
    }
  }

  function systemKeyToApiSection(k: SystemKey): string {
    const map: Record<SystemKey, string> = {
      systemsPage3Blocks: 'systems3',
      systemsPage3bBlocks: 'systems3b',
      systemsPage4Blocks: 'systems4',
      systemsPage5Blocks: 'systems5',
    };
    return map[k];
  }

  async function generateSection(apiSection: string, uiSectionKey: string) {
    setGeneratingSection(uiSectionKey);
    setGenError(null);
    try {
      const res = await fetch('/api/admin/health-report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          runId,
          contentType: 'health_checkup',
          section: apiSection,
          checkupDate: checkupDate.trim(),
          mustInclude: mustInclude.trim().slice(0, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS),
        }),
      });
      const data = (await res.json()) as { error?: string; generated?: Partial<HealthCheckupGeneratedContent> };
      if (!res.ok) throw new Error(data.error ?? `재생성 실패 (${res.status})`);
      if (data.generated) {
        setDraft((d) => ({ ...d, ...data.generated }));
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '재생성 실패');
    } finally {
      setGeneratingSection(null);
    }
  }

  function updateImageSlot(
    k: SystemKey,
    blockIndex: number,
    slotIndex: number,
    patch: { src?: string; caption?: string },
  ) {
    setDraft((prev) => {
      const cur = getStructuredBlocksFromDraft(prev, k);
      const nextBlocks = structuredClone(cur) as HealthSystemsReportBlock[];
      const b = nextBlocks[blockIndex];
      if (!b || b.variant === 'rows') return prev;
      const img = (b.images as HealthSystemsImageSlot[])[slotIndex];
      if (!img) return prev;
      if ('src' in patch) img.src = patch.src;
      if ('caption' in patch) img.caption = patch.caption;
      return { ...prev, [k]: nextBlocks };
    });
  }

  async function condenseSection(sectionKey: string) {
    setCondensingSection(sectionKey);
    setGenError(null);
    try {
      let items: string[] = [];

      if (sectionKey === 'overall') {
        items = [draft.overallSummary];
      } else if (sectionKey === 'followUp') {
        items = [draft.followUpCare];
      } else if (sectionKey === 'recheck') {
        const keys = ['recheckWithin1to2Weeks', 'recheckWithin1Month', 'recheckWithin3Months', 'recheckWithin6Months'] as const;
        items = keys.map((key) => {
          const { cardBody } = splitTimelineCardText(typeof draft[key] === 'string' ? draft[key] as string : '');
          return cardBody;
        });
      } else if (sectionKey === 'lab') {
        items = [draft.labInterpretation ?? ''];
      } else {
        const match = /^(systemsPage\w+)-(\d+)$/.exec(sectionKey);
        if (match) {
          const k = match[1] as SystemKey;
          const bi = parseInt(match[2], 10);
          const blocks = getStructuredBlocksFromDraft(draft, k);
          const block = blocks[bi];
          if (block?.variant === 'rows') items = block.rows.map((r) => r.content);
        }
      }

      if (items.length === 0 || items.every((i) => !i.trim())) return;

      const res = await fetch('/api/admin/health-report/condense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items }),
      });
      const data = (await res.json()) as { items?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `간결화 실패 (${res.status})`);
      if (!Array.isArray(data.items)) throw new Error('잘못된 응답 형식');

      const condensed = data.items as string[];

      if (sectionKey === 'overall') {
        setDraft((d) => ({ ...d, overallSummary: condensed[0] ?? d.overallSummary }));
      } else if (sectionKey === 'followUp') {
        setDraft((d) => ({ ...d, followUpCare: condensed[0] ?? d.followUpCare }));
      } else if (sectionKey === 'recheck') {
        const keys = ['recheckWithin1to2Weeks', 'recheckWithin1Month', 'recheckWithin3Months', 'recheckWithin6Months'] as const;
        setDraft((d) => {
          const updated = { ...d };
          keys.forEach((key, i) => {
            if (condensed[i] !== undefined) {
              const { cardTitle } = splitTimelineCardText(typeof d[key] === 'string' ? d[key] as string : '');
              updated[key] = joinTimelineCardText(cardTitle, condensed[i] ?? '');
            }
          });
          return updated;
        });
      } else if (sectionKey === 'lab') {
        setDraft((d) => ({ ...d, labInterpretation: condensed[0] ?? d.labInterpretation }));
      } else {
        const match = /^(systemsPage\w+)-(\d+)$/.exec(sectionKey);
        if (match) {
          const k = match[1] as SystemKey;
          const bi = parseInt(match[2], 10);
          setDraft((prev) => {
            const cur = getStructuredBlocksFromDraft(prev, k);
            if (!cur[bi] || cur[bi].variant !== 'rows') return prev;
            const nextBlocks = structuredClone(cur) as HealthSystemsReportBlock[];
            const b = nextBlocks[bi];
            if (b.variant !== 'rows') return prev;
            nextBlocks[bi] = { ...b, rows: b.rows.map((row, ri) => ({ ...row, content: condensed[ri] ?? row.content })) };
            return { ...prev, [k]: nextBlocks };
          });
        }
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '간결화 실패');
    } finally {
      setCondensingSection(null);
    }
  }

  async function generateContent() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/admin/health-report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          runId,
          contentType: 'health_checkup',
          checkupDate: checkupDate.trim(),
          veterinarian: veterinarian.trim(),
          mustInclude: mustInclude.trim().slice(0, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS),
          coverProgram: coverProgram.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string; generated?: unknown; saved?: unknown };
      if (!res.ok) {
        throw new Error(data.error ?? `생성 실패 (${res.status})`);
      }
      await loadContent();
      onRunsChanged?.();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '생성 실패');
    } finally {
      setGenerating(false);
    }
  }

  const overallLen = draft.overallSummary.length;
  const followLen = draft.followUpCare.length;

  const downloadPdf = useCallback(async () => {
    setPdfBusy(true);
    try {
      const res = await fetch(`/api/admin/health-report/export-pdf?runId=${encodeURIComponent(runId)}`, {
        credentials: 'include',
      });
      const ct = res.headers.get('Content-Type') ?? '';
      if (!res.ok) {
        const t = await res.text();
        let msg = `PDF 실패 (${res.status})`;
        try {
          const j = JSON.parse(t) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          if (t.trim()) msg = t.slice(0, 400);
        }
        throw new Error(msg);
      }
      if (!ct.includes('application/pdf')) {
        const t = await res.text();
        throw new Error(t.trim().slice(0, 400) || 'PDF가 아닌 응답입니다.');
      }
      const cd = res.headers.get('Content-Disposition');
      let filename = `health_checkup_${runId.slice(0, 8)}.pdf`;
      if (cd) {
        const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
        if (star) {
          try {
            filename = decodeURIComponent(star[1].trim().replace(/^"+|"+$/g, ''));
          } catch {
            /* keep default */
          }
        } else {
          const plain = /filename="([^"]+)"/i.exec(cd);
          if (plain?.[1]) filename = plain[1];
        }
      }
      const buf = await res.arrayBuffer();
      const head = new Uint8Array(buf.byteLength < 5 ? buf : buf.slice(0, 5));
      const sig = String.fromCharCode(...head);
      if (sig !== '%PDF-') {
        const preview = new TextDecoder().decode(buf.byteLength > 800 ? buf.slice(0, 800) : buf);
        throw new Error(preview.trim().slice(0, 300) || 'PDF 시그니처가 아닙니다.');
      }
      const blob = new Blob([buf], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'PDF 실패');
    } finally {
      setPdfBusy(false);
    }
  }, [runId]);


  if (loading && items.length === 0 && !loadError) {
    return <p style={{ fontSize: 14, color: '#64748b' }}>불러오는 중…</p>;
  }

  const caseInfoParts = [
    hospitalName?.trim(),
    (draft.coverPatientName?.trim() || patientName?.trim()),
    draft.coverCheckupDate?.trim() ? new Date(draft.coverCheckupDate).toLocaleDateString('ko-KR') : undefined,
  ].filter(Boolean);

  return (
    <>
      <div className="adminHealthWorkspace" style={{ paddingBottom: 32 }}>
      {caseInfoParts.length > 0 ? (
        <div style={{ marginBottom: 10, fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>
          {caseInfoParts.join(' · ')}
        </div>
      ) : null}

      <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="button" className="adminLegacySmallBtn" onClick={() => setChartHistoryOpen(true)}>
          차트 기록
        </button>
        {hasContent ? (
          <>
            <button type="button" className="adminLegacySmallBtn" disabled={generating} onClick={() => void generateContent()}>
              {generating ? '재생성 중…' : '다시 생성'}
            </button>
            <button
              type="button"
              className="adminLegacySmallBtn"
              onClick={() => setPreviewOpen(true)}
              title="chart-api 미리보기 JSON을 admin에서 모달로 표시합니다(편집 중이면 현재 초안 전달)."
            >
              미리보기
            </button>
            <button
              type="button"
              className="adminLegacySmallBtn"
              disabled={pdfBusy}
              title="응답을 모두 받을 때까지 버튼이 비활성화됩니다. Playwright PDF는 수 분 걸릴 수 있습니다."
              onClick={() => void downloadPdf()}
            >
              {pdfBusy ? 'PDF 생성 중…' : 'PDF 다운로드'}
            </button>
          </>
        ) : null}
        <code style={{ fontSize: 11, color: '#94a3b8' }}>{runId}</code>
      </div>

      {sharePanel ? (
        <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
          <span style={{ fontSize: 12, color: '#166534', fontWeight: 600, flexShrink: 0 }}>외부 검토 링크</span>
          <input readOnly value={sharePanel.shareUrl} style={{ flex: '1 1 200px', minWidth: 0, fontSize: 12 }} />
          <button
            type="button"
            className="adminLegacySmallBtn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(sharePanel.shareUrl);
              } catch {
                window.alert('복사에 실패했습니다. 입력란에서 직접 복사해 주세요.');
              }
            }}
          >
            복사
          </button>
        </div>
      ) : null}

      {loadError ? (
        <p style={{ color: '#b91c1c', fontSize: 14 }}>{loadError}</p>
      ) : null}
      {saveError ? (
        <p style={{ color: '#b91c1c', fontSize: 14 }}>{saveError}</p>
      ) : null}
      {genError ? (
        <p style={{ color: '#b91c1c', fontSize: 14 }}>{genError}</p>
      ) : null}

      {healthItem ? (
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          마지막 저장 {new Date(healthItem.updatedAt).toLocaleString('ko-KR')}
        </p>
      ) : null}

      {!hasContent ? (
        <section style={{ marginBottom: 20, padding: 16, border: `1px solid ${divider}`, background: '#f8fafc' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 800 }}>생성 전 정보</h2>
          <div style={{ display: 'grid', gap: 10, maxWidth: 560 }}>
            <label style={{ fontSize: 13 }}>
              검진일자
              <input
                type="date"
                style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}
                value={checkupDate}
                onChange={(e) => setCheckupDate(e.target.value)}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              담당 수의사
              <input
                style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}
                value={veterinarian}
                onChange={(e) => setVeterinarian(clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS))}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              프로그램(표지·프롬프트)
              <input
                style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}
                value={coverProgram}
                onChange={(e) => setCoverProgram(clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS))}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              반드시 포함 (최대 {HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS}자)
              <textarea
                style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, minHeight: 80 }}
                value={mustInclude}
                onChange={(e) => setMustInclude(clamp(e.target.value, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS))}
              />
            </label>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#64748b' }}>
            LLM 생성은 서버에서 chart-api로 프록시됩니다. <code>CHART_API_BASE_URL</code>, <code>CHART_APP_API_KEY</code>, chart-api
            측 <code>GEMINI_API_KEY</code>가 필요합니다.
          </p>
          <button
            type="button"
            className="adminLegacyPrimaryBtn"
            style={{ marginTop: 12 }}
            disabled={generating}
            onClick={() => void generateContent()}
          >
            {generating ? '생성 중… (수 분 걸릴 수 있음)' : '건강검진 컨텐츠 생성'}
          </button>
        </section>
      ) : null}

      {hasContent ? (
        <>

          <details open style={{ border: `1px solid ${divider}`, marginBottom: 10, background: '#fff' }}>
            <summary style={{ padding: '10px 12px', fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>표지</span>
              <button type="button" className="adminLegacySmallBtn" disabled={savingSection !== null} onClick={(e) => { e.preventDefault(); void saveSectionReview('cover'); }}>
                {savingSection === 'cover' ? '저장 중…' : '저장'}
              </button>
            </summary>
            <div style={{ padding: '12px 14px', display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
              <label style={labelGrid}>
                검진일
                <input
                  type="date"
                  value={draft.coverCheckupDate?.slice(0, 10) ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      coverCheckupDate: clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_CHECKUP_DATE_CHARS),
                    }))
                  }
                />
              </label>
              <label style={labelGrid}>
                프로그램
                <input
                  value={draft.coverProgram ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, coverProgram: clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS) }))
                  }
                />
              </label>
              <label style={labelGrid}>
                수의사
                <input
                  value={draft.coverVeterinarian ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      coverVeterinarian: clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS),
                    }))
                  }
                />
              </label>
              <label style={labelGrid}>
                반려동물 이름
                <input
                  value={draft.coverPatientName ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      coverPatientName: clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS),
                    }))
                  }
                />
              </label>
              <label style={labelGrid}>
                종
                <select
                  value={draft.coverPatientSpecies ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, coverPatientSpecies: e.target.value }))}
                >
                  <option value="">선택</option>
                  {SPECIES_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelGrid}>
                품종
                <input
                  value={draft.coverPatientBreed ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      coverPatientBreed: clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS),
                    }))
                  }
                />
              </label>
              <label style={labelGrid}>
                성별
                <select
                  value={draft.coverPatientSex ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, coverPatientSex: clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_SEX_CHARS) }))
                  }
                >
                  <option value="">선택</option>
                  {SEX_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelGrid}>
                나이
                <input
                  value={draft.coverPatientAge ?? ''}
                  onBlur={(e) =>
                    setDraft((d) => ({
                      ...d,
                      coverPatientAge: clamp(appendUnitIfNeeded(e.target.value, '세'), HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS),
                    }))
                  }
                  onChange={(e) => setDraft((d) => ({ ...d, coverPatientAge: e.target.value }))}
                />
              </label>
              <label style={labelGrid}>
                체중
                <input
                  value={draft.coverPatientWeight ?? ''}
                  onBlur={(e) =>
                    setDraft((d) => ({
                      ...d,
                      coverPatientWeight: clamp(appendUnitIfNeeded(e.target.value, 'kg'), HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS),
                    }))
                  }
                  onChange={(e) => setDraft((d) => ({ ...d, coverPatientWeight: e.target.value }))}
                />
              </label>
              <label style={{ ...labelGrid, gridColumn: '1 / -1' }}>
                보호자 성함
                <input
                  value={draft.coverOwnerName ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      coverOwnerName: clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS),
                    }))
                  }
                />
              </label>
            </div>
          </details>

          <details open style={{ border: `1px solid ${divider}`, marginBottom: 10, background: '#fff' }}>
            <summary style={{ padding: '10px 12px', fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>종합 소견</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void generateSection('overall', 'overall'); }}>
                  {generatingSection === 'overall' ? '재생성 중…' : '다시 생성'}
                </button>
                <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void condenseSection('overall'); }}>
                  {condensingSection === 'overall' ? '간결화 중…' : '간결화'}
                </button>
                <button type="button" className="adminLegacySmallBtn" disabled={savingSection !== null || generatingSection !== null || condensingSection !== null} onClick={(e) => { e.preventDefault(); void saveSectionReview('overall'); }}>
                  {savingSection === 'overall' ? '저장 중…' : '저장'}
                </button>
              </div>
            </summary>
            <div style={{ padding: '12px 14px' }}>
              <textarea
                rows={10}
                style={{ width: '100%', fontSize: 13, padding: 10 }}
                value={draft.overallSummary}
                onChange={(e) => setDraft((d) => ({ ...d, overallSummary: e.target.value }))}
              />
              <p style={{ margin: '6px 0 0', fontSize: 12, color: overallLen > HEALTH_CHECKUP_MAX_OVERALL_CHARS ? '#b91c1c' : '#b45309' }}>
                {overallLen} / {HEALTH_CHECKUP_MAX_OVERALL_CHARS} (권장 최소 {HEALTH_CHECKUP_MIN_OVERALL_CHARS}자)
                {overallLen > HEALTH_CHECKUP_MAX_OVERALL_CHARS ? OVER_MAX_WARNING : ''}
              </p>
            </div>
          </details>

          <details open style={{ border: `1px solid ${divider}`, marginBottom: 10, background: '#fff' }}>
            <summary style={{ padding: '10px 12px', fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>사후 관리</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void generateSection('followUp', 'followUp'); }}>
                  {generatingSection === 'followUp' ? '재생성 중…' : '다시 생성'}
                </button>
                <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void condenseSection('followUp'); }}>
                  {condensingSection === 'followUp' ? '간결화 중…' : '간결화'}
                </button>
                <button type="button" className="adminLegacySmallBtn" disabled={savingSection !== null || generatingSection !== null || condensingSection !== null} onClick={(e) => { e.preventDefault(); void saveSectionReview('followUp'); }}>
                  {savingSection === 'followUp' ? '저장 중…' : '저장'}
                </button>
              </div>
            </summary>
            <div style={{ padding: '12px 14px' }}>
              <textarea
                rows={8}
                style={{ width: '100%', fontSize: 13, padding: 10 }}
                value={draft.followUpCare}
                onChange={(e) => setDraft((d) => ({ ...d, followUpCare: e.target.value }))}
              />
              <p style={{ margin: '6px 0 0', fontSize: 12, color: followLen > HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS ? '#b91c1c' : '#b45309' }}>
                {followLen} / {HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS} (권장 최소 {HEALTH_CHECKUP_MIN_FOLLOW_UP_CHARS}자)
                {followLen > HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS ? OVER_MAX_WARNING : ''}
              </p>
            </div>
          </details>

          <details open style={{ border: `1px solid ${divider}`, marginBottom: 10, background: '#fff' }}>
            <summary style={{ padding: '10px 12px', fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>권장 재검진</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void generateSection('recheck', 'recheck'); }}>
                  {generatingSection === 'recheck' ? '재생성 중…' : '다시 생성'}
                </button>
                <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void condenseSection('recheck'); }}>
                  {condensingSection === 'recheck' ? '간결화 중…' : '간결화'}
                </button>
                <button type="button" className="adminLegacySmallBtn" disabled={savingSection !== null || generatingSection !== null || condensingSection !== null} onClick={(e) => { e.preventDefault(); void saveSectionReview('recheck'); }}>
                  {savingSection === 'recheck' ? '저장 중…' : '저장'}
                </button>
              </div>
            </summary>
            <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {(
                [
                  ['1–2주', 'recheckWithin1to2Weeks'],
                  ['1개월', 'recheckWithin1Month'],
                  ['3개월', 'recheckWithin3Months'],
                  ['6개월', 'recheckWithin6Months'],
                ] as const
              ).map(([label, key]) => {
                const raw = draft[key];
                const { cardTitle, cardBody } = splitTimelineCardText(typeof raw === 'string' ? raw : '');
                return (
                  <div key={key} style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{label}</div>
                    <input
                      placeholder="제목"
                      style={{ width: '100%', padding: 8, fontSize: 13 }}
                      value={cardTitle}
                      onChange={(e) => setRecheckField(key, 'title', e.target.value)}
                    />
                    <p style={{ margin: 0, fontSize: 11, color: cardTitle.length > HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS ? '#b91c1c' : '#b45309', textAlign: 'right' }}>
                      {cardTitle.length} / {HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS}
                      {cardTitle.length > HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS ? OVER_MAX_WARNING : ''}
                    </p>
                    <textarea
                      placeholder="본문"
                      rows={3}
                      style={{ width: '100%', padding: 8, fontSize: 13 }}
                      value={cardBody}
                      onChange={(e) => setRecheckField(key, 'body', e.target.value)}
                    />
                    <p style={{ margin: 0, fontSize: 11, color: cardBody.length > HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS ? '#b91c1c' : '#b45309', textAlign: 'right' }}>
                      {cardBody.length} / {HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS}
                      {cardBody.length > HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS ? OVER_MAX_WARNING : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          </details>

          {SYSTEM_KEYS.flatMap((k) => {
            const rowMax = rowMaxCharsForSystemKey(k);
            const blocks = getStructuredBlocksFromDraft(draft, k);
            if (blocks.length === 0) return [];
            return blocks.map((block, bi) => {
              if (block.variant !== 'rows') return null;
              const blockTitle = (block.titleKo || block.titleEn || `블록 ${bi + 1}`).trim() || `블록 ${bi + 1}`;
              return (
                <details key={`${k}-${bi}`} open style={{ border: `1px solid ${divider}`, marginBottom: 10, background: '#fff' }}>
                  <summary style={{ padding: '10px 12px', fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{blockTitle}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void generateSection(systemKeyToApiSection(k), `${k}-${bi}`); }}>
                        {generatingSection === `${k}-${bi}` ? '재생성 중…' : '다시 생성'}
                      </button>
                      <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void condenseSection(`${k}-${bi}`); }}>
                        {condensingSection === `${k}-${bi}` ? '간결화 중…' : '간결화'}
                      </button>
                      <button type="button" className="adminLegacySmallBtn" disabled={savingSection !== null || generatingSection !== null || condensingSection !== null} onClick={(e) => { e.preventDefault(); void saveSectionReview(`${k}-${bi}`); }}>
                        {savingSection === `${k}-${bi}` ? '저장 중…' : '저장'}
                      </button>
                    </div>
                  </summary>
                  <div style={{ padding: '12px 14px', display: 'grid', gap: 10 }}>
                    {block.rows.map((row, ri) => (
                      <label key={ri} style={{ fontSize: 12, display: 'grid', gap: 4 }}>
                        <span style={{ color: '#64748b' }}>{row.label}</span>
                        <textarea
                          rows={3}
                          style={{ width: '100%', padding: 8, fontSize: 13 }}
                          value={row.content}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraft((prev) => {
                              const cur = getStructuredBlocksFromDraft(prev, k);
                              if (!cur[bi] || cur[bi].variant !== 'rows') return prev;
                              const nextBlocks = structuredClone(cur) as HealthSystemsReportBlock[];
                              const b = nextBlocks[bi];
                              if (b.variant !== 'rows') return prev;
                              const nr = [...b.rows];
                              nr[ri] = { ...nr[ri], content: v };
                              nextBlocks[bi] = { ...b, rows: nr };
                              return { ...prev, [k]: nextBlocks };
                            });
                          }}
                        />
                        <span style={{ fontSize: 11, color: row.content.length > rowMax ? '#b91c1c' : '#b45309' }}>
                          {row.content.length} / {rowMax}
                          {row.content.length > rowMax ? OVER_MAX_WARNING : ''}
                        </span>
                      </label>
                    ))}
                    {(() => {
                      const imgBlock = blocks[bi + 1];
                      if (!imgBlock || !isImageVariant(imgBlock.variant)) return null;
                      const slots = (imgBlock as { images: HealthSystemsImageSlot[] }).images;
                      return (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginTop: 4, marginBottom: 8 }}>
                            이미지 ({slots.length}장)
                          </div>
                          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                            {slots.map((slot, si) => {
                              const src = slot.src ?? '';
                              const candidate = imageCandidates.find((c) => c.storagePath === src);
                              const previewUrl = candidate?.previewUrl;
                              return (
                                <div key={si} style={{ border: `1px dashed ${divider}`, borderRadius: 6, padding: 8, background: '#fff' }}>
                                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>슬롯 {si + 1}</div>
                                  {previewUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img alt="" src={previewUrl} style={{ width: '100%', maxHeight: 72, objectFit: 'cover', borderRadius: 4 }} />
                                  ) : src ? (
                                    <div style={{ fontSize: 10, color: '#94a3b8', padding: '4px 0', wordBreak: 'break-all' }}>
                                      {src.split('/').pop()}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: '#94a3b8', padding: '8px 0' }}>없음</div>
                                  )}
                                  <select
                                    style={{ width: '100%', marginTop: 6, fontSize: 11 }}
                                    value={candidate?.id ?? ''}
                                    onChange={(e) => {
                                      const id = e.target.value;
                                      const path = id ? (candidatePathMap.get(id) ?? '') : '';
                                      updateImageSlot(k, bi + 1, si, { src: path || undefined });
                                    }}
                                  >
                                    <option value="">비움</option>
                                    {imageCandidates.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {(c.examDate ?? '') + ' ' + (c.fileName ?? c.id).slice(0, 24)}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    style={{ width: '100%', marginTop: 6, fontSize: 11, padding: 4 }}
                                    placeholder="캡션"
                                    value={slot.caption ?? ''}
                                    onChange={(e) => updateImageSlot(k, bi + 1, si, { caption: e.target.value })}
                                  />
                                  {src ? (
                                    <button
                                      type="button"
                                      className="adminLegacySmallBtn"
                                      style={{ marginTop: 6, fontSize: 10 }}
                                      onClick={() => updateImageSlot(k, bi + 1, si, { src: undefined, caption: '' })}
                                    >
                                      슬롯 비우기
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </details>
              );
            });
          })}

          <details open style={{ border: `1px solid ${divider}`, marginBottom: 10, background: '#fff' }}>
            <summary style={{ padding: '10px 12px', fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>혈액검사 해석</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void generateSection('lab', 'lab'); }}>
                  {generatingSection === 'lab' ? '재생성 중…' : '다시 생성'}
                </button>
                <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void condenseSection('lab'); }}>
                  {condensingSection === 'lab' ? '간결화 중…' : '간결화'}
                </button>
                <button type="button" className="adminLegacySmallBtn" disabled={savingSection !== null || generatingSection !== null || condensingSection !== null} onClick={(e) => { e.preventDefault(); void saveSectionReview('lab'); }}>
                  {savingSection === 'lab' ? '저장 중…' : '저장'}
                </button>
              </div>
            </summary>
            <div style={{ padding: '12px 14px' }}>
              <textarea
                rows={6}
                style={{ width: '100%', fontSize: 13, padding: 10 }}
                value={draft.labInterpretation ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    labInterpretation: e.target.value,
                  }))
                }
              />
              <p style={{ margin: '6px 0 0', fontSize: 12, color: (draft.labInterpretation ?? '').length > HEALTH_CHECKUP_LAB_INTERP_MAX_CHARS ? '#b91c1c' : '#b45309' }}>
                {(draft.labInterpretation ?? '').length} / {HEALTH_CHECKUP_LAB_INTERP_MAX_CHARS}
                {(draft.labInterpretation ?? '').length > HEALTH_CHECKUP_LAB_INTERP_MAX_CHARS ? OVER_MAX_WARNING : ''}
              </p>
            </div>
          </details>

          <details open style={{ border: `1px solid ${divider}`, marginBottom: 10, background: '#fff' }}>
            <summary style={{ padding: '10px 12px', fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>이미지 후보</span>
              <button type="button" className="adminLegacySmallBtn" disabled={savingSection !== null} onClick={(e) => { e.preventDefault(); void saveSectionReview('images'); }}>
                {savingSection === 'images' ? '저장 중…' : '저장'}
              </button>
            </summary>
            <div style={{ padding: '12px 14px' }}>
              <AdminHealthReportImageSlots
                runId={runId}
                page4Raw={draft.systemsPage4Blocks}
                page5Raw={draft.systemsPage5Blocks}
                onChangePage4={(blocks) => setDraft((d) => ({ ...d, systemsPage4Blocks: blocks }))}
                onChangePage5={(blocks) => setDraft((d) => ({ ...d, systemsPage5Blocks: blocks }))}
                hideSlots
                onCandidatesLoaded={(c, m) => { setImageCandidates(c); setCandidatePathMap(m); }}
              />
            </div>
          </details>

        </>
      ) : null}
      </div>
      <dialog
        ref={chartHistoryDialogRef}
        onClose={() => setChartHistoryOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setChartHistoryOpen(false); }}
        style={{
          position: 'fixed',
          inset: 0,
          margin: 'auto',
          width: 'min(96vw, 1000px)',
          maxHeight: '90vh',
          border: '1px solid rgba(15,23,42,0.15)',
          borderRadius: 8,
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '90vh', maxHeight: '90vh' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(15,23,42,0.1)', flexShrink: 0, background: '#fff' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>차트 기록</span>
            <button
              type="button"
              className="adminLegacySmallBtn"
              onClick={() => setChartHistoryOpen(false)}
            >
              닫기
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <AdminRunExtractionDetail runId={runId} embedded />
          </div>
        </div>
      </dialog>

      <HealthReportPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        runId={runId}
        generatedPayload={draft}
      />
    </>
  );
}
