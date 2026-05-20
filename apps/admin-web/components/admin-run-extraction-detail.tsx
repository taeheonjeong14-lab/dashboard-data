'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { ExamType, FindingSpot, RadiologySub } from '@/lib/chart-case-images/types';
import { EXAM_TYPE_LABEL_KO, RADIOLOGY_SUB_LABEL_KO } from '@/lib/chart-case-images/types';
import type { PlanRow, RunDetailResponse } from '@/lib/admin-run-detail-types';
import { HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS } from '@/lib/health-report-admin/limits';
import { canonicalizeLabItemName, isRecognizedLabItem } from '@/lib/chart-extraction/lab-item-normalize';
import { speciesProfileFromBasicSpecies } from '@/lib/chart-extraction/lab-species-profile';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';
import { BucketDebugPanel } from '@/components/bucket-debug-panel';

type ExtractionSection = 'basicInfo' | 'vaccination' | 'chartBody' | 'plan' | 'lab';

/** 정규화 결과 셀 — 표준 미인식 항목(리포트 Other 로 분류)은 빨간색으로 강조. */
function NormalizedLabCell({ name }: { name: string }) {
  const recognized = isRecognizedLabItem(name);
  return (
    <td
      style={{ padding: 4, color: recognized ? '#64748b' : '#dc2626', fontWeight: recognized ? 400 : 700 }}
      title={recognized ? undefined : '정규화 실패: 표준 항목으로 인식되지 않아 리포트에서 Other 로 분류됩니다.'}
    >
      {name}
    </td>
  );
}

type DraftBasicInfo = {
  id: string | null;
  hospitalName: string;
  ownerName: string;
  patientName: string;
  species: string;
  breed: string;
  birth: string;
  age: string;
  sex: string;
};

type DraftVacRow = RunDetailResponse['vaccinationRecords'][number];

type DraftChartRow = { id: string; dateTime: string; bodyText: string };

type PlanViewGroup = {
  dateTime: string;
  rows: PlanRow[];
  planText: string;
  planDetected: boolean;
  planRowsFromDb: boolean;
};

type DraftPlanGroup = PlanViewGroup;

type DraftLabGroup = RunDetailResponse['labItemsByDate'][number];

const divider = 'rgba(15, 23, 42, 0.1)';

function planViewGroupsFromResult(res: RunDetailResponse): PlanViewGroup[] {
  if (res.chartBodyByDate.length > 0) {
    return res.chartBodyByDate.map((c) => {
      const dbRows = res.planByDate.find((p) => p.dateTime === c.dateTime)?.rows ?? [];
      const parsed = c.planRowsFromText ?? [];
      const fromDb = dbRows.length > 0;
      return {
        dateTime: c.dateTime,
        rows: fromDb ? dbRows : parsed,
        planText: c.planText,
        planDetected: c.planDetected,
        planRowsFromDb: fromDb,
      };
    });
  }
  return res.planByDate.map((p) => ({
    dateTime: p.dateTime,
    rows: p.rows,
    planText: '',
    planDetected: p.rows.length > 0,
    planRowsFromDb: p.rows.length > 0,
  }));
}

function withLabItemRawNames(groups: RunDetailResponse['labItemsByDate']): DraftLabGroup[] {
  return groups.map((g) => ({
    ...g,
    items: g.items.map((it) => ({
      ...it,
      itemRawName: it.itemRawName?.trim() ? it.itemRawName : it.itemName,
    })),
  }));
}

function defaultDateTimeForNewRow(res: RunDetailResponse): string {
  const first = res.chartBodyByDate[0]?.dateTime?.trim();
  if (first) return first;
  const d = res.run.createdAt;
  if (d && d.length >= 10) return `${d.slice(0, 10)}T00:00:00`;
  return new Date().toISOString().slice(0, 10) + 'T00:00:00';
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function SectionEditControls({
  editing,
  saving,
  onEdit,
  onSave,
  onCancel,
  canSave = true,
  editDisabled = false,
}: {
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  canSave?: boolean;
  editDisabled?: boolean;
}) {
  if (!editing) {
    return (
      <button type="button" onClick={onEdit} disabled={editDisabled} className="adminLegacySecondaryBtn">
        수정
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <button type="button" onClick={onSave} disabled={saving || !canSave} className="adminLegacySecondaryBtn">
        {saving ? '저장 중…' : '저장'}
      </button>
      <button type="button" onClick={onCancel} disabled={saving} className="adminLegacySecondaryBtn">
        취소
      </button>
    </span>
  );
}

function CopyTextButton({ text, disabled, label = '복사' }: { text: string; disabled?: boolean; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'err'>('idle');
  async function onCopy(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || !text) return;
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('err');
      setTimeout(() => setState('idle'), 2000);
    }
  }
  const suffix = state === 'done' ? ' ✓' : state === 'err' ? ' !' : '';
  return (
    <button type="button" onClick={(ev) => void onCopy(ev)} disabled={disabled || !text} className="adminLegacySmallBtn">
      {label}
      {suffix}
    </button>
  );
}

type CaseImage = {
  id: string;
  index: number;
  fileName: string;
  signedUrl: string | null;
  examType: ExamType | null;
  radiologySub: RadiologySub | null;
  hasNotableFinding: boolean;
  isClearFinding: boolean;
  briefComment: string;
  findingSpots: FindingSpot[];
  relatedAssessmentCondition: string | null;
};

function FindingOverlay({ spots, imageRef }: { spots: FindingSpot[]; imageRef: React.RefObject<HTMLImageElement | null> }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;
    const update = () => setDims({ w: img.offsetWidth, h: img.offsetHeight });
    if (img.complete) update();
    img.addEventListener('load', update);
    return () => img.removeEventListener('load', update);
  }, [imageRef]);

  if (!dims) return null;
  return (
    <svg
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }}
      viewBox={`0 0 ${dims.w} ${dims.h}`}
    >
      {spots.map((s, i) => {
        const cx = (s.cx / 100) * dims.w;
        const cy = (s.cy / 100) * dims.h;
        const r = (s.r / 100) * Math.min(dims.w, dims.h);
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="rgba(239,68,68,0.25)" stroke="#ef4444" strokeWidth={1.5} />
        );
      })}
    </svg>
  );
}

