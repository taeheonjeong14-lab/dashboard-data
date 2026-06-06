'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  HEALTH_CHECKUP_DENTAL_SKIN_ROW_MAX_CHARS,
  HEALTH_CHECKUP_LAB_INTERP_MAX_CHARS,
  HEALTH_CHECKUP_MAX_COVER_BREED_CHARS,
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
import { iranSuffix } from '@dashboard/health-report';
import { AdminHealthReportImageSlots, type CaseImageCandidate } from '@/components/admin-health-report-image-slots';
import { CaseImagesSection } from '@/components/admin-run-extraction-detail';
import { AdminRunExtractionDetail } from '@/components/admin-run-extraction-detail';
import { HealthReportPreviewModal } from '@/components/health-report-preview-modal';

const divider = 'var(--border)';
const OVER_MAX_WARNING = ' (최대 글자수를 초과하였습니다. 현재 상태로 보고서를 다운로드할 경우 내용이 잘려 나옵니다.)';

const labelGrid: CSSProperties = { fontSize: 13, display: 'grid', gap: 4 };

// 장기별 '주요 진단 내용'에 자주 쓰는 상용구 — 원클릭으로 입력칸에 채운다.
const DIAGNOSIS_QUICK_PHRASES = [
  '이번 검진 프로그램에 포함되지 않은 영역입니다.',
  '검진 결과 특이사항 발견되지 않았습니다.',
] as const;

// 장기별 '시사점'에 권장하는 보호자 안내 문구 — 블록 제목(titleKo)으로 매칭.
// (제목 띄어쓰기/기호 차이에 견고하도록 공백 제거 후 키워드 포함 검사)
const IMPLICATION_PHRASES: { match: (t: string) => boolean; phrase: string }[] = [
  {
    match: (t) => t.includes('순환') || t.includes('호흡'),
    phrase:
      '검진 결과 특이사항이 발견되진 않았으나, 평소보다 숨소리가 거칠어지거나 호흡이 빨라지고, 기침을 하거나 운동·산책 후 유난히 힘들어하는 모습, 혀·잇몸이 창백하거나 푸르스름해지는 경우가 보이면 바로 내원해 주세요.',
  },
  {
    match: (t) => t.includes('소화'),
    phrase:
      '검진 결과 특이사항이 발견되진 않았으나, 구토나 설사가 반복되거나 식욕이 줄고, 혈변·검은 변이 보이거나 배가 부풀고 체중이 빠지는 모습이 나타나면 바로 내원해 주세요.',
  },
  {
    match: (t) => t.includes('내분비'),
    phrase:
      '검진 결과 특이사항이 발견되진 않았으나, 물을 평소보다 많이 마시고 소변량이 늘거나, 식욕·체중이 뚜렷이 변하고, 털이 빠지거나 기운 없이 처지는 변화가 보이면 바로 내원해 주세요.',
  },
  {
    match: (t) => t.includes('신장') || t.includes('비뇨'),
    phrase:
      '검진 결과 특이사항이 발견되진 않았으나, 소변 횟수나 양이 변하고 혈뇨가 보이거나, 배뇨를 힘들어하고, 물을 많이 마시면서 식욕·기운이 떨어지는 모습이 보이면 바로 내원해 주세요.',
  },
  {
    match: (t) => t.includes('간담'),
    phrase:
      '검진 결과 특이사항이 발견되진 않았으나, 잇몸·눈 흰자·피부가 노랗게 보이거나(황달), 식욕이 떨어지고 구토·무기력이 이어지며 소변 색이 진해지는 변화가 나타나면 바로 내원해 주세요.',
  },
  {
    match: (t) => t.includes('근골'),
    phrase:
      '검진 결과 특이사항이 발견되진 않았으나, 다리를 절뚝거리거나 점프·계단을 꺼리고, 일어설 때 힘들어하거나 특정 부위를 만지면 아파하는 모습, 활동량이 눈에 띄게 줄어드는 변화가 보이면 바로 내원해 주세요.',
  },
  {
    match: (t) => t.includes('치과') || t.includes('안과'),
    phrase:
      '검진 결과 특이사항이 발견되진 않았으나, 입 냄새가 심해지거나 사료를 씹기 힘들어하고, 눈물·눈곱이 늘거나 눈을 자주 비비고 충혈·혼탁이 보이는 경우 바로 내원해 주세요.',
  },
  {
    match: (t) => t.includes('피부') || t.includes('외이'),
    phrase:
      '검진 결과 특이사항이 발견되진 않았으나, 피부를 자주 긁거나 핥고 붉어짐·발진·탈모가 보이거나, 귀에서 냄새·분비물이 나고 머리를 자주 흔드는 모습이 나타나면 바로 내원해 주세요.',
  },
];

