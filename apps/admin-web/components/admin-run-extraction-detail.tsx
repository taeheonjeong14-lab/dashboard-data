'use client';

import Link from 'next/link';
import { Copy, Pencil, Check, X, Trash2, ImagePlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { ExamType, FindingSpot, RadiologySub } from '@/lib/chart-case-images/types';
import { EXAM_TYPE_LABEL_KO, RADIOLOGY_SUB_LABEL_KO } from '@/lib/chart-case-images/types';
import type { PlanRow, RunDetailResponse } from '@/lib/admin-run-detail-types';
import { StatusBadge } from '@/components/status-badge';
import { HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS } from '@/lib/health-report-admin/limits';
import { canonicalizeLabItemName, isRecognizedLabItem, type LabCanonicalizeSpecies } from '@/lib/chart-extraction/lab-item-normalize';
import { labItemCategory, computeLabFlag } from '@dashboard/lab-normalize';
import { speciesProfileFromBasicSpecies } from '@/lib/chart-extraction/lab-species-profile';
import { createClient } from '@/lib/supabase/client';

const CASE_IMAGES_BUCKET = 'chart-case-images';
import { isParseRunUuid } from '@/lib/chart-extraction/uuid';
import { BucketDebugPanel } from '@/components/bucket-debug-panel';
import { CaseBlogButton } from '@/components/admin-case-blog-modal';

type ExtractionSection = 'basicInfo' | 'vaccination' | 'chartBody' | 'plan' | 'lab';

// 검사결과 행 flag 색 — high 빨강 / low 파랑 / unknown 회색 / normal(그 외) 기본색.
function labFlagColor(flag: string): string | undefined {
  if (flag === 'high') return '#dc2626';
  if (flag === 'low') return '#2563eb';
  if (flag === 'unknown') return 'var(--text-muted)';
  return undefined;
}

// 미정규화(표준 미인식 / Other) 경고 색 — high 빨강과 헷갈리지 않도록 주황(amber)으로 구분.
// (재배포 트리거: 공유 패키지 @dashboard/lab-normalize 갱신분을 admin-web 번들에 반영하기 위함)
const LAB_UNNORMALIZED_COLOR = '#d97706';

/** 카테고리 셀 — item_name 으로 런타임 계산 (DB 저장 안 됨). 짧은 영문 라벨 표시.
 *  Other(미분류)는 flag 색과 무관하게 항상 경고 주황(=미정규화 표시). 그 외는 rowColor(flag 색)를 따른다. */
function CategoryLabCell({ name, species, rowColor }: { name: string; species: LabCanonicalizeSpecies; rowColor?: string }) {
  const cat = labItemCategory(name, species);
  const isOther = cat.key === 'other';
  return (
    <td style={{ padding: 4, fontSize: 11, whiteSpace: 'nowrap', color: isOther ? LAB_UNNORMALIZED_COLOR : (rowColor ?? 'var(--text-secondary)') }}>
      {cat.shortLabel}
    </td>
  );
}

/** 정규화 결과 셀 — 표준 미인식 항목(리포트 Other 로 분류)은 flag 색과 무관하게 항상 경고 주황으로 강조
 *  (high 빨강과 구분). 인식된 항목은 rowColor(=flag 색)를 따른다(없으면 기본 muted). */
function NormalizedLabCell({ name, rowColor }: { name: string; rowColor?: string }) {
  const recognized = isRecognizedLabItem(name);
  return (
    <td
      style={{ padding: 4, color: recognized ? (rowColor ?? 'var(--text-muted)') : LAB_UNNORMALIZED_COLOR, fontWeight: recognized ? 400 : 700, overflowWrap: 'anywhere' }}
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

const divider = 'var(--border)';

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

const iconBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  borderRadius: 6,
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  flexShrink: 0,
};

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
      <button type="button" onClick={onEdit} disabled={editDisabled} title="수정" aria-label="수정" style={{ ...iconBtnStyle, opacity: editDisabled ? 0.45 : 1 }}>
        <Pencil size={14} />
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button type="button" onClick={onSave} disabled={saving || !canSave} title="저장" aria-label="저장" style={{ ...iconBtnStyle, color: 'var(--accent)', borderColor: 'var(--accent)', opacity: saving || !canSave ? 0.5 : 1 }}>
        {saving ? '…' : <Check size={14} />}
      </button>
      <button type="button" onClick={onCancel} disabled={saving} title="취소" aria-label="취소" style={{ ...iconBtnStyle, color: 'var(--danger)' }}>
        <X size={14} />
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
  const off = disabled || !text;
  return (
    <button
      type="button"
      onClick={(ev) => void onCopy(ev)}
      disabled={off}
      title={label}
      aria-label={label}
      style={{ ...iconBtnStyle, color: state === 'done' ? 'var(--success)' : state === 'err' ? 'var(--danger)' : 'var(--text-secondary)', opacity: off ? 0.45 : 1 }}
    >
      {state === 'done' ? <Check size={14} /> : state === 'err' ? <X size={14} /> : <Copy size={14} />}
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
  examDate: string | null;
  bodyPart: string | null;
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
          <circle key={i} cx={cx} cy={cy} r={r} fill="rgba(239,68,68,0.25)" stroke="var(--danger)" strokeWidth={1.5} />
        );
      })}
    </svg>
  );
}