function CaseImageCard({ img }: { img: CaseImage }) {
  const [open, setOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const examLabel = img.examType ? EXAM_TYPE_LABEL_KO[img.examType] : null;
  const subLabel = img.radiologySub ? RADIOLOGY_SUB_LABEL_KO[img.radiologySub] : null;

  return (
    <>
      <div
        style={{
          border: `1px solid ${img.isClearFinding ? '#fca5a5' : img.hasNotableFinding ? '#fde68a' : '#e2e8f0'}`,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Thumbnail */}
        <div
          style={{ position: 'relative', background: '#0f172a', cursor: img.signedUrl ? 'pointer' : 'default' }}
          onClick={() => img.signedUrl && setOpen(true)}
        >
          {img.signedUrl ? (
            <img
              ref={imgRef}
              src={img.signedUrl}
              alt={img.fileName}
              style={{ width: '100%', height: 160, objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 12 }}>
              이미지 없음
            </div>
          )}
          {img.hasNotableFinding && img.findingSpots.length > 0 && img.signedUrl && (
            <FindingOverlay spots={img.findingSpots} imageRef={imgRef} />
          )}
          {img.hasNotableFinding && (
            <div
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                background: img.isClearFinding ? '#dc2626' : '#d97706',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
              }}
            >
              {img.isClearFinding ? '이상 명확' : '이상 의심'}
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {examLabel && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#dbeafe', color: '#1d4ed8' }}>
                {examLabel}{subLabel ? ` · ${subLabel}` : ''}
              </span>
            )}
          </div>
          {img.briefComment && (
            <p style={{ margin: 0, fontSize: 12, color: '#334155', lineHeight: 1.5 }}>{img.briefComment}</p>
          )}
          <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {img.fileName}
          </p>
        </div>
      </div>

      {/* Lightbox */}
      {open && img.signedUrl && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
          }}
          onClick={() => setOpen(false)}
        >
          <img
            src={img.signedUrl}
            alt={img.fileName}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 4 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function imageSectionKey(img: Pick<CaseImage, 'examType' | 'radiologySub'>): string {
  if (img.examType === 'radiology') {
    if (img.radiologySub === 'thorax') return 'radiology:thorax';
    if (img.radiologySub === 'abdomen') return 'radiology:abdomen';
    if (img.radiologySub === 'joint') return 'radiology:joint';
    if (img.radiologySub === 'dental') return 'radiology:dental';
    return 'other';
  }
  if (img.examType === 'ultrasound') return 'ultrasound';
  if (img.examType === 'microscopy' || img.examType === 'endoscopy') return 'scope';
  if (img.examType === 'slit_lamp') return 'slit_lamp';
  return 'other';
}

const IMAGE_SECTION_ORDER = [
  'radiology:thorax',
  'radiology:abdomen',
  'radiology:joint',
  'radiology:dental',
  'ultrasound',
  'scope',
  'slit_lamp',
  'other',
] as const;

function imageSectionTitle(key: string): string {
  if (key === 'radiology:thorax') return '방사선 (흉부)';
  if (key === 'radiology:abdomen') return '방사선 (복부)';
  if (key === 'radiology:joint') return '방사선 (관절)';
  if (key === 'radiology:dental') return '방사선 (치아)';
  if (key === 'ultrasound') return '초음파';
  if (key === 'scope') return '현미경 · 검이경';
  if (key === 'slit_lamp') return '슬릿램프';
  return '그 외';
}

function groupImagesBySection(images: CaseImage[]): Array<{ key: string; images: CaseImage[] }> {
  const map = new Map<string, CaseImage[]>();
  for (const img of images) {
    const key = imageSectionKey(img);
    const group = map.get(key) ?? [];
    group.push(img);
    map.set(key, group);
  }
  return IMAGE_SECTION_ORDER.filter((key) => map.has(key)).map((key) => ({ key, images: map.get(key)! }));
}

function CaseImagesSection({ runId }: { runId: string }) {
  const [images, setImages] = useState<CaseImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRetrying, setAutoRetrying] = useState(false);
  const didAutoRetry = useRef(false);
  const autoRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    didAutoRetry.current = false;
    return () => {
      if (autoRetryTimer.current) clearTimeout(autoRetryTimer.current);
    };
  }, [runId]);

  const load = useCallback(async (opts?: { isAutoRetry?: boolean }) => {
    if (!opts?.isAutoRetry) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-images`, {
        credentials: 'include',
      });
      const data = (await res.json()) as { images?: CaseImage[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '이미지 조회 실패');
      const imgs = data.images ?? [];
      setImages(imgs);
      if (imgs.length === 0 && !didAutoRetry.current) {
        didAutoRetry.current = true;
        setAutoRetrying(true);
        autoRetryTimer.current = setTimeout(() => {
          setAutoRetrying(false);
          void load({ isAutoRetry: true });
        }, 20_000);
      } else {
        setAutoRetrying(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지 조회 실패');
      setAutoRetrying(false);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);

  const sectionStyle = {
    border: '1px solid #e2e8f0',
    background: '#fff',
    borderRadius: 6,
    overflow: 'hidden',
  } satisfies React.CSSProperties;

  const summaryStyle: CSSProperties = {
    cursor: 'pointer',
    listStyle: 'none',
    padding: '9px 14px',
    fontSize: 12.5,
    fontWeight: 700,
    color: '#334155',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap' as const,
    userSelect: 'none' as const,
    background: '#f1f5f9',
    borderBottom: '1px solid #e2e8f0',
    letterSpacing: '0.01em',
  };

  return (
    <details open style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
      <summary style={summaryStyle}>
        <span>이미지 분석</span>
        <button
          type="button"
          className="adminLegacySmallBtn"
          onClick={(e) => {
            e.preventDefault();
            if (autoRetryTimer.current) { clearTimeout(autoRetryTimer.current); autoRetryTimer.current = null; }
            didAutoRetry.current = true;
            setAutoRetrying(false);
            void load();
          }}
        >
          새로고침
        </button>
      </summary>
      <div style={{ padding: '12px 14px' }}>
        {loading ? (
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>불러오는 중…</p>
        ) : error ? (
          <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>{error}</p>
        ) : images.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
            이미지가 없습니다. 차트 데이터 수집 시 이미지를 첨부하면 여기에 분석 결과가 표시됩니다.
            {autoRetrying && (
              <span style={{ display: 'block', marginTop: 4, color: '#64748b' }}>
                분석 중일 수 있습니다 — 20초 후 자동 새로고침…
              </span>
            )}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groupImagesBySection(images).map(({ key, images: sectionImages }) => (
              <details key={key} open>
                <summary
                  style={{
                    cursor: 'pointer',
                    listStyle: 'none',
                    padding: '5px 0',
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#475569',
                    userSelect: 'none',
                    borderBottom: '1px solid #e2e8f0',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>{imageSectionTitle(key)}</span>
                  <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 11 }}>{sectionImages.length}장</span>
                </summary>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                  {sectionImages.map((img) => (
                    <CaseImageCard key={img.id} img={img} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export function AdminRunExtractionDetail({
  runId,
  embedded = false,
  onDelete,
  deleting = false,
}: {
  runId: string;
  embedded?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const [result, setResult] = useState<RunDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Record<ExtractionSection, boolean>>({
    basicInfo: false,
    vaccination: false,
    chartBody: false,
    plan: false,
    lab: false,
  });
  const [draftBasic, setDraftBasic] = useState<DraftBasicInfo | null>(null);
  const [draftVac, setDraftVac] = useState<DraftVacRow[] | null>(null);
  const [draftChart, setDraftChart] = useState<DraftChartRow[] | null>(null);
  const [draftPlan, setDraftPlan] = useState<DraftPlanGroup[] | null>(null);
  const [planDeletedIds, setPlanDeletedIds] = useState<string[]>([]);
  const [draftLab, setDraftLab] = useState<DraftLabGroup[] | null>(null);
  const [labDeletedIds, setLabDeletedIds] = useState<string[]>([]);
  const [savingSection, setSavingSection] = useState<ExtractionSection | null>(null);

  const [genModalOpen, setGenModalOpen] = useState(false);
  const [genCheckupDate, setGenCheckupDate] = useState('');
  const [genVeterinarian, setGenVeterinarian] = useState('');
  const [genProgram, setGenProgram] = useState('');
  const [genMustInclude, setGenMustInclude] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState(false);
  const [genExistingReport, setGenExistingReport] = useState<boolean | null>(null);
  const genModalRef = useRef<HTMLDialogElement>(null);

  const [imgModalOpen, setImgModalOpen] = useState(false);
  const [imgModalFiles, setImgModalFiles] = useState<File[]>([]);
  const [imgModalStatus, setImgModalStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [imgModalError, setImgModalError] = useState<string | null>(null);
  const [caseImagesRefreshKey, setCaseImagesRefreshKey] = useState(0);
  const imgModalRef = useRef<HTMLDialogElement>(null);
  const imgFileInputRef = useRef<HTMLInputElement>(null);

  const labSpeciesProfile = useMemo(
    () => speciesProfileFromBasicSpecies(result?.basicInfo?.species ?? null),
    [result?.basicInfo?.species],
  );

  const fetchDetail = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!runId) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/detail`, {
          credentials: 'include',
        });
        const raw = (await response.json()) as RunDetailResponse & { error?: string };
        const chartOk = Array.isArray(raw.chartBodyByDate) && raw.run != null && typeof raw.run === 'object';
        if (!response.ok || !chartOk) {
          throw new Error(raw.error ?? 'run detail load failed');
        }
        setResult({
          ...raw,
          vaccinationRecords: raw.vaccinationRecords ?? [],
          planByDate: raw.planByDate ?? [],
          vitalsByDate: raw.vitalsByDate ?? [],
          physicalExamByDate: raw.physicalExamByDate ?? [],
          chartBodyByDate: (raw.chartBodyByDate ?? []).map((c) => ({
            ...c,
            planRowsFromText: c.planRowsFromText ?? [],
          })),
          labItemsByDate: withLabItemRawNames(raw.labItemsByDate ?? []),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : '결과 조회 실패');
        setResult(null);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [runId],
  );

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    const dialog = genModalRef.current;
    if (!dialog) return;
    if (genModalOpen) {
      if (!dialog.open) dialog.showModal();
      setGenExistingReport(null);
      fetch(`/api/admin/health-report/content?runId=${encodeURIComponent(runId)}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((data: { items?: { contentType: string }[] }) => {
          const exists = Array.isArray(data.items) && data.items.some((i) => i.contentType === 'health_checkup');
          setGenExistingReport(exists);
        })
        .catch(() => setGenExistingReport(false));
    } else {
      if (dialog.open) dialog.close();
    }
  }, [genModalOpen, runId]);

  useEffect(() => {
    const dialog = imgModalRef.current;
    if (!dialog) return;
    if (imgModalOpen) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [imgModalOpen]);

  useEffect(() => {
    setEditing({
      basicInfo: false,
      vaccination: false,
      chartBody: false,
      plan: false,
      lab: false,
    });
    setDraftBasic(null);
    setDraftVac(null);
    setDraftChart(null);
    setDraftPlan(null);
    setPlanDeletedIds([]);
    setDraftLab(null);
    setLabDeletedIds([]);
    setSaveError(null);
  }, [runId]);

  const planGroups = useMemo(() => (result ? planViewGroupsFromResult(result) : []), [result]);

  const patchExtraction = useCallback(
    async (body: object) => {
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/extraction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(payload.error ?? '저장에 실패했습니다.');
    },
    [runId],
  );

  async function saveBasicInfo() {
    if (!draftBasic) return;
    setSaveError(null);
    setSavingSection('basicInfo');
    try {
      await patchExtraction({
        section: 'basicInfo',
        basicInfo: {
          id: draftBasic.id,
          hospitalName: draftBasic.hospitalName,
          ownerName: draftBasic.ownerName,
          patientName: draftBasic.patientName,
          species: draftBasic.species,
          breed: draftBasic.breed,
          birth: draftBasic.birth,
          age: draftBasic.age.trim() === '' ? null : draftBasic.age.trim(),
          sex: draftBasic.sex,
        },
      });
      setEditing((e) => ({ ...e, basicInfo: false }));
      setDraftBasic(null);
      await fetchDetail({ silent: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingSection(null);
    }
  }

  async function saveVaccination() {
    if (!draftVac) return;
    setSaveError(null);
    setSavingSection('vaccination');
    try {
      await patchExtraction({ section: 'vaccination', records: draftVac });
      setEditing((e) => ({ ...e, vaccination: false }));
      setDraftVac(null);
      await fetchDetail({ silent: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingSection(null);
    }
  }

  async function saveChartBody() {
    if (!draftChart) return;
    setSaveError(null);
    setSavingSection('chartBody');
    try {
      await patchExtraction({
        section: 'chartBody',
        bodies: draftChart.map((c) => ({ id: c.id, bodyText: c.bodyText })),
      });
      setEditing((e) => ({ ...e, chartBody: false }));
      setDraftChart(null);
      await fetchDetail({ silent: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingSection(null);
    }
  }

  async function savePlan() {
    if (!draftPlan || !result) return;
    setSaveError(null);
    setSavingSection('plan');
    try {
      const rows = draftPlan.flatMap((g) =>
        g.rows.map((r) => ({
          ...r,
          dateTime: g.dateTime,
        })),
      );
      await patchExtraction({
        section: 'plan',
        deletedRowIds: planDeletedIds,
        rows,
      });
      setEditing((e) => ({ ...e, plan: false }));
      setDraftPlan(null);
      setPlanDeletedIds([]);
      await fetchDetail({ silent: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingSection(null);
    }
  }

  async function saveLab() {
    if (!draftLab || !result) return;
    setSaveError(null);
    setSavingSection('lab');
    try {
      const items = draftLab.flatMap((g) =>
        g.items.map((it) => ({
          id: it.id,
          dateTime: g.dateTime,
          rawItemName: it.itemRawName,
          itemName: it.itemName,
          valueText: it.valueText,
          unit: it.unit,
          referenceRange: it.referenceRange,
          flag: it.flag,
        })),
      );
      await patchExtraction({
        section: 'lab',
        deletedItemIds: labDeletedIds,
        items,
      });
      setEditing((e) => ({ ...e, lab: false }));
      setDraftLab(null);
      setLabDeletedIds([]);
      await fetchDetail({ silent: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingSection(null);
    }
  }

  async function generateReport() {
    setGenLoading(true);
    setGenError(null);
    try {
      const res = await fetch('/api/admin/health-report/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          contentType: 'health_checkup',
          checkupDate: genCheckupDate.trim(),
          veterinarian: genVeterinarian.trim().slice(0, HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS),
          mustInclude: genMustInclude.trim().slice(0, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS),
          coverProgram: genProgram.trim().slice(0, HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '생성 실패');
      setGenSuccess(true);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '생성 실패');
    } finally {
      setGenLoading(false);
    }
  }

  function closeImgModal() {
    setImgModalOpen(false);
    setImgModalFiles([]);
    setImgModalStatus('idle');
    setImgModalError(null);
  }

  function addImgModalFiles(incoming: File[]) {
    const valid = incoming.filter(
      (f) => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= 8 * 1024 * 1024,
    );
    setImgModalFiles((prev) => [...prev, ...valid].slice(0, 50));
  }

  async function submitImages() {
    if (imgModalFiles.length === 0) return;
    setImgModalStatus('uploading');
    setImgModalError(null);
    try {
      const formData = new FormData();
      formData.set('examDate', new Date().toISOString().slice(0, 10));
      formData.set('mode', 'append');
      for (const f of imgModalFiles) formData.append('images', f);
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-images`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = (await res.json()) as { ok?: boolean; count?: number; skipped?: string[]; allSkipped?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '이미지 분석 실패');
      if (data.allSkipped) {
        throw new Error(`선택한 이미지 ${imgModalFiles.length}장 모두 이미 이 차트에 분석된 이미지와 동일합니다.`);
      }
      const skippedCount = data.skipped?.length ?? 0;
      if (skippedCount > 0) {
        setImgModalError(`${skippedCount}장은 이미 분석된 이미지와 동일하여 건너뜀.`);
      }
      setImgModalStatus('done');
      setCaseImagesRefreshKey((k) => k + 1);
    } catch (e) {
      setImgModalError(e instanceof Error ? e.message : '이미지 분석 실패');
      setImgModalStatus('error');
    }
  }

  if (loading && !result) {
    return <p style={{ fontSize: 14, color: '#64748b' }}>상세 불러오는 중…</p>;
  }
  if (error || !result) {
    return (
      <div
        style={{
          padding: 16,
          border: `1px solid ${divider}`,
          background: '#fef2f2',
          color: '#991b1b',
          fontSize: 14,
        }}
      >
        {error ?? '데이터가 없습니다.'}
      </div>
    );
  }

  const sectionStyle = {
    border: '1px solid #e2e8f0',
    background: '#fff',
    borderRadius: 6,
    overflow: 'hidden',
  } satisfies React.CSSProperties;

  const summaryStyle: CSSProperties = {
    cursor: 'pointer',
    listStyle: 'none',
    padding: '9px 14px',
    fontSize: 12.5,
    fontWeight: 700,
    color: '#334155',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap' as const,
    userSelect: 'none' as const,
    background: '#f1f5f9',
    borderBottom: '1px solid #e2e8f0',
    letterSpacing: '0.01em',
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      {!embedded ? (
        <header style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>추출 결과</h1>
          {result.run.chartType && (
            <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', padding: '3px 8px', borderRadius: 4 }}>
              {result.run.chartType}
            </span>
          )}
          {result.run.fromHospitalWeb && (
            <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '3px 8px', borderRadius: 4, border: '1px solid #bbf7d0' }}>
              병원제출
            </span>
          )}
          <button
            type="button"
            className="adminLegacySecondaryBtn"
            style={{ marginLeft: 'auto' }}
            onClick={() => setImgModalOpen(true)}
          >
            이미지 추가 분석
          </button>
          <button
            type="button"
            className="adminLegacySecondaryBtn"
            onClick={() => { setGenSuccess(false); setGenError(null); setGenModalOpen(true); }}
          >
            건강검진 리포트 생성
          </button>
          <Link href="/admin/chart-data" className="adminLegacySecondaryBtn">
            기록 목록
          </Link>
          <button type="button" className="adminLegacySecondaryBtn" onClick={() => void fetchDetail({ silent: true })}>
            새로고침
          </button>
        </header>
      ) : (
        <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {result.basicInfo?.hospitalName && (
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              {result.basicInfo.hospitalName}
            </span>
          )}
          {result.basicInfo?.patientName && (
            <span style={{ fontSize: 13, color: '#334155' }}>
              {result.basicInfo.patientName}
            </span>
          )}
          {result.basicInfo?.ownerName && (
            <span style={{ fontSize: 12, color: '#64748b' }}>
              ({result.basicInfo.ownerName})
            </span>
          )}
          {(result.run.friendlyId || result.run.id) && (
            <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
              {result.run.friendlyId ?? result.run.id.slice(0, 8)}
            </span>
          )}
          {result.run.chartType && (
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#1d4ed8',
              background: '#dbeafe',
              padding: '2px 8px',
              borderRadius: 20,
              border: '1px solid #bfdbfe',
              letterSpacing: '0.02em',
            }}>
              {result.run.chartType}
            </span>
          )}
          {result.run.fromHospitalWeb && (
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#15803d',
              background: '#dcfce7',
              padding: '2px 8px',
              borderRadius: 20,
              border: '1px solid #bbf7d0',
              letterSpacing: '0.02em',
            }}>
              병원제출
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 14 }}>
            <button
              type="button"
              className="adminLegacySecondaryBtn"
              onClick={() => setImgModalOpen(true)}
            >
              이미지 추가 분석
            </button>
            <button
              type="button"
              className="adminLegacySecondaryBtn"
              onClick={() => { setGenSuccess(false); setGenError(null); setGenModalOpen(true); }}
            >
              건강검진 리포트 생성
            </button>
            {onDelete && (
              <button type="button" className="adminLegacyDangerBtn" onClick={onDelete} disabled={deleting}>
                {deleting ? '삭제 중…' : '데이터 삭제'}
              </button>
            )}
          </span>
        </div>
      )}

      {saveError ? (
        <div style={{ marginBottom: 12, padding: 12, border: `1px solid ${divider}`, background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>
          {saveError}
        </div>
      ) : null}

      {/* 섹션 그리드: 기본 정보 + Vitals 나란히, 나머지 전체 너비 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>

      {/* 기본 정보 — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
        <summary style={summaryStyle}>
          <span>기본 정보</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <CopyTextButton
              disabled={!result.basicInfo}
              text={
                result.basicInfo
                  ? [
                      result.basicInfo.hospitalName ?? '',
                      result.basicInfo.ownerName ?? '',
                      result.basicInfo.patientName ?? '',
                      result.basicInfo.species ?? '',
                      result.basicInfo.breed ?? '',
                      result.basicInfo.birth ?? '',
                      result.basicInfo.age != null ? String(result.basicInfo.age) : '',
                      result.basicInfo.sex ?? '',
                    ].join('\t')
                  : ''
              }
            />
            <SectionEditControls
              editing={editing.basicInfo}
              saving={savingSection === 'basicInfo'}
              onEdit={() => {
                const b = result.basicInfo;
                setDraftBasic(
                  b
                    ? {
                        id: b.id,
                        hospitalName: b.hospitalName ?? '',
                        ownerName: b.ownerName ?? '',
                        patientName: b.patientName ?? '',
                        species: b.species ?? '',
                        breed: b.breed ?? '',
                        birth: b.birth ?? '',
                        age: b.age != null ? String(b.age) : '',
                        sex: b.sex ?? '',
                      }
                    : {
                        id: null,
                        hospitalName: '',
                        ownerName: '',
                        patientName: '',
                        species: '',
                        breed: '',
                        birth: '',
                        age: '',
                        sex: '',
                      },
                );
                setEditing((e) => ({ ...e, basicInfo: true }));
              }}
              onSave={() => void saveBasicInfo()}
              onCancel={() => {
                setDraftBasic(null);
                setEditing((e) => ({ ...e, basicInfo: false }));
              }}
            />
          </span>
        </summary>
        <div style={{ padding: '0 12px 12px', borderTop: 'none' }}>
          {editing.basicInfo && draftBasic ? (
            <div style={{ display: 'grid', gap: 8, marginTop: 10, gridTemplateColumns: '1fr 1fr' }}>
              {(
                [
                  ['hospitalName', '병원명'],
                  ['ownerName', '보호자'],
                  ['patientName', '환자명'],
                  ['species', '종'],
                  ['breed', '품종'],
                  ['birth', '생년월일'],
                  ['age', '나이(세)'],
                  ['sex', '성별'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>{label}</span>
                  <input
                    className="adminLegacyInput"
                    value={draftBasic[key]}
                    onChange={(ev) => setDraftBasic((d) => (d ? { ...d, [key]: ev.target.value } : d))}
                    style={{ padding: 8, border: `1px solid ${divider}` }}
                  />
                </label>
              ))}
            </div>
          ) : (
            <dl style={{ margin: '10px 0 0', display: 'grid', gridTemplateColumns: '7rem 1fr', gap: 6, fontSize: 13 }}>
              {result.basicInfo ? (
                <>
                  <dt style={{ color: '#64748b' }}>병원명</dt>
                  <dd style={{ margin: 0 }}>{result.basicInfo.hospitalName ?? '—'}</dd>
                  <dt style={{ color: '#64748b' }}>보호자</dt>
                  <dd style={{ margin: 0 }}>{result.basicInfo.ownerName ?? '—'}</dd>
                  <dt style={{ color: '#64748b' }}>환자</dt>
                  <dd style={{ margin: 0 }}>{result.basicInfo.patientName ?? '—'}</dd>
                  <dt style={{ color: '#64748b' }}>종/품종</dt>
                  <dd style={{ margin: 0 }}>
                    {[result.basicInfo.species, result.basicInfo.breed].filter(Boolean).join(' / ') || '—'}
                  </dd>
                  <dt style={{ color: '#64748b' }}>생일/나이</dt>
                  <dd style={{ margin: 0 }}>
                    {result.basicInfo.birth ?? '—'} / {result.basicInfo.age != null ? `${result.basicInfo.age}세` : '—'}
                  </dd>
                  <dt style={{ color: '#64748b' }}>성별</dt>
                  <dd style={{ margin: 0 }}>{result.basicInfo.sex ?? '—'}</dd>
                </>
              ) : (
                <p style={{ gridColumn: '1 / -1', margin: 0, color: '#64748b' }}>기본 정보 행이 없습니다. 저장 시 생성됩니다.</p>
              )}
            </dl>
          )}
        </div>
      </details>

      {/* 예방접종 — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
        <summary style={summaryStyle}>
          <span>Vaccination · 외부기생충</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <CopyTextButton
              text={result.vaccinationRecords
                .map(
                  (v) =>
                    `${v.recordType}\t${v.doseOrder}\t${v.productName}\t${v.administeredDate ?? ''}\t${v.sign ?? ''}`,
                )
                .join('\n')
              }
            />
            <SectionEditControls
              editing={editing.vaccination}
              saving={savingSection === 'vaccination'}
              onEdit={() => {
                setDraftVac(deepClone(result.vaccinationRecords));
                setEditing((e) => ({ ...e, vaccination: true }));
              }}
              onSave={() => void saveVaccination()}
              onCancel={() => {
                setDraftVac(null);
                setEditing((e) => ({ ...e, vaccination: false }));
              }}
              editDisabled={result.vaccinationRecords.length === 0}
            />
          </span>
        </summary>
        <div style={{ padding: '8px 12px 12px', borderTop: 'none', overflow: 'auto' }}>
          <table className="adminDetailTable">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 6 }}>유형</th>
                <th style={{ textAlign: 'left', padding: 6 }}>차수</th>
                <th style={{ textAlign: 'left', padding: 6 }}>제품</th>
                <th style={{ textAlign: 'left', padding: 6 }}>접종일</th>
                <th style={{ textAlign: 'left', padding: 6 }}>서명</th>
              </tr>
            </thead>
            <tbody>
              {(editing.vaccination && draftVac ? draftVac : result.vaccinationRecords).map((v) => (
                <tr key={v.id}>
                  {editing.vaccination && draftVac ? (
                    <>
                      <td style={{ padding: 4 }}>
                        <select
                          value={v.recordType}
                          onChange={(ev) => {
                            const val = ev.target.value === 'ectoparasite' ? 'ectoparasite' : 'preventive';
                            setDraftVac((rows) =>
                              rows?.map((r) => (r.id === v.id ? { ...r, recordType: val } : r)) ?? null,
                            );
                          }}
                        >
                          <option value="preventive">preventive</option>
                          <option value="ectoparasite">ectoparasite</option>
                        </select>
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          value={v.doseOrder}
                          onChange={(ev) =>
                            setDraftVac((rows) =>
                              rows?.map((r) => (r.id === v.id ? { ...r, doseOrder: ev.target.value } : r)) ?? null,
                            )
                          }
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          value={v.productName}
                          onChange={(ev) =>
                            setDraftVac((rows) =>
                              rows?.map((r) => (r.id === v.id ? { ...r, productName: ev.target.value } : r)) ?? null,
                            )
                          }
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          type="date"
                          value={v.administeredDate ?? ''}
                          onChange={(ev) =>
                            setDraftVac((rows) =>
                              rows?.map((r) =>
                                r.id === v.id ? { ...r, administeredDate: ev.target.value || null } : r,
                              ) ?? null,
                            )
                          }
                        />
                      </td>
                      <td style={{ padding: 4 }}>
                        <input
                          value={v.sign ?? ''}
                          onChange={(ev) =>
                            setDraftVac((rows) =>
                              rows?.map((r) => (r.id === v.id ? { ...r, sign: ev.target.value || null } : r)) ?? null,
                            )
                          }
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: 6 }}>{v.recordType}</td>
                      <td style={{ padding: 6 }}>{v.doseOrder}</td>
                      <td style={{ padding: 6 }}>{v.productName}</td>
                      <td style={{ padding: 6 }}>{v.administeredDate ?? '—'}</td>
                      <td style={{ padding: 6 }}>{v.sign ?? '—'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* 차트 본문 — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
        <summary style={summaryStyle}>
          <span>차트 본문 (날짜별)</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <CopyTextButton
              text={result.chartBodyByDate.map((c) => `${c.dateTime}\n${c.bodyText}`).join('\n\n')}
            />
            <SectionEditControls
              editing={editing.chartBody}
              saving={savingSection === 'chartBody'}
              onEdit={() => {
                setDraftChart(
                  result.chartBodyByDate.map((c) => ({
                    id: c.id,
                    dateTime: c.dateTime,
                    bodyText: c.bodyText,
                  })),
                );
                setEditing((e) => ({ ...e, chartBody: true }));
              }}
              onSave={() => void saveChartBody()}
              onCancel={() => {
                setDraftChart(null);
                setEditing((e) => ({ ...e, chartBody: false }));
              }}
              editDisabled={result.chartBodyByDate.length === 0}
            />
          </span>
        </summary>
        <div style={{ borderTop: 'none' }}>
          {(editing.chartBody && draftChart ? draftChart : result.chartBodyByDate).map((c) => (
            <details key={c.id} open style={{ borderBottom: '1px solid #e2e8f0' }}>
              <summary style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer', listStyle: 'none', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', userSelect: 'none' }}>
                {c.dateTime}
              </summary>
              <div style={{ padding: '10px 12px' }}>
                {editing.chartBody && draftChart ? (
                  <textarea
                    value={draftChart.find((x) => x.id === c.id)?.bodyText ?? ''}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setDraftChart((rows) => rows?.map((r) => (r.id === c.id ? { ...r, bodyText: v } : r)) ?? null);
                    }}
                    rows={12}
                    style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: 8, border: `1px solid ${divider}` }}
                  />
                ) : (
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, padding: 10, background: '#f8fafc', border: `1px solid ${divider}` }}>
                    {c.bodyText || '—'}
                  </pre>
                )}
              </div>
            </details>
          ))}
        </div>
      </details>

      {/* 처방·플랜 — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
        <summary style={summaryStyle}>
          <span>처방·플랜 (날짜별)</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <CopyTextButton
              text={planGroups
                .map((g) => {
                  const header = 'code\ttreatment\tqty\tunit\tday\ttotal\troute\tsign';
                  const lines = g.rows
                    .map(
                      (r) =>
                        `${r.code ?? ''}\t${r.treatmentPrescription ?? ''}\t${r.qty ?? ''}\t${r.unit ?? ''}\t${r.day ?? ''}\t${r.total ?? ''}\t${r.route ?? ''}\t${r.signId ?? ''}`,
                    )
                    .join('\n');
                  return `${g.dateTime}\n${header}\n${lines}`;
                })
                .join('\n\n')
              }
            />
            <SectionEditControls
              editing={editing.plan}
              saving={savingSection === 'plan'}
              onEdit={() => {
                setDraftPlan(deepClone(planGroups));
                setPlanDeletedIds([]);
                setEditing((e) => ({ ...e, plan: true }));
              }}
              onSave={() => void savePlan()}
              onCancel={() => {
                setDraftPlan(null);
                setPlanDeletedIds([]);
                setEditing((e) => ({ ...e, plan: false }));
              }}
            />
          </span>
        </summary>
        <div style={{ borderTop: 'none' }}>
          {(editing.plan && draftPlan ? draftPlan : planGroups).map((g, gi) => (
            <details key={g.dateTime} open style={{ borderBottom: '1px solid #e2e8f0' }}>
              <summary style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer', listStyle: 'none', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', userSelect: 'none' }}>
                {g.dateTime}
              </summary>
              <div style={{ padding: '10px 12px 12px' }}>
              {!g.planRowsFromDb && g.rows.length > 0 ? (
                <p style={{ fontSize: 12, color: '#b45309', margin: '0 0 6px' }}>DB 행 없음 — plan_text 파싱 미리보기. 저장 시 DB에 반영됩니다.</p>
              ) : null}
              <table className="adminDetailTable">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 4 }}>코드</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>처방</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>수량</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>단위</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>일</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>계</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>경로</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>서명</th>
                    {editing.plan ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, ri) => (
                    <tr key={r.id || `new-${gi}-${ri}`}>
                      {editing.plan && draftPlan ? (
                        <>
                          {(['code', 'treatmentPrescription', 'qty', 'unit', 'day', 'total', 'route', 'signId'] as const).map(
                            (field) => (
                              <td key={field} style={{ padding: 2 }}>
                                <input
                                  style={{ width: '100%', minWidth: 48, fontSize: 11, padding: 4 }}
                                  value={(draftPlan[gi]!.rows[ri] as PlanRow)[field] ?? ''}
                                  onChange={(ev) => {
                                    const val = ev.target.value;
                                    setDraftPlan((groups) =>
                                      groups?.map((gr, gix) =>
                                        gix !== gi
                                          ? gr
                                          : {
                                              ...gr,
                                              rows: gr.rows.map((row,rix) =>
                                                rix !== ri ? row : { ...row, [field]: val || null },
                                              ),
                                            },
                                      ) ?? null,
                                    );
                                  }}
                                />
                              </td>
                            ),
                          )}
                          <td style={{ padding: 2 }}>
                            <button
                              type="button"
                              className="adminLegacySmallBtn"
                              onClick={() => {
                                if (r.id && isParseRunUuid(r.id)) setPlanDeletedIds((d) => [...d, r.id]);
                                setDraftPlan((groups) =>
                                  groups?.map((gr, gix) =>
                                    gix !== gi ? gr : { ...gr, rows: gr.rows.filter((_,rix) => rix !== ri) },
                                  ) ?? null,
                                );
                              }}
                            >
                              삭제
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: 4 }}>{r.code}</td>
                          <td style={{ padding: 4 }}>{r.treatmentPrescription}</td>
                          <td style={{ padding: 4 }}>{r.qty}</td>
                          <td style={{ padding: 4 }}>{r.unit}</td>
                          <td style={{ padding: 4 }}>{r.day}</td>
                          <td style={{ padding: 4 }}>{r.total}</td>
                          <td style={{ padding: 4 }}>{r.route}</td>
                          <td style={{ padding: 4 }}>{r.signId}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {editing.plan && draftPlan ? (
                <button
                  type="button"
                  className="adminLegacySecondaryBtn"
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    setDraftPlan((groups) =>
                      groups?.map((gr, gix) =>
                        gix !== gi
                          ? gr
                          : {
                              ...gr,
                              rows: [
                                ...gr.rows,
                                {
                                  id: '',
                                  code: null,
                                  treatmentPrescription: null,
                                  qty: null,
                                  unit: null,
                                  day: null,
                                  total: null,
                                  route: null,
                                  signId: null,
                                  rawText: null,
                                },
                              ],
                            },
                      ) ?? null,
                    );
                  }}
                >
                  행 추가
                </button>
              ) : null}
              </div>
            </details>
          ))}
        </div>
      </details>

      {/* Lab — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
        <summary style={summaryStyle}>
          <span>Lab Examination</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <CopyTextButton
              text={result.labItemsByDate
                .map((g) => {
                  const h = 'Item(raw)\tItem\tValue\tUnit\tReference\tFlag';
                  const lines = g.items
                    .map(
                      (it) =>
                        `${it.itemRawName}\t${it.itemName}\t${it.valueText}\t${it.unit ?? ''}\t${it.referenceRange ?? ''}\t${it.flag}`,
                    )
                    .join('\n');
                  return `${g.dateTime}\n${h}\n${lines}`;
                })
                .join('\n\n')
              }
            />
            <SectionEditControls
              editing={editing.lab}
              saving={savingSection === 'lab'}
              onEdit={() => {
                setDraftLab(deepClone(withLabItemRawNames(result.labItemsByDate)));
                setLabDeletedIds([]);
                setEditing((e) => ({ ...e, lab: true }));
              }}
              onSave={() => void saveLab()}
              onCancel={() => {
                setDraftLab(null);
                setLabDeletedIds([]);
                setEditing((e) => ({ ...e, lab: false }));
              }}
            />
          </span>
        </summary>
        <div style={{ borderTop: 'none' }}>
          {(editing.lab && draftLab ? draftLab : result.labItemsByDate).map((g, gi) => (
            <details key={g.dateTime} open style={{ borderBottom: '1px solid #e2e8f0' }}>
              <summary style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer', listStyle: 'none', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', userSelect: 'none' }}>
                {g.dateTime}
              </summary>
              <div style={{ padding: '8px 12px 12px' }}>
              <table className="adminDetailTable">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 4 }}>원문(OCR)</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>정규화</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>값</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>단위</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>참고</th>
                    <th style={{ textAlign: 'left', padding: 4 }}>플래그</th>
                    {editing.lab ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, ii) => (
                    <tr key={it.id || `nl-${gi}-${ii}`}>
                      {editing.lab && draftLab ? (
                        <>
                          <td style={{ padding: 2 }}>
                            <input
                              style={{ width: '100%', minWidth: 80, fontSize: 11, padding: 4 }}
                              value={draftLab[gi]!.items[ii]!.itemRawName}
                              onChange={(ev) => {
                                const raw = ev.target.value;
                                const normalized = canonicalizeLabItemName(raw, labSpeciesProfile) || raw.trim();
                                setDraftLab((groups) =>
                                  groups?.map((gr, gix) =>
                                    gix !== gi
                                      ? gr
                                      : {
                                          ...gr,
                                          items: gr.items.map((row, iix) =>
                                            iix !== ii ? row : { ...row, itemRawName: raw, itemName: normalized },
                                          ),
                                        },
                                  ) ?? null,
                                );
                              }}
                            />
                          </td>
                          <NormalizedLabCell name={draftLab[gi]!.items[ii]!.itemName} />
                          <td style={{ padding: 2 }}>
                            <input
                              style={{ width: '100%', fontSize: 11, padding: 4 }}
                              value={draftLab[gi]!.items[ii]!.valueText}
                              onChange={(ev) => {
                                const val = ev.target.value;
                                setDraftLab((groups) =>
                                  groups?.map((gr, gix) =>
                                    gix !== gi
                                      ? gr
                                      : {
                                          ...gr,
                                          items: gr.items.map((row, iix) =>
                                            iix !== ii ? row : { ...row, valueText: val },
                                          ),
                                        },
                                  ) ?? null,
                                );
                              }}
                            />
                          </td>
                          <td style={{ padding: 2 }}>
                            <input
                              style={{ width: '100%', fontSize: 11, padding: 4 }}
                              value={draftLab[gi]!.items[ii]!.unit ?? ''}
                              onChange={(ev) => {
                                const val = ev.target.value;
                                setDraftLab((groups) =>
                                  groups?.map((gr, gix) =>
                                    gix !== gi
                                      ? gr
                                      : {
                                          ...gr,
                                          items: gr.items.map((row, iix) =>
                                            iix !== ii ? row : { ...row, unit: val || null },
                                          ),
                                        },
                                  ) ?? null,
                                );
                              }}
                            />
                          </td>
                          <td style={{ padding: 2 }}>
                            <input
                              style={{ width: '100%', fontSize: 11, padding: 4 }}
                              value={draftLab[gi]!.items[ii]!.referenceRange ?? ''}
                              onChange={(ev) => {
                                const val = ev.target.value;
                                setDraftLab((groups) =>
                                  groups?.map((gr, gix) =>
                                    gix !== gi
                                      ? gr
                                      : {
                                          ...gr,
                                          items: gr.items.map((row, iix) =>
                                            iix !== ii ? row : { ...row, referenceRange: val || null },
                                          ),
                                        },
                                  ) ?? null,
                                );
                              }}
                            />
                          </td>
                          <td style={{ padding: 2 }}>
                            <select
                              value={draftLab[gi]!.items[ii]!.flag}
                              onChange={(ev) => {
                                const val = ev.target.value as DraftLabGroup['items'][number]['flag'];
                                setDraftLab((groups) =>
                                  groups?.map((gr, gix) =>
                                    gix !== gi
                                      ? gr
                                      : {
                                          ...gr,
                                          items: gr.items.map((row, iix) =>
                                            iix !== ii ? row : { ...row, flag: val },
                                          ),
                                        },
                                  ) ?? null,
                                );
                              }}
                            >
                              {(['low', 'high', 'normal', 'unknown'] as const).map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: 2 }}>
                            <button
                              type="button"
                              className="adminLegacySmallBtn"
                              onClick={() => {
                                if (it.id && isParseRunUuid(it.id)) setLabDeletedIds((d) => [...d, it.id]);
                                setDraftLab((groups) =>
                                  groups?.map((gr, gix) =>
                                    gix !== gi ? gr : { ...gr, items: gr.items.filter((_, iix) => iix !== ii) },
                                  ) ?? null,
                                );
                              }}
                            >
                              삭제
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: 4 }}>{it.itemRawName}</td>
                          <NormalizedLabCell name={it.itemName} />
                          <td style={{ padding: 4 }}>{it.valueText}</td>
                          <td style={{ padding: 4 }}>{it.unit ?? '—'}</td>
                          <td style={{ padding: 4 }}>{it.referenceRange ?? '—'}</td>
                          <td style={{ padding: 4 }}>{it.flag}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {editing.lab && draftLab ? (
                <button
                  type="button"
                  className="adminLegacySecondaryBtn"
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    setDraftLab((groups) =>
                      groups?.map((gr, gix) =>
                        gix !== gi
                          ? gr
                          : {
                              ...gr,
                              items: [
                                ...gr.items,
                                {
                                  id: '',
                                  itemName: '',
                                  itemRawName: '',
                                  valueText: '',
                                  unit: null,
                                  referenceRange: null,
                                  flag: 'unknown' as const,
                                },
                              ],
                            },
                      ) ?? null,
                    );
                  }}
                >
                  이 날짜 그룹에 행 추가
                </button>
              ) : null}
              </div>
            </details>
          ))}
          {editing.lab && draftLab && draftLab.length === 0 ? (
            <button
              type="button"
              className="adminLegacySecondaryBtn"
              onClick={() => {
                setDraftLab([
                  {
                    dateTime: defaultDateTimeForNewRow(result),
                    items: [
                      {
                        id: '',
                        itemName: '',
                        itemRawName: '',
                        valueText: '',
                        unit: null,
                        referenceRange: null,
                        flag: 'unknown',
                      },
                    ],
                    source: 'rules',
                    error: null,
                  },
                ]);
              }}
            >
              Lab 그룹 추가
            </button>
          ) : null}
        </div>
      </details>

      {/* Vitals — 왼쪽 칸 */}
      <details open style={sectionStyle}>
        <summary style={summaryStyle}>
          <span>Vitals (읽기 전용)</span>
          <CopyTextButton
            text={result.vitalsByDate
              .map(
                (v) =>
                  `${v.dateTime}\t${v.weight ?? ''}\t${v.temperature ?? ''}\t${v.respiratoryRate ?? ''}\t${v.heartRate ?? ''}\t${v.bpSystolic ?? ''}\t${v.bpDiastolic ?? ''}`,
              )
              .join('\n')
            }
          />
        </summary>
        <div style={{ padding: '8px 12px 12px', borderTop: 'none', overflow: 'auto' }}>
          <table className="adminDetailTable">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 4 }}>일시</th>
                <th style={{ textAlign: 'left', padding: 4 }}>체중</th>
                <th style={{ textAlign: 'left', padding: 4 }}>체온</th>
                <th style={{ textAlign: 'left', padding: 4 }}>호흡</th>
                <th style={{ textAlign: 'left', padding: 4 }}>심박</th>
                <th style={{ textAlign: 'left', padding: 4 }}>혈압</th>
              </tr>
            </thead>
            <tbody>
              {result.vitalsByDate.map((v) => (
                <tr key={v.id}>
                  <td style={{ padding: 4 }}>{v.dateTime}</td>
                  <td style={{ padding: 4 }}>{v.weight ?? '—'}</td>
                  <td style={{ padding: 4 }}>{v.temperature ?? '—'}</td>
                  <td style={{ padding: 4 }}>{v.respiratoryRate ?? '—'}</td>
                  <td style={{ padding: 4 }}>{v.heartRate ?? '—'}</td>
                  <td style={{ padding: 4 }}>
                    {v.bpSystolic ?? '—'}/{v.bpDiastolic ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* 신체검사 — 오른쪽 칸 */}
      <details open style={sectionStyle}>
        <summary style={summaryStyle}>
          <span>신체검사 (읽기 전용)</span>
          <CopyTextButton
            text={result.physicalExamByDate
              .map((g) =>
                [g.dateTime, ...g.items.map((i) => `${i.itemName}\t${i.valueText}\t${i.unit ?? ''}\t${i.referenceRange ?? ''}`)].join(
                  '\n',
                ),
              )
              .join('\n\n')
            }
          />
        </summary>
        <div style={{ borderTop: 'none' }}>
          {result.physicalExamByDate.map((g) => (
            <details key={g.dateTime} open style={{ borderBottom: '1px solid #e2e8f0' }}>
              <summary style={{ padding: '7px 12px', fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer', listStyle: 'none', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', userSelect: 'none' }}>
                {g.dateTime}
              </summary>
              <div style={{ padding: '8px 12px 12px' }}>
                <table className="adminDetailTable">
                  <thead>
                    <tr>
                      <th>항목</th>
                      <th>값</th>
                      <th>단위</th>
                      <th>참고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((i) => (
                      <tr key={i.id}>
                        <td>{i.itemName}</td>
                        <td>{i.valueText}</td>
                        <td>{i.unit ?? '—'}</td>
                        <td>{i.referenceRange ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </details>

      {/* 이미지 분석 — 전체 너비 */}
      <CaseImagesSection key={caseImagesRefreshKey} runId={runId} />

      {/* 버킷 디버그 — 전체 너비 */}
      <BucketDebugPanel key={runId} runId={runId} />

      </div>{/* end section grid */}

      <dialog
        ref={genModalRef}
        onClose={() => setGenModalOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setGenModalOpen(false); }}
        style={{
          position: 'fixed',
          inset: 0,
          margin: 'auto',
          width: 'min(96vw, 480px)',
          border: '1px solid rgba(15,23,42,0.15)',
          borderRadius: 8,
          padding: 0,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ background: '#fff', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(15,23,42,0.1)' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>건강검진 리포트 생성</span>
            <button type="button" className="adminLegacySmallBtn" onClick={() => setGenModalOpen(false)}>닫기</button>
          </div>
          {genSuccess ? (
            <div style={{ padding: '28px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#15803d', fontWeight: 600, marginBottom: 12 }}>생성이 완료되었습니다.</p>
              <a href="/admin/health-report" style={{ fontSize: 13, color: '#1d4ed8', textDecoration: 'underline' }}>
                건강검진 리포트 메뉴에서 확인하기 →
              </a>
            </div>
          ) : (
            <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {genExistingReport === true && (
                <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 6, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13, color: '#78350f' }}>이 차트로 생성된 건강검진 리포트가 이미 있습니다.</span>
                  <a
                    href="/admin/health-report"
                    style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', textDecoration: 'underline', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    리포트 확인하기 →
                  </a>
                </div>
              )}
              <label style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>검진일자</div>
                <input
                  type="date"
                  value={genCheckupDate}
                  onChange={(e) => setGenCheckupDate(e.target.value)}
                  style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>담당 수의사</div>
                <input
                  type="text"
                  value={genVeterinarian}
                  onChange={(e) => setGenVeterinarian(e.target.value)}
                  placeholder="예: 홍길동"
                  style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>프로그램</div>
                <input
                  type="text"
                  value={genProgram}
                  onChange={(e) => setGenProgram(e.target.value)}
                  placeholder="예: 종합건강검진 A"
                  style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>반드시 포함되어야 하는 내용</div>
                <textarea
                  value={genMustInclude}
                  onChange={(e) => setGenMustInclude(e.target.value.slice(0, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS))}
                  placeholder="LLM이 반드시 반영해야 하는 특이사항을 입력하세요"
                  rows={4}
                  style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 2 }}>
                  {genMustInclude.length} / {HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS}
                </div>
              </label>
              {genError && <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>{genError}</p>}
              <button
                type="button"
                className="adminLegacyPrimaryBtn"
                onClick={() => void generateReport()}
                disabled={genLoading}
                style={{ width: '100%', fontSize: 13 }}
              >
                {genLoading ? '생성 중…' : '생성하기'}
              </button>
            </div>
          )}
        </div>
      </dialog>

      {/* 이미지 추가 분석 모달 */}
      <dialog
        ref={imgModalRef}
        onClose={closeImgModal}
        onKeyDown={(e) => { if (e.key === 'Escape') closeImgModal(); }}
        style={{
          position: 'fixed',
          inset: 0,
          margin: 'auto',
          width: 'min(96vw, 480px)',
          border: '1px solid rgba(15,23,42,0.15)',
          borderRadius: 8,
          padding: 0,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ background: '#fff', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(15,23,42,0.1)' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>이미지 추가 분석</span>
            <button type="button" className="adminLegacySmallBtn" onClick={closeImgModal} disabled={imgModalStatus === 'uploading'}>닫기</button>
          </div>

          {imgModalStatus === 'done' ? (
            <div style={{ padding: '28px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#15803d', fontWeight: 600, marginBottom: 8 }}>분석이 완료되었습니다.</p>
              {imgModalError && (
                <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 10px', marginBottom: 12 }}>
                  {imgModalError}
                </p>
              )}
              <button type="button" className="adminLegacySecondaryBtn" onClick={closeImgModal}>닫기</button>
            </div>
          ) : (
            <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                추가로 분석할 이미지를 선택하세요. 기존 분석 이미지는 유지되고 새 이미지가 추가됩니다.
              </p>

              {/* 드롭존 */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); addImgModalFiles(Array.from(e.dataTransfer.files)); }}
                onClick={() => imgFileInputRef.current?.click()}
                style={{
                  border: '1.5px dashed #cbd5e1',
                  borderRadius: 8,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  background: '#f8fafc',
                  textAlign: 'center',
                  userSelect: 'none',
                }}
              >
                <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                  이미지 드래그 또는 클릭 · JPEG / PNG / WebP
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>최대 50장 · 장당 8MB · 자동 압축</p>
              </div>
              <input
                ref={imgFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { addImgModalFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
              />

              {/* 선택된 파일 칩 */}
              {imgModalFiles.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {imgModalFiles.map((f, i) => (
                    <div
                      key={i}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 11, color: '#1d4ed8' }}
                    >
                      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <span style={{ color: '#94a3b8', flexShrink: 0 }}>{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setImgModalFiles((prev) => prev.filter((_, ii) => ii !== i)); }}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, fontSize: 14, lineHeight: 1 }}
                        disabled={imgModalStatus === 'uploading'}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              {imgModalError && (
                <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>{imgModalError}</p>
              )}

              <button
                type="button"
                className="adminLegacyPrimaryBtn"
                onClick={() => void submitImages()}
                disabled={imgModalStatus === 'uploading' || imgModalFiles.length === 0}
                style={{ width: '100%', fontSize: 13 }}
              >
                {imgModalStatus === 'uploading' ? '분석 중… (OpenAI Vision)' : `분석 시작 (${imgModalFiles.length}장)`}
              </button>
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
}