function implicationPhraseForTitle(titleKo: string): string | null {
  const t = (titleKo || '').replace(/\s/g, '');
  return IMPLICATION_PHRASES.find((e) => e.match(t))?.phrase ?? null;
}

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

function candidateCategory(c: CaseImageCandidate): string {
  const t = c.examType ?? 'other';
  if (t === 'radiology') {
    const sub: Record<string, string> = {
      thorax: '방사선 (흉부)', abdomen: '방사선 (복부)',
      joint: '방사선 (관절)', dental: '방사선 (치과)',
    };
    return sub[c.radiologySub ?? ''] ?? '방사선';
  }
  const labels: Record<string, string> = {
    ultrasound: '초음파', dental: '치과',
    ophthalmology: '안과', skin: '피부',
  };
  return labels[t] ?? (t === 'other' ? '기타' : t);
}

function groupCandidates(candidates: CaseImageCandidate[]): Array<{ category: string; items: CaseImageCandidate[] }> {
  const map = new Map<string, CaseImageCandidate[]>();
  for (const c of candidates) {
    const cat = candidateCategory(c);
    const list = map.get(cat) ?? [];
    list.push(c);
    map.set(cat, list);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
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
  const [diseaseGenKey, setDiseaseGenKey] = useState<string | null>(null);
  const [diseaseAddText, setDiseaseAddText] = useState<Record<string, string>>({});

  const [imageCandidates, setImageCandidates] = useState<CaseImageCandidate[]>([]);
  const [candidatesRefreshKey, setCandidatesRefreshKey] = useState(0);
  const [imagePickerSlot, setImagePickerSlot] = useState<{
    k: SystemKey; blockIndex: number; slotIndex: number;
  } | null>(null);
  const [modalDragCount, setModalDragCount] = useState(0);
  const [modalUploading, setModalUploading] = useState(false);
  const [previewDropOver, setPreviewDropOver] = useState(false);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [sharePanel, setSharePanel] = useState<{ shareUrl: string; expiresAt: string } | null>(null);
  const [shareReissuing, setShareReissuing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [chartHistoryOpen, setChartHistoryOpen] = useState(false);
  const chartHistoryDialogRef = useRef<HTMLDialogElement>(null);

  const healthItem = useMemo(() => items.find((i) => i.contentType === 'health_checkup') ?? null, [items]);
  const hasContent = healthItem != null;

  const allPlacedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const k of SYSTEM_KEYS) {
      const blocks = getStructuredBlocksFromDraft(draft, k);
      for (const b of blocks) {
        if (isImageVariant(b.variant)) {
          for (const slot of (b as { images: HealthSystemsImageSlot[] }).images) {
            if (slot.src) paths.add(slot.src);
          }
        }
      }
    }
    return paths;
  }, [draft]);


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
      // 병원(hospital-ui)에서 제출한 강조사항을 강조사항 입력란에 pre-fill (admin 편집값은 보존).
      const notes = list.find((i) => i.contentType === 'hospital_notes');
      const emphasis = (notes?.payload as { emphasis_text?: string } | null)?.emphasis_text;
      if (typeof emphasis === 'string' && emphasis.trim()) {
        setMustInclude((prev) => (prev.trim() ? prev : emphasis));
      }
      // 병원 제출 이미지 분류·import + 표시는 아래 CaseImagesSection 이 담당(폴링 포함). 여기서 중복 트리거하지 않는다.
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

  // 장기 1개만 재생성: 같은 페이지 그룹을 생성해 받되, **누른 장기 블록 1개만** draft에 반영한다.
  // 옆 장기·다른 페이지는 그대로 두고, 그 장기의 질환 후보는 이름이 같으면 토글(enabled)·본문(body)을 보존한다.
  async function regenerateOrgan(k: SystemKey, blockIndex: number) {
    const uiKey = `${k}-${blockIndex}`;
    setGeneratingSection(uiKey);
    setGenError(null);
    try {
      const res = await fetch('/api/admin/health-report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          runId,
          contentType: 'health_checkup',
          section: systemKeyToApiSection(k),
          checkupDate: checkupDate.trim(),
          mustInclude: mustInclude.trim().slice(0, HEALTH_CHECKUP_MUST_INCLUDE_MAX_CHARS),
        }),
      });
      const data = (await res.json()) as { error?: string; generated?: Partial<HealthCheckupGeneratedContent> };
      if (!res.ok) throw new Error(data.error ?? `재생성 실패 (${res.status})`);
      const genBlocks = data.generated
        ? parseHealthSystemsBlocksFromUnknown((data.generated as Record<string, unknown>)[k])
        : null;
      const newBlock = genBlocks?.[blockIndex];
      if (!newBlock || newBlock.variant !== 'rows') throw new Error('재생성 결과를 찾지 못했습니다.');
      setDraft((prev) => {
        const cur = getStructuredBlocksFromDraft(prev, k);
        if (cur[blockIndex]?.variant !== 'rows') return prev;
        const next = structuredClone(cur) as HealthSystemsReportBlock[];
        const tgt = next[blockIndex];
        if (tgt.variant !== 'rows') return prev;
        tgt.rows = structuredClone(newBlock.rows);
        // 질환 후보: 새 이름 목록으로 갱신하되, 같은 이름은 토글·본문을 이어받는다.
        const prevOpts = tgt.diseaseOptions ?? [];
        const merged = (newBlock.diseaseOptions ?? []).map((no) => {
          const m = prevOpts.find((po) => po.name === no.name);
          return m ? { ...no, enabled: m.enabled, body: m.body } : no;
        });
        if (merged.length) tgt.diseaseOptions = merged;
        else delete tgt.diseaseOptions;
        return { ...prev, [k]: next };
      });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '재생성 실패');
    } finally {
      setGeneratingSection(null);
    }
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

  // 질환 소개 후보(같은 인쇄 페이지 = 같은 SystemKey 안에서 enabled 1개만 허용)
  const DISEASE_PAGE_GROUP_LABEL: Partial<Record<SystemKey, string>> = {
    systemsPage3Blocks: '순환기&호흡기, 소화기, 내분비계',
    systemsPage3bBlocks: '신장 및 비뇨기계, 간담도계, 근골격계',
    systemsPage4Blocks: '치과 및 안과, 피부와 외이도',
  };

  function patchDiseaseOption(
    k: SystemKey,
    blockIndex: number,
    optIndex: number,
    patch: { name?: string; body?: string; enabled?: boolean },
  ) {
    setDraft((prev) => {
      const cur = getStructuredBlocksFromDraft(prev, k);
      const b0 = cur[blockIndex];
      if (b0?.variant !== 'rows' || !b0.diseaseOptions?.[optIndex]) return prev;
      const nextBlocks = structuredClone(cur) as HealthSystemsReportBlock[];
      const b = nextBlocks[blockIndex];
      if (b.variant !== 'rows' || !b.diseaseOptions) return prev;
      b.diseaseOptions[optIndex] = { ...b.diseaseOptions[optIndex], ...patch };
      return { ...prev, [k]: nextBlocks };
    });
  }

  function addDiseaseOption(k: SystemKey, blockIndex: number, name: string) {
    const n = name.trim().slice(0, 60);
    if (!n) return;
    setDraft((prev) => {
      const cur = getStructuredBlocksFromDraft(prev, k);
      if (cur[blockIndex]?.variant !== 'rows') return prev;
      const nextBlocks = structuredClone(cur) as HealthSystemsReportBlock[];
      const b = nextBlocks[blockIndex];
      if (b.variant !== 'rows') return prev;
      b.diseaseOptions = [...(b.diseaseOptions ?? []), { name: n, body: '', enabled: false }];
      return { ...prev, [k]: nextBlocks };
    });
  }

  function removeDiseaseOption(k: SystemKey, blockIndex: number, optIndex: number) {
    setDraft((prev) => {
      const cur = getStructuredBlocksFromDraft(prev, k);
      if (cur[blockIndex]?.variant !== 'rows') return prev;
      const nextBlocks = structuredClone(cur) as HealthSystemsReportBlock[];
      const b = nextBlocks[blockIndex];
      if (b.variant !== 'rows' || !b.diseaseOptions) return prev;
      b.diseaseOptions = b.diseaseOptions.filter((_, i) => i !== optIndex);
      if (b.diseaseOptions.length === 0) delete b.diseaseOptions;
      return { ...prev, [k]: nextBlocks };
    });
  }

  // 같은 페이지(SystemKey)에서 이미 enabled 된 다른 후보가 있는지.
  function pageHasOtherEnabled(k: SystemKey, blockIndex: number, optIndex: number): boolean {
    const blocks = getStructuredBlocksFromDraft(draft, k);
    return blocks.some(
      (b, bi) =>
        b.variant === 'rows' &&
        (b.diseaseOptions ?? []).some((o, oi) => o.enabled && !(bi === blockIndex && oi === optIndex)),
    );
  }

  async function toggleDiseaseOption(
    k: SystemKey,
    blockIndex: number,
    optIndex: number,
    name: string,
    hasBody: boolean,
    nextEnabled: boolean,
  ) {
    if (nextEnabled && pageHasOtherEnabled(k, blockIndex, optIndex)) {
      setGenError(`${DISEASE_PAGE_GROUP_LABEL[k] ?? '이 페이지의 장기들'}에서는 소개할 질환을 하나만 선택해야 합니다.`);
      return;
    }
    setGenError(null);
    patchDiseaseOption(k, blockIndex, optIndex, { enabled: nextEnabled });
    if (!nextEnabled || hasBody) return;
    // 본문이 없으면 토글 ON 시점에 생성
    const genKey = `${k}-${blockIndex}-${optIndex}`;
    setDiseaseGenKey(genKey);
    try {
      const res = await fetch('/api/admin/health-report/disease-intro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ diseaseName: name, species: draft.coverPatientSpecies ?? '' }),
      });
      const data = (await res.json()) as { body?: string; error?: string };
      if (!res.ok || !data.body) throw new Error(data.error ?? '질환 소개 생성 실패');
      patchDiseaseOption(k, blockIndex, optIndex, { body: data.body });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '질환 소개 생성 실패');
      patchDiseaseOption(k, blockIndex, optIndex, { enabled: false });
    } finally {
      setDiseaseGenKey(null);
    }
  }

  function updateImageSlot(
    k: SystemKey,
    blockIndex: number,
    slotIndex: number,
    patch: { src?: string; caption?: string; rotationDeg?: number },
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
      if ('rotationDeg' in patch) img.rotationDeg = patch.rotationDeg;
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
    return <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중…</p>;
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
        <div style={{ marginBottom: 10, fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
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
        <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{runId}</code>
      </div>

      {sharePanel ? (
        <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--success-subtle)', border: '1px solid var(--success-subtle)', borderRadius: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600, flexShrink: 0 }}>외부 검토 링크</span>
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
          <button
            type="button"
            className="adminLegacySmallBtn"
            disabled={shareReissuing}
            onClick={async () => {
              setShareReissuing(true);
              try {
                const res = await fetch('/api/admin/health-report/review-share', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ runId }),
                });
                const data = (await res.json()) as { shareUrl?: string; expiresAt?: string; error?: string };
                if (!res.ok) throw new Error(data.error ?? '재발급 실패');
                if (data.shareUrl) setSharePanel({ shareUrl: data.shareUrl, expiresAt: data.expiresAt ?? '' });
              } catch (e) {
                window.alert(e instanceof Error ? e.message : '재발급에 실패했습니다.');
              } finally {
                setShareReissuing(false);
              }
            }}
          >
            {shareReissuing ? '재발급 중…' : '재발급'}
          </button>
        </div>
      ) : null}

      {loadError ? (
        <p style={{ color: 'var(--danger)', fontSize: 14 }}>{loadError}</p>
      ) : null}
      {saveError ? (
        <p style={{ color: 'var(--danger)', fontSize: 14 }}>{saveError}</p>
      ) : null}
      {genError ? (
        <p style={{ color: 'var(--danger)', fontSize: 14 }}>{genError}</p>
      ) : null}

      {healthItem ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          마지막 저장 {new Date(healthItem.updatedAt).toLocaleString('ko-KR')}
        </p>
      ) : null}

      {!hasContent ? (
        <section style={{ marginBottom: 20, padding: 16, border: `1px solid ${divider}`, background: 'var(--bg-subtle)' }}>
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
          <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
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
                      coverPatientBreed: clamp(e.target.value, HEALTH_CHECKUP_MAX_COVER_BREED_CHARS),
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
              <p style={{ margin: '6px 0 0', fontSize: 12, color: overallLen > HEALTH_CHECKUP_MAX_OVERALL_CHARS ? 'var(--danger)' : 'var(--warning)' }}>
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
              <p style={{ margin: '6px 0 0', fontSize: 12, color: followLen > HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS ? 'var(--danger)' : 'var(--warning)' }}>
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
                    <p style={{ margin: 0, fontSize: 11, color: cardTitle.length > HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS ? 'var(--danger)' : 'var(--warning)', textAlign: 'right' }}>
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
                    <p style={{ margin: 0, fontSize: 11, color: cardBody.length > HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS ? 'var(--danger)' : 'var(--warning)', textAlign: 'right' }}>
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
                      <button type="button" className="adminLegacySmallBtn" disabled={generatingSection !== null || condensingSection !== null || savingSection !== null} onClick={(e) => { e.preventDefault(); void regenerateOrgan(k, bi); }}>
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
                    {block.rows.map((row, ri) => {
                      const setRowContent = (v: string) => {
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
                      };
                      const isDiagnosisRow = row.label.includes('주요 진단');
                      const implicationPhrase = row.label.includes('시사점')
                        ? implicationPhraseForTitle(block.titleKo)
                        : null;
                      return (
                      <label key={ri} style={{ fontSize: 12, display: 'grid', gap: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                        {isDiagnosisRow && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 2 }}>
                            {DIAGNOSIS_QUICK_PHRASES.map((phrase) => (
                              <button
                                key={phrase}
                                type="button"
                                onClick={() => setRowContent(phrase)}
                                title="클릭하면 이 문구로 입력칸을 채웁니다"
                                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border-strong)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left' }}
                              >
                                + {phrase}
                              </button>
                            ))}
                          </div>
                        )}
                        {implicationPhrase && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 2 }}>
                            <button
                              type="button"
                              onClick={() => setRowContent(implicationPhrase)}
                              title={implicationPhrase}
                              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border-strong)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left' }}
                            >
                              + 특이사항 없는 경우 문구
                            </button>
                          </div>
                        )}
                        <textarea
                          rows={3}
                          style={{ width: '100%', padding: 8, fontSize: 13 }}
                          value={row.content}
                          onChange={(e) => setRowContent(e.target.value)}
                        />
                        <span style={{ fontSize: 11, color: row.content.length > rowMax ? 'var(--danger)' : 'var(--warning)' }}>
                          {row.content.length} / {rowMax}
                          {row.content.length > rowMax ? OVER_MAX_WARNING : ''}
                        </span>
                      </label>
                      );
                    })}
                    {(k === 'systemsPage3Blocks' || k === 'systemsPage3bBlocks' || k === 'systemsPage4Blocks') && (() => {
                      const opts = block.diseaseOptions ?? [];
                      const addKey = `${k}-${bi}`;
                      return (
                        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 10, marginTop: 4, display: 'grid', gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                            질환 소개 박스 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(토글 ON 시 본문 생성 · 페이지당 1개만 ON)</span>
                          </div>
                          {opts.length === 0 && (
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>후보 질환이 없습니다. 아래에서 직접 추가할 수 있어요.</p>
                          )}
                          {opts.map((opt, oi) => {
                            const generating = diseaseGenKey === `${k}-${bi}-${oi}`;
                            return (
                              <div key={oi} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{opt.name}{iranSuffix(opt.name)}?</span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {generating && <span style={{ fontSize: 11, color: 'var(--accent)' }}>생성 중…</span>}
                                    <button
                                      type="button"
                                      disabled={generating}
                                      onClick={() => void toggleDiseaseOption(k, bi, oi, opt.name, opt.body.trim().length > 0, !opt.enabled)}
                                      style={{ fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 999, border: '1px solid', borderColor: opt.enabled ? 'var(--success)' : 'var(--border-strong)', background: opt.enabled ? 'var(--success)' : 'var(--bg-subtle)', color: opt.enabled ? '#fff' : 'var(--text-secondary)', cursor: 'pointer' }}
                                    >
                                      {opt.enabled ? 'ON' : 'OFF'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeDiseaseOption(k, bi, oi)}
                                      title="후보 삭제"
                                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid var(--danger-subtle)', background: 'var(--danger-subtle)', color: 'var(--danger)', cursor: 'pointer' }}
                                    >
                                      삭제
                                    </button>
                                  </div>
                                </div>
                                {opt.enabled && (
                                  <div>
                                    <textarea rows={3} style={{ width: '100%', padding: 8, fontSize: 13 }} maxLength={200} value={opt.body} onChange={(e) => patchDiseaseOption(k, bi, oi, { body: e.target.value })} />
                                    <span style={{ fontSize: 11, color: opt.body.length > 250 ? 'var(--danger)' : 'var(--text-muted)' }}>
                                      {opt.body.length} / 200{opt.body.length > 200 ? OVER_MAX_WARNING : ''}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              type="text"
                              placeholder="질환 직접 추가"
                              maxLength={60}
                              value={diseaseAddText[addKey] ?? ''}
                              onChange={(e) => setDiseaseAddText((m) => ({ ...m, [addKey]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addDiseaseOption(k, bi, diseaseAddText[addKey] ?? '');
                                  setDiseaseAddText((m) => ({ ...m, [addKey]: '' }));
                                }
                              }}
                              style={{ flex: 1, padding: 6, fontSize: 12 }}
                            />
                            <button
                              type="button"
                              className="adminLegacySmallBtn"
                              onClick={() => {
                                addDiseaseOption(k, bi, diseaseAddText[addKey] ?? '');
                                setDiseaseAddText((m) => ({ ...m, [addKey]: '' }));
                              }}
                            >
                              추가
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                    {(() => {
                      const imgBlock = blocks[bi + 1];
                      if (!imgBlock || !isImageVariant(imgBlock.variant)) return null;
                      const slots = (imgBlock as { images: HealthSystemsImageSlot[] }).images;
                      return (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 8 }}>
                            이미지 ({slots.length}장)
                          </div>
                          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                            {slots.map((slot, si) => {
                              const src = slot.src ?? '';
                              const candidate = imageCandidates.find((c) => c.storagePath === src);
                              const previewUrl = candidate?.previewUrl;
                              const rotDeg = slot.rotationDeg ?? 0;
                              return (
                                <div key={si} style={{ border: `1px dashed ${divider}`, borderRadius: 6, padding: 8, background: '#fff' }}>
                                  <div
                                    style={{ cursor: 'pointer', borderRadius: 4, overflow: 'hidden' }}
                                    onClick={() => setImagePickerSlot({ k, blockIndex: bi + 1, slotIndex: si })}
                                  >
                                    {previewUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img alt="" src={previewUrl} style={{ width: '100%', maxHeight: 80, objectFit: 'cover', display: 'block', transform: `rotate(${rotDeg}deg)`, transition: 'transform 0.25s' }} />
                                    ) : src ? (
                                      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 0', wordBreak: 'break-all' }}>{src.split('/').pop()}</div>
                                    ) : (
                                      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border-strong)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 20, lineHeight: 1 }}>
                                        +
                                      </div>
                                    )}
                                  </div>
                                  <input
                                    style={{ width: '100%', marginTop: 6, fontSize: 11, padding: 4 }}
                                    placeholder="캡션"
                                    value={slot.caption ?? ''}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => updateImageSlot(k, bi + 1, si, { caption: e.target.value })}
                                  />
                                  {src ? (
                                    <button
                                      type="button"
                                      style={{ display: 'block', width: '100%', marginTop: 6, padding: '4px 0', fontSize: 11, background: '#fff', color: 'var(--danger)', border: '1px dashed var(--danger)', borderRadius: 4, cursor: 'pointer' }}
                                      onClick={(e) => { e.stopPropagation(); updateImageSlot(k, bi + 1, si, { src: undefined, caption: '', rotationDeg: 0 }); }}
                                    >
                                      이미지 삭제
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
              <p style={{ margin: '6px 0 0', fontSize: 12, color: (draft.labInterpretation ?? '').length > HEALTH_CHECKUP_LAB_INTERP_MAX_CHARS ? 'var(--danger)' : 'var(--warning)' }}>
                {(draft.labInterpretation ?? '').length} / {HEALTH_CHECKUP_LAB_INTERP_MAX_CHARS}
                {(draft.labInterpretation ?? '').length > HEALTH_CHECKUP_LAB_INTERP_MAX_CHARS ? OVER_MAX_WARNING : ''}
              </p>
            </div>
          </details>

          <div style={{ display: 'none' }}>
            <AdminHealthReportImageSlots
              runId={runId}
              page4Raw={draft.systemsPage4Blocks}
              page5Raw={draft.systemsPage5Blocks}
              onChangePage4={(blocks) => setDraft((d) => ({ ...d, systemsPage4Blocks: blocks }))}
              onChangePage5={(blocks) => setDraft((d) => ({ ...d, systemsPage5Blocks: blocks }))}
              hideSlots
              refreshKey={candidatesRefreshKey}
              onCandidatesLoaded={(c) => setImageCandidates(c)}
            />
          </div>

          <CaseImagesSection runId={runId} />

        {imagePickerSlot !== null && (() => {
          const { k: pk, blockIndex: pbi, slotIndex: psi } = imagePickerSlot;
          const pickerBlocks = getStructuredBlocksFromDraft(draft, pk);
          const pickerImgBlock = pickerBlocks[pbi];
          const pickerSlot = (pickerImgBlock && isImageVariant(pickerImgBlock.variant))
            ? (pickerImgBlock as { images: HealthSystemsImageSlot[] }).images[psi]
            : undefined;
          const currentSrc = pickerSlot?.src ?? '';
          const currentCaption = pickerSlot?.caption ?? '';
          const currentRotation = pickerSlot?.rotationDeg ?? 0;
          const previewCandidate = imageCandidates.find((c) => c.storagePath === currentSrc);
          const previewUrl = previewCandidate?.previewUrl;
          const grouped = groupCandidates(imageCandidates);
          const isDragOver = modalDragCount > 0;

          async function handleModalDrop(e: React.DragEvent) {
            e.preventDefault();
            setModalDragCount(0);
            const files = Array.from(e.dataTransfer.files).filter((f) =>
              ['image/jpeg', 'image/png', 'image/webp'].includes(f.type.toLowerCase()),
            );
            if (files.length === 0) return;
            setModalUploading(true);
            try {
              const form = new FormData();
              form.append('mode', 'append');
              for (const f of files) form.append('images', f);
              const res = await fetch(`/api/admin/runs/${runId}/case-images`, {
                method: 'POST',
                body: form,
                credentials: 'include',
              });
              const d = (await res.json()) as { error?: string };
              if (!res.ok) { alert(d.error ?? '업로드 실패'); return; }
              setCandidatesRefreshKey((n) => n + 1);
            } catch {
              alert('업로드 중 오류가 발생했습니다.');
            } finally {
              setModalUploading(false);
            }
          }

          return (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
              onClick={() => setImagePickerSlot(null)}
            >
              <div
                style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(92vw, 860px)', maxHeight: '88vh', overflowY: 'auto', display: 'grid', gap: 16, position: 'relative', outline: isDragOver ? '3px dashed var(--accent)' : 'none' }}
                onClick={(e) => e.stopPropagation()}
                onDragEnter={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setModalDragCount((n) => n + 1); }}
                onDragLeave={(e) => { if (e.dataTransfer.types.includes('Files')) setModalDragCount((n) => Math.max(0, n - 1)); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { void handleModalDrop(e); }}
              >
                {/* 드래그 오버레이 */}
                {isDragOver && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(59,130,246,0.12)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none' }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>이미지를 여기에 놓으세요</span>
                  </div>
                )}
                {/* 업로드 중 오버레이 */}
                {modalUploading && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.75)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                    <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>업로드 중...</span>
                  </div>
                )}
                {/* 헤더 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>이미지 선택</span>
                  <button type="button" className="adminLegacySmallBtn" onClick={() => setImagePickerSlot(null)}>저장 및 배치 완료</button>
                </div>

                {/* 상단 패널: 좌 - 미리보기 / 우 - 캡션·회전·삭제 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                  <div
                    style={{ background: previewDropOver ? 'var(--accent-subtle)' : 'var(--bg-subtle)', borderRadius: 8, minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: previewDropOver ? '2px dashed var(--accent)' : '2px dashed transparent', transition: 'background 0.15s, border-color 0.15s' }}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={(e) => { e.preventDefault(); setPreviewDropOver(true); }}
                    onDragLeave={() => setPreviewDropOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setPreviewDropOver(false);
                      const path = e.dataTransfer.getData('text/plain');
                      if (path) updateImageSlot(pk, pbi, psi, { src: path });
                    }}
                  >
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        src={previewUrl}
                        draggable={false}
                        style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', transform: `rotate(${currentRotation}deg)`, transition: 'transform 0.25s' }}
                      />
                    ) : (
                      <div style={{ textAlign: 'center', color: previewDropOver ? 'var(--accent)' : 'var(--text-muted)', padding: 16 }}>
                        <div style={{ fontSize: 32, lineHeight: 1, marginBottom: 8 }}>+</div>
                        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                          {previewDropOver ? '여기에 놓기' : <><span>원하시는 사진을</span><br /><span>드래그앤 드랍 해주세요</span></>}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                    <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>캡션</span>
                      <textarea
                        rows={4}
                        placeholder="이미지 캡션 입력"
                        value={currentCaption}
                        maxLength={10}
                        onChange={(e) => updateImageSlot(pk, pbi, psi, { caption: e.target.value })}
                        style={{ width: '100%', padding: 8, fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', resize: 'vertical', boxSizing: 'border-box' }}
                      />
                      <span style={{ fontSize: 11, color: currentCaption.length >= 10 ? 'var(--danger)' : 'var(--text-muted)', textAlign: 'right' }}>
                        {currentCaption.length} / 10
                      </span>
                    </label>
                    <button
                      type="button"
                      className="adminLegacySmallBtn"
                      disabled={!currentSrc}
                      onClick={() => updateImageSlot(pk, pbi, psi, { rotationDeg: (currentRotation + 90) % 360 })}
                    >
                      90° 회전
                    </button>
                    {currentSrc && (
                      <button
                        type="button"
                        style={{ padding: '5px 0', fontSize: 12, background: '#fff', color: 'var(--danger)', border: '1px dashed var(--danger)', borderRadius: 4, cursor: 'pointer' }}
                        onClick={() => updateImageSlot(pk, pbi, psi, { src: undefined, caption: '', rotationDeg: 0 })}
                      >
                        이미지 삭제
                      </button>
                    )}
                  </div>
                </div>

                {/* 카테고리별 후보 그리드 */}
                {imageCandidates.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                    후보 이미지가 없습니다. 이미지 추가 분석 탭에서 사진을 먼저 업로드해 주세요.
                  </p>
                ) : grouped.map(({ category, items }) => (
                  <div key={category}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>{category}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {items.map((c) => {
                        const isSelected = !!c.storagePath && c.storagePath === currentSrc;
                        const isPlaced = !!c.storagePath && allPlacedPaths.has(c.storagePath);
                        return (
                          <div
                            key={c.id}
                            draggable={!!c.storagePath}
                            onDragStart={(e) => { if (c.storagePath) { e.dataTransfer.setData('text/plain', c.storagePath); e.dataTransfer.effectAllowed = 'copy'; } }}
                            onClick={() => { if (c.storagePath) updateImageSlot(pk, pbi, psi, { src: c.storagePath }); }}
                            style={{
                              width: 110, cursor: 'grab', borderRadius: 8, overflow: 'hidden', position: 'relative',
                              border: isSelected ? '3px solid var(--success)' : isPlaced ? '3px solid var(--warning)' : '1px solid var(--border)',
                              boxSizing: 'border-box',
                            }}
                          >
                            {isPlaced && !isSelected && (
                              <div style={{ position: 'absolute', top: 4, right: 4, background: 'var(--warning)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 4, lineHeight: 1.4, zIndex: 1 }}>
                                배치 완료
                              </div>
                            )}
                            {c.previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img alt="" src={c.previewUrl} draggable={false} style={{ width: '100%', height: 84, objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                            ) : (
                              <div style={{ height: 84, background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)' }}>미리보기 없음</div>
                            )}
                            <div style={{ padding: '4px 6px', fontSize: 9, color: 'var(--text-muted)', wordBreak: 'break-all', lineHeight: 1.3 }}>
                              {c.examDate ? c.examDate + ' ' : ''}{(c.fileName ?? '').split('/').pop()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
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