function CaseImageCard({ img, numbers = [], confidence, editMode = false, onDelete }: { img: CaseImage; numbers?: number[]; confidence?: number; editMode?: boolean; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const examLabel = img.examType ? EXAM_TYPE_LABEL_KO[img.examType] : null;
  const bodyPart = img.bodyPart?.trim() || null;
  const highlighted = numbers.length > 0;

  return (
    <>
      <div
        style={{
          border: highlighted ? '2px solid #a3ff00' : '1px solid var(--border)',
          boxShadow: highlighted ? '0 0 7px rgba(163, 255, 0, 0.7)' : undefined,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Thumbnail */}
        <div
          style={{ position: 'relative', background: 'var(--text)', cursor: img.signedUrl ? 'pointer' : 'default' }}
          onClick={() => img.signedUrl && setOpen(true)}
        >
          {img.signedUrl ? (
            <img
              src={img.signedUrl}
              alt={img.fileName}
              style={{ width: '100%', height: 160, objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
              이미지 없음
            </div>
          )}
          {highlighted && (
            <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 3 }}>
              {numbers.map((n) => (
                <span
                  key={n}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#a3ff00',
                    color: '#1a2e05',
                    fontSize: 12,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  }}
                >
                  {n}
                </span>
              ))}
            </div>
          )}
          {typeof confidence === 'number' && (
            <div
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                padding: '2px 7px',
                borderRadius: 999,
                background: 'rgba(26,46,5,0.85)',
                color: '#a3ff00',
                fontSize: 11,
                fontWeight: 800,
                boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              }}
              title="이 이미지가 의심 질환을 보여주는 확신도"
            >
              {confidence}%
            </div>
          )}
          {editMode && onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="이미지 삭제"
              aria-label="이미지 삭제"
              style={{
                position: 'absolute',
                bottom: 6,
                right: 6,
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'var(--danger)',
                color: '#fff',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                zIndex: 2,
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>

        {/* Info: 검사 종류 + 부위 */}
        <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {examLabel && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
                {examLabel}
              </span>
            )}
            {bodyPart && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
                {bodyPart}
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

function formatExamDateLabel(date: string | null): string {
  if (!date) return '날짜 미지정';
  const d = new Date(date.length >= 10 ? date.slice(0, 10) : date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 날짜별 그룹(오름차순, 날짜 미지정은 맨 뒤). */
function groupImagesByDate(images: CaseImage[]): Array<{ date: string | null; images: CaseImage[] }> {
  const map = new Map<string, CaseImage[]>();
  for (const img of images) {
    const key = img.examDate ?? '';
    const group = map.get(key) ?? [];
    group.push(img);
    map.set(key, group);
  }
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return keys.map((key) => ({ date: key === '' ? null : key, images: map.get(key)! }));
}

export function CaseImagesSection({ runId, onAddAnalysis }: { runId: string; onAddAnalysis?: () => void }) {
  const [images, setImages] = useState<CaseImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [autoRetrying, setAutoRetrying] = useState(false);
  const didAutoRetry = useRef(false);
  const autoRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    didAutoRetry.current = false;
    return () => {
      loadIdRef.current++; // run 변경/언마운트 시 진행 중 폴링 취소
      if (autoRetryTimer.current) clearTimeout(autoRetryTimer.current);
    };
  }, [runId]);

  const load = useCallback(async () => {
    const myLoadId = ++loadIdRef.current;
    const stale = () => loadIdRef.current !== myLoadId;
    setLoading(true);
    setError(null);

    const fetchOnce = async (): Promise<{ images: CaseImage[] }> => {
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-images`, {
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as {
        images?: CaseImage[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? '이미지 조회 실패');
      return { images: data.images ?? [] };
    };

    try {
      const first = await fetchOnce();
      if (stale()) return;
      setImages(first.images);
      setLoading(false); // 초기 조회 끝 — 이후 임포트 진행은 autoRetrying(분석 중)으로 표시

      // 병원 제출 이미지가 아직 없으면 자동 import·분석 트리거 후, 이미지가 뜰 때까지 폴링.
      // (분석이 길어 요청이 끊겨도 폴링이 회복 → "분석 중" 유지하다 끝나면 자동 표시)
      if (first.images.length === 0 && !didAutoRetry.current) {
        didAutoRetry.current = true;
        setAutoRetrying(true);
        void fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-images/from-hospital`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => {});
        const deadline = Date.now() + 3 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          if (stale()) return;
          try {
            const r = await fetchOnce();
            if (stale()) return;
            if (r.images.length > 0) {
              setImages(r.images);
              break;
            }
          } catch {
            /* 일시 오류는 무시하고 계속 폴링 */
          }
        }
        if (!stale()) setAutoRetrying(false);
      }
    } catch (e) {
      if (stale()) return;
      setError(e instanceof Error ? e.message : '이미지 조회 실패');
      setLoading(false);
      setAutoRetrying(false);
    }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);

  const deleteImage = useCallback(async (id: string) => {
    if (!confirm('이 이미지를 삭제할까요? 되돌릴 수 없습니다.')) return;
    try {
      const res = await fetch(
        `/api/admin/runs/${encodeURIComponent(runId)}/case-images?imageId=${encodeURIComponent(id)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '삭제 실패');
      setImages((prev) => prev.filter((im) => im.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
    }
  }, [runId]);

  const sectionStyle = {} satisfies React.CSSProperties;

  // 제목 없는 섹션의 컨트롤(복사·편집) 바 — 박스/배경 없이 우측 정렬된 얇은 줄.
  const summaryStyle: CSSProperties = {
    listStyle: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
    userSelect: 'none' as const,
  };

  return (
    <details open style={{ ...sectionStyle, gridColumn: '1 / -1' }}>
      <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>이미지 분석</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {onAddAnalysis && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onAddAnalysis(); }}
              title="이미지 추가 분석"
              aria-label="이미지 추가 분석"
              style={iconBtnStyle}
            >
              <ImagePlus size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setEditMode((v) => !v); }}
            title={editMode ? '완료' : '수정(삭제)'}
            aria-label={editMode ? '완료' : '수정'}
            style={{ ...iconBtnStyle, color: editMode ? 'var(--accent)' : 'var(--text-secondary)', borderColor: editMode ? 'var(--accent)' : 'var(--border-strong)' }}
          >
            {editMode ? <Check size={14} /> : <Pencil size={14} />}
          </button>
        </span>
      </summary>
      <div style={{ padding: '12px 14px' }}>
        {loading ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
        ) : error ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>
        ) : images.length === 0 ? (
          autoRetrying ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
              ⏳ 병원에서 제출한 이미지를 분석하고 있습니다… 잠시만 기다려 주세요.
              <span style={{ display: 'block', marginTop: 4, fontWeight: 400, color: 'var(--text-muted)' }}>
                사진이 많으면 1~2분 정도 걸릴 수 있어요. 끝나면 자동으로 표시됩니다.
              </span>
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              이미지가 없습니다. 차트 데이터 수집 시 이미지를 첨부하면 여기에 분석 결과가 표시됩니다.
            </p>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {groupImagesByDate(images).map(({ date, images: dateImages }) => {
              return (
                <details key={date ?? 'no-date'} open style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
                  <summary
                    className="chartDateRow"
                    style={{
                      padding: '7px 10px',
                      marginBottom: 12,
                      fontSize: 11,
                      fontWeight: 800,
                      color: 'var(--accent)',
                      letterSpacing: '0.05em',
                      cursor: 'pointer',
                      listStyle: 'none',
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'var(--bg-subtle)',
                      borderRadius: 6,
                    }}
                  >
                    <span className="chartDateChev" aria-hidden="true">▶</span>
                    {formatExamDateLabel(date)}
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11, letterSpacing: 0 }}>{dateImages.length}장</span>
                  </summary>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                    {dateImages.map((img) => (
                      <CaseImageCard key={img.id} img={img} numbers={[]} confidence={undefined} editMode={editMode} onDelete={() => deleteImage(img.id)} />
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

type ChartTabKey = 'caseOverview' | 'emphasis' | 'additionalDocs' | 'basic' | 'vaccination' | 'chart' | 'plan' | 'lab' | 'vitals' | 'exam' | 'images' | 'debug';

type AdditionalDoc = { filename?: string; path?: string; bucket?: string; mime_type?: string; text?: string; error?: string };

// 진료케이스(blog_case) 케이스개요 표시용 라벨 — hospital-ui 작성 순서.
const CASE_OVERVIEW_LABELS: { key: string; label: string }[] = [
  { key: 'main_disease', label: '주질환명' },
  { key: 'comorbidities', label: '동반 질환명' },
  { key: 'visit_background', label: '내원 배경' },
  { key: 'patient_notes', label: '환자 특이사항' },
  { key: 'diagnosis_method', label: '진단 방식' },
  { key: 'treatment_process', label: '치료 과정' },
  { key: 'aftercare_plan', label: '사후 관리 계획' },
  { key: 'emphasis', label: '강조 희망 사항' },
];
const CHART_TABS: { key: ChartTabKey; label: string }[] = [
  { key: 'basic', label: '기본정보' },
  { key: 'vaccination', label: '접종·기생충' },
  { key: 'chart', label: '차트본문' },
  { key: 'plan', label: '플랜' },
  { key: 'lab', label: '검사결과' },
  { key: 'vitals', label: '바이탈' },
  { key: 'exam', label: '신체검사' },
  { key: 'images', label: '이미지분석' },
  { key: 'debug', label: '디버그' },
];

/** 접종·기생충 유형(recordType) 표시 라벨 */
const VACCINATION_TYPE_LABELS: Record<string, string> = {
  preventive: '예방접종',
  ectoparasite: '외부기생충',
};
const vaccinationTypeLabel = (t: string) => VACCINATION_TYPE_LABELS[t] ?? t;

/**
 * 병원이 업로드한 원본 PDF 버튼. 1개면 바로 새 탭, 여러 개면 드롭다운에서 선택.
 * (다중 PDF는 추출 시 메모리에서만 merge되고 저장되지 않으므로 원본 개별 파일을 그대로 연다.)
 */
function SourcePdfMenu({ pdfs }: { pdfs: { name: string; url: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (pdfs.length === 0) return null;
  if (pdfs.length === 1) {
    return (
      <a href={pdfs[0].url} target="_blank" rel="noopener noreferrer" title={pdfs[0].name} className="adminLegacySmallBtn">
        PDF 원본
      </a>
    );
  }
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="adminLegacySmallBtn" onClick={() => setOpen((o) => !o)}>
        PDF 원본 ({pdfs.length}) ▾
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 50,
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            padding: 4,
            minWidth: 200,
            maxWidth: 340,
          }}
        >
          {pdfs.map((f, i) => (
            <a
              key={i}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              title={f.name}
              onClick={() => setOpen(false)}
              style={{
                display: 'block',
                padding: '7px 10px',
                fontSize: 12,
                color: 'var(--text)',
                textDecoration: 'none',
                borderRadius: 6,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {i + 1}. {f.name}
            </a>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/**
 * 재추출 버튼 — 이미 업로드된 원본 PDF 로 추출을 처음부터 다시 시도해 기존 run 을 덮어쓴다(비동기).
 * 병원에 재업로드 요청 없이 백단 추출 실패를 admin 이 복구할 때 사용. 과금 없음.
 */
// 마지막 추출 시각을 "YYYY년 MM월 DD일 HH:mm"(한국시간)로 표기.
function formatExtractedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}년 ${g('month')}월 ${g('day')}일 ${g('hour')}:${g('minute')}`;
}

function ReExtractButton({ runId, onReloaded }: { runId: string; onReloaded?: () => void }) {
  // 비동기 재추출(extract_jobs) 진행 표시. status 를 폴링해 진행바를 보여주고, done 시 자동 리로드.
  const EXPECTED_MS = 90_000; // 예상 소요 ~90s (시간기반 진행바의 기준치)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const startRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const finish = useCallback((ok: boolean, msg?: string) => {
    clearTimers();
    if (ok) {
      setPct(100); setJobStatus('done'); setPhase('done');
      onReloaded?.();
      // 완료 메시지 잠깐 노출 후 정리
      window.setTimeout(() => { setPhase('idle'); setPct(0); setJobStatus(null); }, 4000);
    } else {
      setPhase('error'); setErrMsg(msg ?? '재추출 실패');
    }
  }, [clearTimers, onReloaded]);

  const startTracking = useCallback(() => {
    clearTimers();
    startRef.current = Date.now();
    setPhase('running'); setErrMsg(null); setPct((p) => (p > 4 ? p : 4));
    // 시간기반 진행(최대 92%까지 부드럽게 — 실제 완료 신호가 오면 finish 가 100% 로 채움)
    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const target = Math.min(92, (elapsed / EXPECTED_MS) * 92);
      setPct((prev) => (prev < target ? target : prev));
    }, 600);
    // status 폴링
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const r = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/re-extract`, { credentials: 'include' });
          const d = (await r.json().catch(() => ({}))) as { status?: string | null; errorText?: string | null };
          if (d.status) setJobStatus(d.status);
          if (d.status === 'done') finish(true);
          else if (d.status === 'error') finish(false, d.errorText ?? '추출에 실패했습니다(재시도 소진).');
        } catch { /* 일시 네트워크 오류는 다음 틱에서 재시도 */ }
      })();
    }, 2500);
  }, [clearTimers, runId, finish]);

  // 마운트 시 진행 중(queued/processing)인 잡이 있으면 이어서 추적 — 페이지 새로고침/재진입 대응.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/re-extract`, { credentials: 'include' });
        const d = (await r.json().catch(() => ({}))) as { status?: string | null; updatedAt?: string };
        if (!alive) return;
        if (d.status === 'queued' || d.status === 'processing') {
          const fresh = d.updatedAt ? Date.now() - new Date(d.updatedAt).getTime() < 10 * 60_000 : true;
          if (fresh) { setJobStatus(d.status); startTracking(); }
        }
      } catch { /* noop */ }
    })();
    return () => { alive = false; clearTimers(); };
  }, [runId, startTracking, clearTimers]);

  const onClick = async () => {
    if (phase === 'running') return;
    if (!window.confirm('이미 업로드된 PDF로 처음부터 재추출합니다.\n기존 추출 결과는 덮어써집니다. 진행할까요?')) return;
    setPhase('running'); setErrMsg(null); setPct(2); setJobStatus('queued');
    try {
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/re-extract`, { method: 'POST', credentials: 'include' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '재추출 요청 실패');
      startTracking();
    } catch (e) {
      finish(false, e instanceof Error ? e.message : '재추출 요청 실패');
    }
  };

  const running = phase === 'running';
  const statusLabel =
    jobStatus === 'processing' ? '추출 중…' :
    jobStatus === 'queued' ? '대기 중…' :
    jobStatus === 'done' ? '완료' : '준비 중…';

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, verticalAlign: 'top', minWidth: running || phase === 'done' || phase === 'error' ? 220 : undefined }}>
      <button type="button" className="adminLegacySecondaryBtn" onClick={() => void onClick()} disabled={running} title="업로드된 PDF로 처음부터 재추출(덮어쓰기)">
        {running ? `재추출 ${statusLabel}` : '재추출'}
      </button>
      {(running || phase === 'done') && (
        <div aria-hidden style={{ height: 6, borderRadius: 4, background: '#e5e7eb', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: phase === 'done' ? '#16a34a' : '#2563eb', transition: 'width 0.5s ease' }} />
        </div>
      )}
      {phase === 'done' && <span style={{ fontSize: 12, color: '#16a34a' }}>재추출 완료 — 결과를 갱신했습니다.</span>}
      {phase === 'error' && <span style={{ fontSize: 12, color: '#dc2626' }}>{errMsg}</span>}
    </div>
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
  const [labFlagCalcNote, setLabFlagCalcNote] = useState<string | null>(null);
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
  const [imgModalDate, setImgModalDate] = useState<string>(''); // 추가 분석할 이미지의 날짜(YYYY-MM-DD)
  const [imgModalDates, setImgModalDates] = useState<string[]>([]); // 이 run의 기존 날짜 그룹
  const [caseImagesRefreshKey, setCaseImagesRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<ChartTabKey>('basic');
  // hospital-ui 에서 작성한 케이스개요(진료케이스) / 강조사항(건강검진).
  const [caseOverview, setCaseOverview] = useState<Record<string, string> | null>(null);
  const [additionalDocs, setAdditionalDocs] = useState<AdditionalDoc[]>([]);
  const [emphasisText, setEmphasisText] = useState('');
  const imgModalRef = useRef<HTMLDialogElement>(null);
  const imgFileInputRef = useRef<HTMLInputElement>(null);

  // 케이스개요(blog_case)·강조사항(hospital_notes) 조회 — run 별 hospital 작성 내용.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/health-report/content?runId=${encodeURIComponent(runId)}`, { credentials: 'include' });
        const data = (await res.json().catch(() => ({}))) as { items?: { contentType?: string; payload?: unknown }[] };
        if (cancelled || !res.ok) return;
        const items = data.items ?? [];
        const blog = items.find((i) => i.contentType === 'blog_case')?.payload as { overview?: Record<string, unknown>; additional_docs?: unknown } | undefined;
        const notes = items.find((i) => i.contentType === 'hospital_notes')?.payload as { emphasis_text?: unknown } | undefined;
        const docs = Array.isArray(blog?.additional_docs) ? (blog.additional_docs as AdditionalDoc[]) : [];
        setAdditionalDocs(docs);
        const rawOverview = blog?.overview;
        const overview = rawOverview && typeof rawOverview === 'object'
          ? Object.fromEntries(Object.entries(rawOverview).map(([k, v]) => [k, typeof v === 'string' ? v : '']))
          : null;
        const emphasis = typeof notes?.emphasis_text === 'string' ? notes.emphasis_text : '';
        setCaseOverview(overview);
        setEmphasisText(emphasis);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

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
        .then((data: { items?: { contentType: string; payload?: { emphasis_text?: string } }[] }) => {
          const items = Array.isArray(data.items) ? data.items : [];
          setGenExistingReport(items.some((i) => i.contentType === 'health_checkup'));
          // 병원(hospital-ui) 제출 강조사항을 '반드시 포함' 칸에 pre-fill (admin 입력값은 보존).
          const emphasis = items.find((i) => i.contentType === 'hospital_notes')?.payload?.emphasis_text;
          if (typeof emphasis === 'string' && emphasis.trim()) {
            setGenMustInclude((prev) => (prev.trim() ? prev : emphasis));
          }
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
      setImgModalDate((d) => d || new Date().toISOString().slice(0, 10));
      // 기존 날짜 그룹 로드 — 기존 날짜에 추가하면 그 그룹에 합쳐 재분석된다.
      void (async () => {
        try {
          const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-images`, { credentials: 'include' });
          const data = (await res.json().catch(() => ({}))) as { images?: { examDate: string | null }[] };
          const dates = Array.from(
            new Set((data.images ?? []).map((im) => im.examDate).filter((d): d is string => !!d)),
          ).sort();
          setImgModalDates(dates);
        } catch {
          /* ignore */
        }
      })();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [imgModalOpen, runId]);

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

  // FLAG 계산: flag 가 'unknown'(=참고범위는 있으나 미판정)인 항목만 값↔참고범위로 계산해 채운다.
  // 빈 값('')인 항목(참고범위 없음)은 대상에서 제외. 차트가 준 H/L(low/high/normal)은 건드리지 않음.
  // 결과는 편집 드래프트에만 반영 → 사용자가 검토 후 저장 버튼으로 저장.
  function computeLabFlags() {
    if (!result) return;
    const base = editing.lab && draftLab ? draftLab : withLabItemRawNames(result.labItemsByDate);
    let changed = 0;
    const next = base.map((g) => ({
      ...g,
      items: g.items.map((it) => {
        if (it.flag !== 'unknown') return it;
        const f = computeLabFlag(it.valueText, it.referenceRange);
        if (f === 'unknown') return it;
        changed += 1;
        return { ...it, flag: f };
      }),
    }));
    setDraftLab(deepClone(next));
    setEditing((e) => ({ ...e, lab: true }));
    setLabFlagCalcNote(changed > 0 ? `${changed}개 항목의 플래그를 계산했어요. 확인 후 저장하세요.` : '계산 가능한(참고범위 있고 미판정인) 항목이 없어요.');
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
      // 1) 스토리지 직접 업로드용 서명 URL 발급 — 이미지 바이트가 서버 함수 본문을 거치지 않아
      //    Vercel 요청 본문 4.5MB 한도를 우회한다(많은/큰 이미지도 가능).
      const exts = imgModalFiles.map((f) => (f.name.split('.').pop() || 'jpg').toLowerCase());
      const signRes = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-images/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ exts }),
      });
      const signData = (await signRes.json().catch(() => ({}))) as {
        uploads?: { path: string; token: string }[];
        error?: string;
      };
      if (!signRes.ok) throw new Error(signData.error ?? '업로드 URL 생성에 실패했습니다.');
      const uploads = signData.uploads ?? [];
      if (uploads.length !== imgModalFiles.length) throw new Error('업로드 URL 개수가 맞지 않습니다.');

      // 2) 각 이미지를 스토리지에 직접 업로드
      const supabase = createClient();
      await Promise.all(
        uploads.map(async ({ path, token }, i) => {
          const file = imgModalFiles[i];
          const { error } = await supabase.storage
            .from(CASE_IMAGES_BUCKET)
            .uploadToSignedUrl(path, token, file, { contentType: file.type });
          if (error) throw new Error(`이미지 업로드에 실패했습니다: ${error.message}`);
        }),
      );

      // 3) 경로만 서버로 전달 → 분석/저장(본문은 작은 JSON이라 413 없음)
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          examDate: imgModalDate || new Date().toISOString().slice(0, 10),
          mode: 'append',
          uploads: uploads.map((u, i) => ({ path: u.path, fileName: imgModalFiles[i].name })),
        }),
      });
      if (!res.ok) {
        let serverMsg = '';
        try {
          serverMsg = ((await res.json()) as { error?: string }).error ?? '';
        } catch {
          /* 비-JSON 응답 */
        }
        throw new Error(serverMsg || `이미지 분석에 실패했습니다. (오류 ${res.status})`);
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        count?: number;
        skipped?: string[];
        allSkipped?: boolean;
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? '이미지 분석 실패');
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
    return <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>상세 불러오는 중…</p>;
  }
  if (error || !result) {
    return (
      <div
        style={{
          padding: 16,
          border: `1px solid ${divider}`,
          background: 'var(--danger-subtle)',
          color: 'var(--danger)',
          fontSize: 14,
        }}
      >
        {error ?? '데이터가 없습니다.'}
      </div>
    );
  }

  const sectionStyle = {} satisfies React.CSSProperties;

  // 제목 없는 섹션의 컨트롤(복사·편집) 바 — 박스/배경 없이 우측 정렬된 얇은 줄.
  const summaryStyle: CSSProperties = {
    listStyle: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
    userSelect: 'none' as const,
  };

  // 병원이 업로드한 원본 PDF — 헤더의 '건강검진 리포트 생성' 좌측에 배치(이미지는 이미지 분석 탭).
  const sourcePdfs = result.sourceFiles?.pdfs ?? [];

  // 진료케이스면 케이스개요, 건강검진이면 강조사항 탭을 맨 끝(디버그 좌측)에 추가.
  const hasCaseOverview = !!caseOverview && CASE_OVERVIEW_LABELS.some(({ key }) => (caseOverview[key] ?? '').trim());
  const hasEmphasis = emphasisText.trim().length > 0;
  const hasAdditionalDocs = additionalDocs.length > 0;
  const tabs: { key: ChartTabKey; label: string }[] = [
    ...CHART_TABS.filter((t) => t.key !== 'debug'),
    ...(hasCaseOverview ? [{ key: 'caseOverview' as ChartTabKey, label: '케이스개요' }] : []),
    ...(hasEmphasis ? [{ key: 'emphasis' as ChartTabKey, label: '강조사항' }] : []),
    ...(hasAdditionalDocs ? [{ key: 'additionalDocs' as ChartTabKey, label: '추가 자료' }] : []),
    ...CHART_TABS.filter((t) => t.key === 'debug'),
  ];

  return (
    <div style={{ paddingBottom: 24 }}>
      {!embedded ? (
        <header style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>추출 결과</h1>
          {result.run.chartType && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-subtle)', padding: '3px 8px', borderRadius: 4 }}>
              {result.run.chartType}
            </span>
          )}
          {result.run.healthStage !== 'none' && <StatusBadge category="health" stage={result.run.healthStage} style={{ fontSize: 12, padding: '3px 8px' }} />}
          {result.run.blogStage !== 'none' && <StatusBadge category="blog" stage={result.run.blogStage} style={{ fontSize: 12, padding: '3px 8px' }} />}
          {sourcePdfs.length > 0 ? (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <SourcePdfMenu pdfs={sourcePdfs} />
            </span>
          ) : null}
          <button
            type="button"
            className="adminLegacySecondaryBtn"
            style={sourcePdfs.length > 0 ? undefined : { marginLeft: 'auto' }}
            onClick={() => { setGenSuccess(false); setGenError(null); setGenModalOpen(true); }}
          >
            건강검진 리포트 생성
          </button>
          <CaseBlogButton runId={runId} />
          <Link href="/admin/chart-data" className="adminLegacySecondaryBtn">
            기록 목록
          </Link>
          <ReExtractButton runId={runId} onReloaded={() => void fetchDetail({ silent: true })} />
          <button type="button" className="adminLegacySecondaryBtn" onClick={() => void fetchDetail({ silent: true })}>
            새로고침
          </button>
        </header>
      ) : (
        <div style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {result.basicInfo?.hospitalName && (
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {result.basicInfo.hospitalName}
            </span>
          )}
          {result.basicInfo?.patientName && (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {result.basicInfo.patientName}
            </span>
          )}
          {result.basicInfo?.ownerName && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              ({result.basicInfo.ownerName})
            </span>
          )}
          {(result.run.friendlyId || result.run.id) && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
              {result.run.friendlyId ?? result.run.id.slice(0, 8)}
            </span>
          )}
          {result.run.chartType && (
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--accent)',
              background: 'var(--accent-subtle)',
              padding: '2px 8px',
              borderRadius: 20,
              border: '1px solid var(--accent-subtle)',
              letterSpacing: '0.02em',
            }}>
              {result.run.chartType}
            </span>
          )}
          {result.run.healthStage !== 'none' && <StatusBadge category="health" stage={result.run.healthStage} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, letterSpacing: '0.02em' }} />}
          {result.run.blogStage !== 'none' && <StatusBadge category="blog" stage={result.run.blogStage} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, letterSpacing: '0.02em' }} />}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 14 }}>
            <SourcePdfMenu pdfs={sourcePdfs} />
            <button
              type="button"
              className="adminLegacySecondaryBtn"
              onClick={() => { setGenSuccess(false); setGenError(null); setGenModalOpen(true); }}
            >
              건강검진 리포트 생성
            </button>
            <CaseBlogButton runId={runId} />
            <ReExtractButton runId={runId} onReloaded={() => void fetchDetail({ silent: true })} />
            {onDelete && (
              <button type="button" className="adminLegacyDangerBtn" onClick={onDelete} disabled={deleting}>
                {deleting ? '삭제 중…' : '데이터 삭제'}
              </button>
            )}
          </span>
        </div>
      )}

      {result.run.extractedAt && (
        <div style={{ marginTop: -6, marginBottom: 14, fontSize: 12, color: 'var(--text-muted)' }}>
          마지막 추출: {formatExtractedAt(result.run.extractedAt)}
        </div>
      )}

      {saveError ? (
        <div style={{ marginBottom: 12, padding: 12, border: `1px solid ${divider}`, background: 'var(--danger-subtle)', color: 'var(--danger)', fontSize: 13 }}>
          {saveError}
        </div>
      ) : null}

      {/* 탭바 (경영 대시보드와 동일한 언더라인 스타일) */}
      <div
        className="adminUnderlineTabs"
        role="tablist"
        style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', overflowX: 'auto', marginBottom: 12 }}
      >
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 콘텐츠 패널 (흰 배경) — 박스 대신 패널 하나로 */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
      {/* 섹션 그리드: 선택한 탭의 섹션만 표시 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>

      {/* 케이스개요 (진료케이스 · 병원 작성) — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'caseOverview' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>케이스개요 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(병원 작성)</span></span>
        </summary>
        <div style={{ display: 'grid', gap: 12, padding: '8px 2px' }}>
          {CASE_OVERVIEW_LABELS.map(({ key, label }) => {
            const val = (caseOverview?.[key] ?? '').trim();
            return (
              <div key={key} style={{ display: 'grid', gap: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>{label}</span>
                <span style={{ fontSize: 13, color: val ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'pre-wrap', fontStyle: val ? 'normal' : 'italic' }}>{val || '미작성'}</span>
              </div>
            );
          })}
        </div>
      </details>

      {/* 강조사항 (건강검진 · 병원 작성) — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'emphasis' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>강조사항 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(병원 작성)</span></span>
        </summary>
        <div style={{ padding: '8px 2px', fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {emphasisText.trim() || '작성된 강조사항이 없습니다.'}
        </div>
      </details>

      {/* 추가 자료 (외부 검사 결과서 등 · 병원 업로드 → LLM 텍스트 추출) — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'additionalDocs' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>추가 자료 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(병원 업로드 · LLM 추출 텍스트)</span></span>
        </summary>
        <div style={{ display: 'grid', gap: 18, padding: '8px 2px' }}>
          {additionalDocs.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>업로드된 추가 자료가 없습니다.</span>
          ) : (
            additionalDocs.map((d, i) => (
              <div key={`${d.path ?? ''}-${i}`} style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', wordBreak: 'break-all' }}>{d.filename || `파일 ${i + 1}`}</span>
                  {d.path && d.bucket ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/admin/storage/sign-url', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ bucket: d.bucket, path: d.path }),
                          });
                          const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
                          if (res.ok && data.url) window.open(data.url, '_blank', 'noopener');
                          else alert(data.error || '파일을 열 수 없습니다.');
                        } catch {
                          alert('파일을 열 수 없습니다.');
                        }
                      }}
                      style={{ flexShrink: 0, padding: '3px 10px', fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-subtle)', border: '1px solid var(--accent)', borderRadius: 6, cursor: 'pointer' }}
                    >
                      원본 열기
                    </button>
                  ) : null}
                </div>
                {d.error ? (
                  <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>추출 실패: {d.error}</span>
                ) : (
                  <div style={{ fontSize: 13, color: (d.text ?? '').trim() ? 'var(--text)' : 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.6, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', fontStyle: (d.text ?? '').trim() ? 'normal' : 'italic' }}>
                    {(d.text ?? '').trim() || '추출된 텍스트가 없습니다.'}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </details>

      {/* 기본 정보 — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'basic' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>기본정보</span>
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
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
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
                  <dt style={{ color: 'var(--text-muted)' }}>병원명</dt>
                  <dd style={{ margin: 0 }}>{result.basicInfo.hospitalName ?? '—'}</dd>
                  <dt style={{ color: 'var(--text-muted)' }}>보호자</dt>
                  <dd style={{ margin: 0 }}>{result.basicInfo.ownerName ?? '—'}</dd>
                  <dt style={{ color: 'var(--text-muted)' }}>환자</dt>
                  <dd style={{ margin: 0 }}>{result.basicInfo.patientName ?? '—'}</dd>
                  <dt style={{ color: 'var(--text-muted)' }}>종/품종</dt>
                  <dd style={{ margin: 0 }}>
                    {[result.basicInfo.species, result.basicInfo.breed].filter(Boolean).join(' / ') || '—'}
                  </dd>
                  <dt style={{ color: 'var(--text-muted)' }}>생일/나이</dt>
                  <dd style={{ margin: 0 }}>
                    {result.basicInfo.birth ?? '—'} / {result.basicInfo.age != null ? `${result.basicInfo.age}세` : '—'}
                  </dd>
                  <dt style={{ color: 'var(--text-muted)' }}>성별</dt>
                  <dd style={{ margin: 0 }}>{result.basicInfo.sex ?? '—'}</dd>
                </>
              ) : (
                <p style={{ gridColumn: '1 / -1', margin: 0, color: 'var(--text-muted)' }}>기본 정보 행이 없습니다. 저장 시 생성됩니다.</p>
              )}
            </dl>
          )}
        </div>
      </details>

      {/* 예방접종 — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'vaccination' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>접종·기생충</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <CopyTextButton
              text={result.vaccinationRecords
                .map(
                  (v) =>
                    `${vaccinationTypeLabel(v.recordType)}\t${v.doseOrder}\t${v.productName}\t${v.administeredDate ?? ''}\t${v.sign ?? ''}`,
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
                          <option value="preventive">예방접종</option>
                          <option value="ectoparasite">외부기생충</option>
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
                      <td style={{ padding: 6 }}>{vaccinationTypeLabel(v.recordType)}</td>
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
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'chart' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>차트본문</span>
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
            <details key={c.id} open style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              <summary className="chartDateRow" style={{ padding: '7px 10px', fontSize: 11, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.05em', cursor: 'pointer', listStyle: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-subtle)', borderRadius: 6 }}><span className="chartDateChev" aria-hidden="true">▶</span>
                {c.dateTime}
              </summary>
              <div style={{ marginTop: 6 }}>
                {editing.chartBody && draftChart ? (
                  <textarea
                    value={draftChart.find((x) => x.id === c.id)?.bodyText ?? ''}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setDraftChart((rows) => rows?.map((r) => (r.id === c.id ? { ...r, bodyText: v } : r)) ?? null);
                    }}
                    rows={12}
                    style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: 8, border: `1px solid ${divider}`, borderRadius: 6 }}
                  />
                ) : (
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
                    {c.bodyText || '—'}
                  </pre>
                )}
              </div>
            </details>
          ))}
        </div>
      </details>

      {/* 처방·플랜 — 전체 너비 */}
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'plan' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>플랜</span>
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
            <details key={g.dateTime} open style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              <summary className="chartDateRow" style={{ padding: '7px 10px', fontSize: 11, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.05em', cursor: 'pointer', listStyle: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-subtle)', borderRadius: 6 }}><span className="chartDateChev" aria-hidden="true">▶</span>
                {g.dateTime}
              </summary>
              <div style={{ marginTop: 4 }}>
              {!g.planRowsFromDb && g.rows.length > 0 ? (
                <p style={{ fontSize: 12, color: 'var(--warning)', margin: '0 0 6px' }}>DB 행 없음 — plan_text 파싱 미리보기. 저장 시 DB에 반영됩니다.</p>
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
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'lab' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>검사결과</span>
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
            <button
              type="button"
              className="adminLegacySecondaryBtn"
              style={{ fontSize: 11, padding: '3px 8px' }}
              title="값과 참고범위를 비교해, 미판정(unknown) 항목의 플래그를 계산해 채웁니다. 참고범위 없는 항목은 제외."
              onClick={() => computeLabFlags()}
            >
              FLAG 계산
            </button>
            <SectionEditControls
              editing={editing.lab}
              saving={savingSection === 'lab'}
              onEdit={() => {
                setDraftLab(deepClone(withLabItemRawNames(result.labItemsByDate)));
                setLabDeletedIds([]);
                setLabFlagCalcNote(null);
                setEditing((e) => ({ ...e, lab: true }));
              }}
              onSave={() => void saveLab()}
              onCancel={() => {
                setDraftLab(null);
                setLabDeletedIds([]);
                setLabFlagCalcNote(null);
                setEditing((e) => ({ ...e, lab: false }));
              }}
            />
          </span>
        </summary>
        <div style={{ borderTop: 'none' }}>
          {labFlagCalcNote ? (
            <div style={{ fontSize: 11, color: 'var(--accent)', padding: '4px 2px 8px' }}>{labFlagCalcNote}</div>
          ) : null}
          {(editing.lab && draftLab ? draftLab : result.labItemsByDate).map((g, gi) => (
            <details key={g.dateTime} open style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              <summary className="chartDateRow" style={{ padding: '7px 10px', fontSize: 11, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.05em', cursor: 'pointer', listStyle: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-subtle)', borderRadius: 6 }}><span className="chartDateChev" aria-hidden="true">▶</span>
                {g.dateTime}
              </summary>
              <div style={{ marginTop: 4 }}>
              {/* 날짜별 표마다 컬럼 폭을 통일 — 내용 길이에 따라 폭이 달라지지 않도록 fixed 레이아웃 + colgroup. */}
              <table className="adminDetailTable" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '14%' }} />
                  {editing.lab ? <col style={{ width: '8%' }} /> : null}
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 4 }}>카테고리</th>
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
                    <tr key={it.id || `nl-${gi}-${ii}`} style={editing.lab ? undefined : { color: labFlagColor(it.flag) }}>
                      {editing.lab && draftLab ? (
                        <>
                          <CategoryLabCell name={draftLab[gi]!.items[ii]!.itemName} species={labSpeciesProfile} />
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
                              {(['', 'low', 'high', 'normal', 'unknown'] as const).map((f) => (
                                <option key={f || 'blank'} value={f}>
                                  {f || '—'}
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
                        (() => {
                          const rowColor = labFlagColor(it.flag);
                          return (
                            <>
                              <CategoryLabCell name={it.itemName} species={labSpeciesProfile} rowColor={rowColor} />
                              <td style={{ padding: 4, overflowWrap: 'anywhere', color: rowColor }}>{it.itemRawName}</td>
                              <NormalizedLabCell name={it.itemName} rowColor={rowColor} />
                              <td style={{ padding: 4, overflowWrap: 'anywhere', color: rowColor }}>{it.valueText}</td>
                              <td style={{ padding: 4, overflowWrap: 'anywhere', color: rowColor }}>{it.unit ?? '—'}</td>
                              <td style={{ padding: 4, overflowWrap: 'anywhere', color: rowColor }}>{it.referenceRange ?? '—'}</td>
                              <td style={{ padding: 4, color: rowColor }}>{it.flag}</td>
                            </>
                          );
                        })()
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
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'vitals' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>바이탈</span>
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
      <details open style={{ ...sectionStyle, gridColumn: '1 / -1', display: activeTab === 'exam' ? undefined : 'none' }}>
        <summary style={summaryStyle} onClick={(e) => e.preventDefault()}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>신체검사</span>
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
            <details key={g.dateTime} open style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
              <summary className="chartDateRow" style={{ padding: '7px 10px', fontSize: 11, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.05em', cursor: 'pointer', listStyle: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-subtle)', borderRadius: 6 }}><span className="chartDateChev" aria-hidden="true">▶</span>
                {g.dateTime}
              </summary>
              <div style={{ marginTop: 4 }}>
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

      {/* 이미지 분석 — 전체 너비 (이미지분석 탭) */}
      {activeTab === 'images' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <CaseImagesSection key={caseImagesRefreshKey} runId={runId} onAddAnalysis={() => setImgModalOpen(true)} />
        </div>
      )}

      {/* 버킷 디버그 — 전체 너비 (디버그 탭) */}
      {activeTab === 'debug' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>디버그</span>
          </div>
          <BucketDebugPanel key={runId} runId={runId} />
        </div>
      )}

      </div>{/* end section grid */}
      </div>{/* end content panel */}

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
              <p style={{ fontSize: 14, color: 'var(--success)', fontWeight: 600, marginBottom: 12 }}>생성이 완료되었습니다.</p>
              <a href="/admin/health-report" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'underline' }}>
                건강검진 리포트 메뉴에서 확인하기 →
              </a>
            </div>
          ) : (
            <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {genExistingReport === true && (
                <div style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning-subtle)', borderRadius: 6, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--warning)' }}>이 차트로 생성된 건강검진 리포트가 이미 있습니다.</span>
                  <a
                    href="/admin/health-report"
                    style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'underline', whiteSpace: 'nowrap', flexShrink: 0 }}
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
                  style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>담당 수의사</div>
                <input
                  type="text"
                  value={genVeterinarian}
                  onChange={(e) => setGenVeterinarian(e.target.value)}
                  placeholder="예: 홍길동"
                  style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>프로그램</div>
                <input
                  type="text"
                  value={genProgram}
                  onChange={(e) => setGenProgram(e.target.value)}
                  placeholder="예: 종합건강검진 A"
                  style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>반드시 포함되어야 하는 내용</div>
                <textarea
                  value={genMustInclude}
                  onChange={(e) => setGenMustInclude(e.target.value.slice(0, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS))}
                  placeholder="LLM이 반드시 반영해야 하는 특이사항을 입력하세요"
                  rows={4}
                  style={{ display: 'block', width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>
                  {genMustInclude.length} / {HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS}
                </div>
              </label>
              {genError && <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{genError}</p>}
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
              <p style={{ fontSize: 14, color: 'var(--success)', fontWeight: 600, marginBottom: 8 }}>분석이 완료되었습니다.</p>
              {imgModalError && (
                <p style={{ fontSize: 12, color: 'var(--warning)', background: 'var(--warning-subtle)', border: '1px solid var(--warning-subtle)', borderRadius: 6, padding: '6px 10px', marginBottom: 12 }}>
                  {imgModalError}
                </p>
              )}
              <button type="button" className="adminLegacySecondaryBtn" onClick={closeImgModal}>닫기</button>
            </div>
          ) : (
            <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                추가로 분석할 이미지를 선택하세요. 기존 분석 이미지는 유지되고 새 이미지가 추가됩니다.
              </p>

              {/* 날짜 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>분석 날짜</label>
                {imgModalDates.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {imgModalDates.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setImgModalDate(d)}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          cursor: 'pointer',
                          border: `1px solid ${imgModalDate === d ? 'var(--accent)' : 'var(--border)'}`,
                          background: imgModalDate === d ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                          color: imgModalDate === d ? 'var(--accent)' : 'var(--text-secondary)',
                        }}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  type="date"
                  value={imgModalDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setImgModalDate(e.target.value)}
                  disabled={imgModalStatus === 'uploading'}
                  style={{ padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 6, fontSize: 13, width: 'fit-content' }}
                />
                <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                  기존 날짜를 고르면 그 그룹에 합쳐 재분석되고, 새 날짜면 새 그룹이 생깁니다.
                </p>
              </div>

              {/* 드롭존 */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); addImgModalFiles(Array.from(e.dataTransfer.files)); }}
                onClick={() => imgFileInputRef.current?.click()}
                style={{
                  border: '1.5px dashed var(--border-strong)',
                  borderRadius: 8,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  background: 'var(--bg-subtle)',
                  textAlign: 'center',
                  userSelect: 'none',
                }}
              >
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                  이미지 드래그 또는 클릭 · JPEG / PNG / WebP
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>최대 50장 · 장당 8MB · 자동 압축</p>
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
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--accent-subtle)', border: '1px solid var(--accent-subtle)', borderRadius: 6, fontSize: 11, color: 'var(--accent)' }}
                    >
                      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setImgModalFiles((prev) => prev.filter((_, ii) => ii !== i)); }}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, fontSize: 14, lineHeight: 1 }}
                        disabled={imgModalStatus === 'uploading'}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              {imgModalError && (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{imgModalError}</p>
              )}

              <button
                type="button"
                className="adminLegacyPrimaryBtn"
                onClick={() => void submitImages()}
                disabled={imgModalStatus === 'uploading' || imgModalFiles.length === 0 || !imgModalDate}
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
