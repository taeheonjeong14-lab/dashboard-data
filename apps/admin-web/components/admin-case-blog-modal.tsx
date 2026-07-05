'use client';

import { useState, useRef, useEffect, type CSSProperties } from 'react';
import Link from 'next/link';

// ── 타입 ──────────────────────────────────────────────────────────────────
type StepNum = 1 | 2 | 3 | 4 | 5;
type OverviewItem = { label: string; value: string };
// 액션 1개 = 한 행위(무엇을 했나) + 그 이유(왜) + 도출 결과. UI에서 카드 하나.
type Action = { what: string; why: string; result: string };
// types: 한 날짜에 여러 성격이 붙을 수 있음(검사/진단/술 전 검사/외과/내과).
type Phase = { id: string; name: string; period: string; types: string[]; actions: Action[]; nextStep: string[] };
type CausalFlow = { axis: string; anesthesia: boolean; phases: Phase[] };
// 2단계 — 진단·치료 세부 흐름
type DiagStep = { name: string; why: string; what: string; result: string; fromChart: boolean };
type TreatStep = { step: string; why: string; detail: string; fromChart: boolean };
type TreatProcedure = { id: string; name: string; steps: TreatStep[] };
type DetailFlow = { diagnosis: { steps: DiagStep[] }; treatment: { type: string; procedures: TreatProcedure[] } };
type Section = { id: string; label: string; period: string; points: string[]; facts: string[]; imageFileNames: string[] };
type CaseImg = { fileName: string; signedUrl: string | null; caption: string };
type OverviewCheck = { item: string; reflectedIn: string };
type Outline = { title_candidates: string[]; sections: Section[]; overviewCheck: OverviewCheck[] };
type BlogPost = { title: string; bodyMarkdown: string; tags: string[]; charCount: number };

// ── 스타일 ────────────────────────────────────────────────────────────────
const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
};
const cardStyle: CSSProperties = {
  background: 'var(--bg-subtle)', borderRadius: 12, width: 'min(1680px, 96vw)',
  maxHeight: '94vh', display: 'flex', flexDirection: 'column', padding: 0,
  boxShadow: '0 10px 40px rgba(0,0,0,0.18)',
};
const btnPrimary: CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8,
  background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', cursor: 'pointer',
};
const btnSecondary: CSSProperties = {
  padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8,
  background: '#fff', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', cursor: 'pointer',
};
const btnTiny: CSSProperties = {
  padding: '2px 7px', fontSize: 11, fontWeight: 600, borderRadius: 5,
  background: '#fff', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', cursor: 'pointer',
};
const fieldLabel: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '-0.01em' };
const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13, lineHeight: 1.5,
  border: '1px solid var(--border)', borderRadius: 6, background: '#fff', color: 'var(--text)',
  outline: 'none', boxSizing: 'border-box', resize: 'vertical', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
};
const cardBox: CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' };
const actionBox: CSSProperties = { background: 'var(--bg-subtle)', border: '1px solid #a3e635', borderRadius: 8, padding: '10px 12px' };
const actionWhatColor = '#65a30d'; // '무엇을 했나' 강조 연두
// 읽기 전용 뷰의 '왜/결과' 인라인 라벨.
const viewMiniLabel: CSSProperties = { flexShrink: 0, fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', minWidth: 30 };
// 성격 해시태그 칩(선택 on/off): 선택 시 파란 테두리 + 반투명 파랑 배경.
function hashChip(on: boolean): CSSProperties {
  return {
    padding: '4px 11px', fontSize: 12, fontWeight: 700, borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
    background: on ? 'rgba(49, 130, 246, 0.14)' : '#fff',
    color: on ? 'var(--accent)' : 'var(--text-muted)',
    transition: 'all 0.1s ease',
  };
}
// 날짜별 다시 생성 입력 모달.
const regenOverlay: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const regenDialog: CSSProperties = {
  background: '#fff', borderRadius: 12, padding: '18px 20px', width: 'min(480px, 100%)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
};

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const toLines = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v.trim() ? [v] : [];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// phase 를 { actions, nextStep } 로 정규화. 새 구조(actions/nextStep)면 그대로,
// 옛 구조(what[]/why[]/toNext[])면 자동 변환: what[i]↔why[i] 를 액션으로 짝짓고, toNext 는 nextStep 으로.
function asActionsAndNext(x: Record<string, unknown>): { actions: Action[]; nextStep: string[] } {
  if (Array.isArray(x.actions)) {
    const actions = x.actions.map((a) => {
      const y = (a ?? {}) as Record<string, unknown>;
      return { what: str(y.what), why: str(y.why), result: str(y.result) };
    });
    return { actions, nextStep: toLines(x.nextStep) };
  }
  // 옛 구조 변환
  const whats = toLines(x.what);
  const whys = toLines(x.why);
  const actions: Action[] = whats.map((w, i) => ({ what: w, why: whys[i] ?? '', result: '' }));
  // what 이 없는데 why 만 있으면(드묾) 이유들만이라도 액션으로 보존
  if (actions.length === 0 && whys.length > 0) {
    for (const w of whys) actions.push({ what: '', why: w, result: '' });
  }
  return { actions, nextStep: toLines(x.toNext) };
}

function asPhase(raw: unknown): Phase {
  const x = (raw ?? {}) as Record<string, unknown>;
  // types(신규) 우선, 없으면 type(옛 단일값) 변환.
  const types = normTypes(x.types ?? x.type);
  return {
    id: str(x.id) || `phase_${uid()}`,
    name: str(x.name), period: str(x.period),
    types,
    ...asActionsAndNext(x),
  };
}

function asCausal(raw: unknown): CausalFlow {
  const o = (raw ?? {}) as Record<string, unknown>;
  const phases = Array.isArray(o.phases) ? o.phases : [];
  return {
    axis: str(o.axis),
    anesthesia: o.anesthesia === true,
    phases: phases.map(asPhase),
  };
}
function asOutline(raw: unknown): Outline {
  const o = (raw ?? {}) as Record<string, unknown>;
  const sections = Array.isArray(o.sections) ? o.sections : [];
  const checks = Array.isArray(o.overviewCheck) ? o.overviewCheck : [];
  return {
    title_candidates: toLines(o.title_candidates),
    sections: sections.map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      return { id: str(x.id) || `sec_${uid()}`, label: str(x.label), period: str(x.period), points: toLines(x.points), facts: toLines(x.facts), imageFileNames: toLines(x.imageFileNames) };
    }),
    overviewCheck: checks.map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      return { item: str(x.item), reflectedIn: str(x.reflectedIn) };
    }),
  };
}
function asBlog(raw: unknown): BlogPost {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    title: str(o.title), bodyMarkdown: str(o.bodyMarkdown),
    tags: toLines(o.tags), charCount: typeof o.charCount === 'number' ? o.charCount : 0,
  };
}
function asDetail(raw: unknown): DetailFlow {
  const o = (raw ?? {}) as Record<string, unknown>;
  const diag = (o.diagnosis ?? {}) as Record<string, unknown>;
  const treat = (o.treatment ?? {}) as Record<string, unknown>;
  const dSteps = Array.isArray(diag.steps) ? diag.steps : [];
  const procs = Array.isArray(treat.procedures) ? treat.procedures : [];
  const tt = str(treat.type);
  return {
    diagnosis: {
      steps: dSteps.map((s) => {
        const x = (s ?? {}) as Record<string, unknown>;
        return { name: str(x.name), why: str(x.why), what: str(x.what), result: str(x.result), fromChart: x.fromChart === true };
      }),
    },
    treatment: {
      type: tt === 'surgical' || tt === 'medical' || tt === 'complex' ? tt : 'medical',
      procedures: procs.map((p) => {
        const x = (p ?? {}) as Record<string, unknown>;
        const steps = Array.isArray(x.steps) ? x.steps : [];
        return {
          id: str(x.id) || `proc_${uid()}`,
          name: str(x.name),
          steps: steps.map((st) => {
            const y = (st ?? {}) as Record<string, unknown>;
            return { step: str(y.step), why: str(y.why), detail: str(y.detail), fromChart: y.fromChart === true };
          }),
        };
      }),
    },
  };
}
function diffDetail(prev: DetailFlow, next: DetailFlow): string[] {
  const changes: string[] = [];
  if (JSON.stringify(prev.diagnosis) !== JSON.stringify(next.diagnosis)) changes.push('진단 과정 세부');
  if (prev.treatment.type !== next.treatment.type) changes.push('치료 유형');
  if (JSON.stringify(prev.treatment.procedures) !== JSON.stringify(next.treatment.procedures)) changes.push('치료 과정 세부');
  return changes;
}
// 날짜 성격(해시태그). 여러 개 선택 가능.
const PHASE_TYPE_LABEL: Record<string, string> = {
  exam_dx: '검사 및 진단', preop: '술 전 검사', surgical: '외과 치료', medical: '내과 치료', admission: '입원 치료', discharge: '퇴원',
};
const PHASE_TYPE_ORDER = ['exam_dx', 'preop', 'surgical', 'medical', 'admission', 'discharge'];
// 옛 값 → 신규 키 매핑(검사/진단 → 검사 및 진단으로 통합).
const LEGACY_TYPE_MAP: Record<string, string> = { diagnostic: 'exam_dx', diagnosis: 'exam_dx' };
// 외과·내과는 한 날짜에 하나만(상호 배타). 둘 다면 외과 우선.
function resolveExclusiveTypes(types: string[]): string[] {
  return types.includes('surgical') && types.includes('medical') ? types.filter((x) => x !== 'medical') : types;
}
// 옛 값 정규화 + 유효값만 + 상호 배타 정리.
function normTypes(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [];
  const out = arr.map((x) => { const s = String(x).trim(); return LEGACY_TYPE_MAP[s] ?? s; }).filter((x) => x in PHASE_TYPE_LABEL);
  return resolveExclusiveTypes([...new Set(out)]);
}
const TREAT_TYPE_LABEL: Record<string, string> = { surgical: '수술형', medical: '내과형', complex: '복합형' };

// 변경된 부분을 사람이 읽을 수 있는 목록으로 — 재생성 확인창에 표시.
const arrEq = (a: string[], b: string[]): boolean => a.join('') === b.join('');
const actionsKey = (a: Action[]): string => a.map((x) => `${x.what}|${x.why}|${x.result}`).join('§');
function diffCausal(prev: CausalFlow, next: CausalFlow): string[] {
  const changes: string[] = [];
  if (prev.axis !== next.axis) changes.push('흐름의 축');
  if (prev.anesthesia !== next.anesthesia) changes.push('마취 동반 여부');
  const n = Math.max(prev.phases.length, next.phases.length);
  for (let i = 0; i < n; i++) {
    const a = prev.phases[i]; const b = next.phases[i];
    if (a && !b) { changes.push(`단계 ${i + 1} 삭제`); continue; }
    if (!a && b) { changes.push(`단계 ${i + 1} 추가${b.name ? ` (${b.name})` : ''}`); continue; }
    if (!a || !b) continue;
    const sub: string[] = [];
    if (a.name !== b.name) sub.push('단계명');
    if (a.period !== b.period) sub.push('날짜');
    if (a.types.join(',') !== b.types.join(',')) sub.push('성격');
    if (actionsKey(a.actions) !== actionsKey(b.actions)) sub.push('행위(무엇/왜/결과)');
    if (!arrEq(a.nextStep, b.nextStep)) sub.push('Next step');
    if (sub.length) changes.push(`${b.period || b.name || `단계 ${i + 1}`}: ${sub.join(', ')}`);
  }
  return changes;
}
function diffOutline(prev: Outline, next: Outline): string[] {
  const changes: string[] = [];
  if (!arrEq(prev.title_candidates, next.title_candidates)) changes.push('제목 후보');
  const n = Math.max(prev.sections.length, next.sections.length);
  for (let i = 0; i < n; i++) {
    const a = prev.sections[i]; const b = next.sections[i];
    if (a && !b) { changes.push(`섹션 ${i + 1} 삭제`); continue; }
    if (!a && b) { changes.push(`섹션 ${i + 1} 추가${b.label ? ` (${b.label})` : ''}`); continue; }
    if (!a || !b) continue;
    const sub: string[] = [];
    if (a.label !== b.label) sub.push('섹션명');
    if (!arrEq(a.points, b.points)) sub.push('요점');
    if (!arrEq(a.facts, b.facts)) sub.push('팩트');
    if (sub.length) changes.push(`섹션 ${i + 1}${b.label ? `(${b.label})` : ''}: ${sub.join(', ')}`);
  }
  return changes;
}
function confirmRegen(title: string, changes: string[], question: string): boolean {
  const list = changes.length ? `\n\n변경된 부분:\n${changes.map((c) => `• ${c}`).join('\n')}` : '';
  return window.confirm(`${title}${list}\n\n${question}\n(취소하면 기존 내용을 그대로 보여줍니다.)`);
}

// ── 작은 컴포넌트 ───────────────────────────────────────────────────────────
function LabeledTextarea({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <span style={fieldLabel}>{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} style={inputStyle} />
    </div>
  );
}

// 내용 높이에 맞춰 자동으로 늘어나는 textarea (글자가 길어도 한눈에 다 보이게).
function AutoTextarea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  }, [value]);
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <span style={fieldLabel}>{label}</span>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={1}
        style={{ ...inputStyle, background: '#fff', overflow: 'hidden', resize: 'none', minHeight: 34 }}
      />
    </div>
  );
}

/**
 * 진료케이스 작성 — 3단계 위저드.
 * 1) 인과 흐름(causalFlow) → 2) 섹션 아웃라인(outline) → 3) 블로그 글(blogPost).
 * 각 단계는 검수·수정 → 저장(DB) → 다음 단계 입력으로 전달.
 */
export function CaseBlogButton({
  runId,
  label = '진료케이스 작성',
  triggerStyle,
  onClose,
}: {
  runId: string;
  label?: string;
  triggerStyle?: CSSProperties;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<StepNum>(1);
  const [caseOverview, setCaseOverview] = useState<OverviewItem[]>([]);
  const [causal, setCausal] = useState<CausalFlow | null>(null);
  const [detail, setDetail] = useState<DetailFlow | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [blog, setBlog] = useState<BlogPost | null>(null);
  const [caseImages, setCaseImages] = useState<CaseImg[]>([]); // 파일명→signedUrl (섹션 썸네일용)
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  // 하위 단계가 "어떤 입력으로" 생성됐는지 서명(JSON). 입력이 바뀌면 재생성 확인을 띄운다.
  const [detailBasis, setDetailBasis] = useState(''); // detail 을 만든 causal 의 서명
  const [outlineBasis, setOutlineBasis] = useState(''); // outline 을 만든 {causal, detail} 의 서명
  const [blogBasis, setBlogBasis] = useState(''); // blog 를 만든 outline 의 서명

  const [genLoading, setGenLoading] = useState<null | 1 | 2 | 3 | 4 | 5>(null);
  const [phaseBusy, setPhaseBusy] = useState<number | null>(null); // 날짜별 다시 생성 중인 phase 인덱스
  const [confirmed, setConfirmed] = useState(false); // 블로그 글 확정됨(AI 재생성 불가)
  const [savedFlag, setSavedFlag] = useState(false);  // 네이버 저장완료 — 수기 수정 시 보존(상태 되돌림 방지)
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState('');

  const busy = genLoading !== null || saving;

  // ── API ──
  async function callGenerate(body: Record<string, unknown>) {
    const res = await fetch('/api/admin/health-report/generate', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, ...body }),
    });
    const data = (await res.json()) as { error?: string; generated?: Record<string, unknown> };
    if (!res.ok) throw new Error(data.error ?? '생성 실패');
    return data.generated ?? {};
  }
  async function callSave(contentType: string, payload: unknown) {
    const res = await fetch('/api/admin/health-report/content', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, contentType, payload }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? '저장 실패');
  }

  async function genCausal() {
    setGenLoading(1); setError(null); setSavedMsg('');
    try {
      const g = await callGenerate({ contentType: 'blog_causal' });
      setCausal(asCausal(g.causalFlow));
      if (Array.isArray(g.caseOverview)) setCaseOverview(g.caseOverview as OverviewItem[]);
      setLoadedRunId(runId);
    } catch (e) { setError(e instanceof Error ? e.message : '인과 흐름 생성 실패'); }
    finally { setGenLoading(null); }
  }

  async function loadAll() {
    setGenLoading(1); setError(null); setSavedMsg('');
    try {
      const res = await fetch(`/api/admin/health-report/content?runId=${encodeURIComponent(runId)}`, { credentials: 'include' });
      const data = (await res.json()) as { items?: { contentType?: string; payload?: unknown }[] };
      const items = res.ok ? data.items ?? [] : [];
      const find = (t: string) => items.find((i) => i.contentType === t)?.payload as Record<string, unknown> | undefined;
      const cP = find('blog_causal'); const dP = find('blog_detail'); const oP = find('blog_outline'); const bP = find('blog_post');
      let ov: OverviewItem[] = [];
      if (cP && Array.isArray(cP.caseOverview)) ov = cP.caseOverview as OverviewItem[];
      else if (dP && Array.isArray(dP.caseOverview)) ov = dP.caseOverview as OverviewItem[];
      else if (oP && Array.isArray(oP.caseOverview)) ov = oP.caseOverview as OverviewItem[];
      if (ov.length) setCaseOverview(ov);

      const hasCausal = cP && cP.causalFlow;
      const normCausal = hasCausal ? asCausal(cP!.causalFlow) : null;
      const normDetail = dP && dP.detailFlow ? asDetail(dP.detailFlow) : null;
      const normOutline = oP && oP.outline ? asOutline(oP.outline) : null;
      const normBlog = bP && (bP.bodyMarkdown || bP.title) ? asBlog(bP) : null;
      if (normCausal) setCausal(normCausal);
      if (normDetail) setDetail(normDetail);
      if (normOutline) setOutline(normOutline);
      if (normBlog) setBlog(normBlog);
      setConfirmed(Boolean(bP?.confirmed));
      setSavedFlag(Boolean(bP?.saved));
      // 저장된 단계는 서로 일관됐다고 보고 서명을 맞춰둔다(불필요한 재생성 확인 방지).
      if (normCausal && normDetail) setDetailBasis(JSON.stringify(normCausal));
      if (normCausal && normOutline) setOutlineBasis(JSON.stringify({ causal: normCausal, detail: normDetail }));
      if (normOutline && normBlog) setBlogBasis(JSON.stringify(normOutline));
      setLoadedRunId(runId);

      if (bP && (bP.bodyMarkdown || bP.title)) setStep(4);
      else if (oP && oP.outline) setStep(3);
      else if (normDetail) setStep(2);
      else if (hasCausal) setStep(1);
      else { await genCausal(); return; } // 저장된 게 없으면 1단계 생성
      setGenLoading(null);
    } catch {
      // 로드 실패 → 생성으로 폴백
      await genCausal();
    }
  }

  // 2단계 — 진단·치료 세부 흐름. 입력=검수된 causalFlow.
  async function genDetail() {
    if (!causal) return;
    setGenLoading(2); setError(null); setSavedMsg('');
    try {
      await callSave('blog_causal', { causalFlow: causal, caseOverview }); // 검수본 저장 후 다음 단계 입력
      const g = await callGenerate({ contentType: 'blog_detail', causalFlow: causal });
      setDetail(asDetail(g.detailFlow));
      setDetailBasis(JSON.stringify(causal));
      setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : '진단·치료 세부 흐름 생성 실패'); }
    finally { setGenLoading(null); }
  }

  // 3단계 — 섹션 아웃라인. 입력=검수된 causalFlow + detailFlow(둘 다).
  async function genOutline() {
    if (!causal) return;
    setGenLoading(3); setError(null); setSavedMsg('');
    try {
      if (detail) await callSave('blog_detail', { detailFlow: detail, caseOverview });
      const g = await callGenerate({ contentType: 'blog_outline', causalFlow: causal, detailFlow: detail });
      setOutline(asOutline(g.outline));
      setOutlineBasis(JSON.stringify({ causal, detail }));
      setStep(3);
    } catch (e) { setError(e instanceof Error ? e.message : '아웃라인 생성 실패'); }
    finally { setGenLoading(null); }
  }

  // 4단계 — 블로그 글. 입력=검수된 outline.
  async function genBlog() {
    if (!outline) return;
    setGenLoading(4); setError(null); setSavedMsg('');
    try {
      await callSave('blog_outline', { outline, caseOverview });
      const g = await callGenerate({ contentType: 'blog_post', outline });
      setBlog(asBlog(g));
      setBlogBasis(JSON.stringify(outline));
      setStep(4);
    } catch (e) { setError(e instanceof Error ? e.message : '블로그 글 작성 실패'); }
    finally { setGenLoading(null); }
  }

  // 5단계 — 진단 기반 섹션별 이미지 배정(비전). 결과를 아웃라인 imageFileNames 에 반영·저장.
  async function genImages() {
    if (!outline) return;
    setGenLoading(5); setError(null); setSavedMsg('');
    try {
      const sections = outline.sections.map((s) => ({
        id: s.id,
        label: s.label,
        keyText: [...s.points, ...s.facts].join(' '),
      }));
      const finalDiagnosis = caseOverview.find((o) => o.label === '주질환명')?.value ?? '';
      const contextText = caseOverview
        .filter((o) => ['내원 배경', '진단 방식', '환자 특이사항'].includes(o.label) && o.value)
        .map((o) => `${o.label}: ${o.value}`)
        .join('\n');
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-blog-images`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections, finalDiagnosis, contextText }),
      });
      const data = (await res.json()) as { error?: string; assignments?: { sectionId: string; fileNames: string[] }[] };
      if (!res.ok) throw new Error(data.error ?? '이미지 분석 실패');
      const byId = new Map((data.assignments ?? []).map((a) => [a.sectionId, a.fileNames]));
      const newOutline: Outline = { ...outline, sections: outline.sections.map((s) => ({ ...s, imageFileNames: byId.get(s.id) ?? [] })) };
      setOutline(newOutline);
      await callSave('blog_outline', { outline: newOutline, caseOverview });
      setSavedMsg('이미지 배정 완료');
    } catch (e) { setError(e instanceof Error ? e.message : '이미지 분석 실패'); }
    finally { setGenLoading(null); }
  }

  // 블로그 글 확정 — 확인 후 잠금(AI 재생성 불가), 4단계로 이동하며 이미지 분석 1회 실행.
  async function confirmBlog() {
    if (!blog) return;
    if (!window.confirm('블로그글 확정 이후에는 수기 수정만 가능하며 AI 재생성은 불가합니다.\n\n확정할까요?')) return;
    setSaving(true); setError(null); setSavedMsg('');
    try {
      await callSave('blog_post', { ...blog, confirmed: true, saved: savedFlag });
      setConfirmed(true);
      setStep(5);
    } catch (e) { setError(e instanceof Error ? e.message : '확정 실패'); setSaving(false); return; }
    setSaving(false);
    void genImages();
  }

  // 다음 단계로: 이미 생성된 게 있으면 유지(이동만), 이전 단계가 바뀐 경우에만 재생성 확인.
  function nextFromCausal() {
    if (!causal) return;
    if (confirmed) { setStep(2); setSavedMsg(''); return; } // 확정 후엔 재생성 없이 이동만
    if (!detail) { void genDetail(); return; } // 처음이면 생성
    if (JSON.stringify(causal) === detailBasis) { setStep(2); setSavedMsg(''); return; } // 안 바뀜 → 이동만
    let changes: string[] = [];
    try { if (detailBasis) changes = diffCausal(asCausal(JSON.parse(detailBasis)), causal); } catch { /* noop */ }
    if (confirmRegen('인과 흐름이 변경되었습니다.', changes, '진단·치료 세부 흐름을 다시 생성할까요?')) void genDetail();
    else { setStep(2); setSavedMsg(''); }
  }
  function nextFromDetail() {
    if (!detail) return;
    if (confirmed) { setStep(3); setSavedMsg(''); return; }
    if (!outline) { void genOutline(); return; }
    if (JSON.stringify({ causal, detail }) === outlineBasis) { setStep(3); setSavedMsg(''); return; }
    let changes: string[] = [];
    try {
      if (outlineBasis) {
        const b = JSON.parse(outlineBasis) as { causal: CausalFlow | null; detail: DetailFlow | null };
        if (b.causal && causal) changes.push(...diffCausal(asCausal(b.causal), causal));
        if (b.detail && detail) changes.push(...diffDetail(b.detail, detail));
      }
    } catch { /* noop */ }
    if (confirmRegen('인과 흐름 또는 진단·치료 세부가 변경되었습니다.', changes, '아웃라인을 다시 생성할까요?')) void genOutline();
    else { setStep(3); setSavedMsg(''); }
  }
  function nextFromOutline() {
    if (!outline) return;
    if (confirmed) { setStep(4); setSavedMsg(''); return; } // 확정 후엔 재생성 없이 이동만
    if (!blog) { void genBlog(); return; }
    if (JSON.stringify(outline) === blogBasis) { setStep(4); setSavedMsg(''); return; }
    let changes: string[] = [];
    try { if (blogBasis) changes = diffOutline(JSON.parse(blogBasis) as Outline, outline); } catch { /* noop */ }
    if (confirmRegen('아웃라인이 변경되었습니다.', changes, '블로그 글을 다시 생성할까요?')) void genBlog();
    else { setStep(4); setSavedMsg(''); }
  }

  async function saveCurrent() {
    setSaving(true); setError(null); setSavedMsg('');
    try {
      if (step === 1 && causal) await callSave('blog_causal', { causalFlow: causal, caseOverview });
      else if (step === 2 && detail) await callSave('blog_detail', { detailFlow: detail, caseOverview });
      else if (step === 3 && outline) await callSave('blog_outline', { outline, caseOverview });
      else if (step === 4 && blog) await callSave('blog_post', { ...blog, confirmed, saved: savedFlag });
      else if (step === 5 && outline) await callSave('blog_outline', { outline, caseOverview });
      setSavedMsg('저장됨');
    } catch (e) { setError(e instanceof Error ? e.message : '저장 실패'); }
    finally { setSaving(false); }
  }

  // 이미 분석·저장된 케이스 이미지(파일명→signedUrl). 섹션 썸네일용. signedUrl 만료 대비 열 때마다 새로 가져온다.
  async function loadCaseImages() {
    try {
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/case-images`, { credentials: 'include' });
      const data = (await res.json()) as {
        images?: { fileName?: string; signedUrl?: string | null; briefComment?: string; bodyPart?: string | null }[];
      };
      if (res.ok && Array.isArray(data.images)) {
        setCaseImages(
          data.images
            .map((im) => {
              const brief = typeof im.briefComment === 'string' ? im.briefComment.trim() : '';
              const part = typeof im.bodyPart === 'string' ? im.bodyPart.trim() : '';
              // 이미지 분석 때 AI가 적어둔 한 줄 관찰을 캡션으로 그대로 사용(없으면 부위).
              return { fileName: String(im.fileName ?? ''), signedUrl: im.signedUrl ?? null, caption: brief || part };
            })
            .filter((x) => x.fileName),
        );
      }
    } catch {
      /* 이미지가 없거나 조회 실패 시 무시 */
    }
  }

  function openModal() {
    setOpen(true); setError(null); setSavedMsg('');
    void loadCaseImages();
    if (loadedRunId !== runId) {
      setStep(1); setCausal(null); setDetail(null); setOutline(null); setBlog(null); setCaseOverview([]); setConfirmed(false);
      void loadAll();
    }
  }
  const closeModal = () => { setOpen(false); onClose?.(); };
  const dirty = () => { if (savedMsg) setSavedMsg(''); };

  // ── 편집 헬퍼 ──
  function setCausalField<K extends keyof CausalFlow>(k: K, v: CausalFlow[K]) {
    setCausal((c) => (c ? { ...c, [k]: v } : c)); dirty();
  }
  function updatePhase(i: number, patch: Partial<Phase>) {
    setCausal((c) => (c ? { ...c, phases: c.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) } : c)); dirty();
  }
  function movePhase(i: number, dir: -1 | 1) {
    setCausal((c) => {
      if (!c) return c;
      const j = i + dir; if (j < 0 || j >= c.phases.length) return c;
      const arr = [...c.phases]; [arr[i], arr[j]] = [arr[j]!, arr[i]!]; return { ...c, phases: arr };
    }); dirty();
  }
  function addPhase() {
    setCausal((c) => (c ? { ...c, phases: [...c.phases, { id: `phase_${uid()}`, name: '', period: '', types: [], actions: [], nextStep: [] }] } : c)); dirty();
  }
  function removePhase(i: number) {
    setCausal((c) => (c ? { ...c, phases: c.phases.filter((_, j) => j !== i) } : c)); dirty();
  }
  // 날짜(phase) 하나만 다시 생성. feedback(수정 요청)을 프롬프트에 반영.
  async function regenPhase(i: number, feedback: string) {
    if (!causal || phaseBusy !== null) return;
    setPhaseBusy(i); setError(null); setSavedMsg('');
    try {
      const g = await callGenerate({ contentType: 'blog_causal_phase', causalFlow: causal, phaseIndex: i, feedback });
      const np = asPhase(g.phase);
      // id 는 기존 유지(참조 안정).
      updatePhase(i, { name: np.name, period: np.period, types: np.types, actions: np.actions, nextStep: np.nextStep });
    } catch (e) {
      setError(e instanceof Error ? e.message : '이 날짜 다시 생성 실패');
    } finally {
      setPhaseBusy(null);
    }
  }
  function updateSection(i: number, patch: Partial<Section>) {
    setOutline((o) => (o ? { ...o, sections: o.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : o)); dirty();
  }
  function moveSection(i: number, dir: -1 | 1) {
    setOutline((o) => {
      if (!o) return o;
      const j = i + dir; if (j < 0 || j >= o.sections.length) return o;
      const arr = [...o.sections]; [arr[i], arr[j]] = [arr[j]!, arr[i]!]; return { ...o, sections: arr };
    }); dirty();
  }
  function addSection() {
    setOutline((o) => (o ? { ...o, sections: [...o.sections, { id: `sec_${uid()}`, label: '', period: '', points: [], facts: [], imageFileNames: [] }] } : o)); dirty();
  }
  function removeSection(i: number) {
    setOutline((o) => (o ? { ...o, sections: o.sections.filter((_, j) => j !== i) } : o)); dirty();
  }
  function setBlogField<K extends keyof BlogPost>(k: K, v: BlogPost[K]) {
    setBlog((b) => (b ? { ...b, [k]: v } : b)); dirty();
  }
  const updateDetail = (d: DetailFlow) => { setDetail(d); dirty(); };

  const missingOverview = caseOverview.filter((o) => !o.value).length;
  const imageMetaByName = new Map(caseImages.map((c) => [c.fileName, c] as const));

  return (
    <>
      {triggerStyle ? (
        <button type="button" style={triggerStyle} onClick={openModal}>{label}</button>
      ) : (
        <button type="button" className="adminLegacySecondaryBtn" onClick={openModal}>{label}</button>
      )}
      {open ? (
        <div style={overlayStyle} role="presentation" onClick={closeModal}>
          <div style={cardStyle} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {/* 헤더 + 스텝바 */}
            <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>진료케이스 작성</h2>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    인과 흐름 → 섹션 아웃라인 → 블로그 글. 각 단계를 검수·수정한 뒤 다음으로 넘어갑니다.
                  </p>
                </div>
                <button type="button" className="adminLegacySmallBtn" onClick={closeModal}>닫기</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                {([[1, '인과 흐름'], [2, '진단·치료 세부'], [3, '아웃라인'], [4, '블로그 글'], [5, '이미지']] as [StepNum, string][]).map(([n, label]) => {
                  const active = step === n; const done = step > n;
                  return (
                    <div key={n} style={{
                      flex: 1, padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, textAlign: 'center',
                      background: active ? 'var(--accent)' : done ? 'var(--accent-subtle)' : '#fff',
                      color: active ? '#fff' : done ? 'var(--accent)' : 'var(--text-muted)',
                      border: `1px solid ${active || done ? 'var(--accent)' : 'var(--border-strong)'}`,
                    }}>{n}. {label}</div>
                  );
                })}
              </div>
              {error ? (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--danger-subtle)', color: 'var(--danger)', fontSize: 12.5 }}>{error}</div>
              ) : null}
            </div>

            {/* 본문: 좌 개요 / 우 단계 편집 */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16, padding: '14px 20px', overflow: 'hidden' }}>
              {/* 좌 — 케이스 개요 */}
              <div style={{ flex: '3.5 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>케이스 개요 (담당자 작성)</span>
                  {missingOverview > 0 ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)' }}>⚠ 미작성 {missingOverview}</span> : null}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 12, alignContent: 'start' }}>
                  <div style={cardBox}>
                    {caseOverview.length ? (
                      <div style={{ display: 'grid', gap: 10 }}>
                        {caseOverview.map((o) => {
                          const empty = !o.value;
                          return (
                            <div key={o.label} style={{ display: 'grid', gap: 2 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: empty ? 'var(--danger)' : 'var(--text-muted)' }}>{o.label}</span>
                              <span style={{ fontSize: 12.5, color: empty ? 'var(--danger)' : 'var(--text)', whiteSpace: 'pre-wrap', fontStyle: empty ? 'italic' : 'normal' }}>{empty ? '미작성' : o.value}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{genLoading === 1 ? '불러오는 중…' : '케이스 개요 없음'}</div>
                    )}
                  </div>

                  {/* 개요 누락 점검 — 3단계 아웃라인 기준, 케이스 개요 아래에 표시 */}
                  {step === 3 && outline && outline.overviewCheck.length ? (
                    <div style={cardBox}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>개요 누락 점검</div>
                      <div style={{ display: 'grid', gap: 5 }}>
                        {outline.overviewCheck.map((c, i) => (
                          <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6 }}>
                            <span style={{ color: c.reflectedIn ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{c.reflectedIn ? '✓' : '✕'}</span>
                            <span>{c.item}{c.reflectedIn ? ` → ${c.reflectedIn}` : ' (미반영)'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* 우 — 단계 편집 */}
              <div style={{ flex: '6.5 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
                    {step === 1 ? '1단계 — 인과 흐름 (검수·수정)'
                      : step === 2 ? '2단계 — 진단·치료 세부 흐름 (검수·수정)'
                      : step === 3 ? '3단계 — 섹션 아웃라인 (검수·수정)'
                      : step === 4 ? '4단계 — 블로그 글 (검수·수정)'
                      : '5단계 — 이미지 (배정·수정)'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {savedMsg ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>{savedMsg}</span> : null}
                    {step === 5 ? (
                      <button type="button" style={btnSecondary} onClick={() => void genImages()} disabled={busy}>
                        {genLoading === 5 ? '분석 중…' : '이미지 다시 분석'}
                      </button>
                    ) : confirmed ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>확정됨 · 수기 수정만 가능</span>
                    ) : (
                      <button type="button" style={btnSecondary} onClick={() => { if (step === 1) void genCausal(); else if (step === 2) void genDetail(); else if (step === 3) void genOutline(); else void genBlog(); }} disabled={busy}>
                        {genLoading === step ? '생성 중…' : '다시 생성'}
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
                  {genLoading === step && step === 1 && !causal ? (
                    <Loading text="AI가 인과 흐름을 재구성하는 중…" />
                  ) : step === 1 ? (
                    <CausalEditor
                      causal={causal} busy={busy}
                      setField={setCausalField} updatePhase={updatePhase} movePhase={movePhase} addPhase={addPhase} removePhase={removePhase}
                      regenPhase={regenPhase} phaseBusy={phaseBusy}
                    />
                  ) : step === 2 ? (
                    genLoading === 2 && !detail ? <Loading text="AI가 진단·치료 세부 흐름을 전개하는 중…" /> : (
                      <DetailEditor detail={detail} onChange={updateDetail} />
                    )
                  ) : step === 3 ? (
                    genLoading === 3 && !outline ? <Loading text="AI가 아웃라인을 배치하는 중…" /> : (
                      <OutlineEditor outline={outline} updateSection={updateSection} moveSection={moveSection} addSection={addSection} removeSection={removeSection} setOutline={(o) => { setOutline(o); dirty(); }} imageMeta={(fn) => imageMetaByName.get(fn) ?? null} />
                    )
                  ) : step === 4 ? (
                    genLoading === 4 && !blog ? <Loading text="AI가 블로그 글을 작성하는 중…" /> : (
                      <BlogEditor blog={blog} setField={setBlogField} outline={outline} imageMeta={(fn) => imageMetaByName.get(fn) ?? null} />
                    )
                  ) : (
                    genLoading === 5 ? <Loading text="AI가 진단 기반으로 이미지를 배정하는 중…" /> : (
                      <Step4Editor outline={outline} caseImages={caseImages} imageMeta={(fn) => imageMetaByName.get(fn) ?? null} updateSection={updateSection} />
                    )
                  )}
                </div>
              </div>
            </div>

            {/* 푸터 */}
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                {step > 1 ? (
                  <button type="button" style={btnSecondary} onClick={() => { setStep((s) => (s - 1) as StepNum); setSavedMsg(''); }} disabled={busy}>← 이전</button>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={btnSecondary} onClick={() => void saveCurrent()} disabled={busy || (step === 1 ? !causal : step === 2 ? !detail : step === 3 ? !outline : step === 4 ? !blog : !outline)}>
                  {saving ? '저장 중…' : '저장'}
                </button>
                {step === 1 ? (
                  <button type="button" style={btnPrimary} onClick={() => nextFromCausal()} disabled={busy || !causal}>{genLoading === 2 ? '생성 중…' : '다음: 진단·치료 세부 →'}</button>
                ) : step === 2 ? (
                  <button type="button" style={btnPrimary} onClick={() => nextFromDetail()} disabled={busy || !detail}>{genLoading === 3 ? '생성 중…' : '다음: 아웃라인 →'}</button>
                ) : step === 3 ? (
                  <button type="button" style={btnPrimary} onClick={() => nextFromOutline()} disabled={busy || !outline}>{genLoading === 4 ? '생성 중…' : '다음: 글 작성 →'}</button>
                ) : step === 4 ? (
                  confirmed ? (
                    <button type="button" style={btnPrimary} onClick={() => { setStep(5); setSavedMsg(''); }} disabled={busy}>다음: 이미지 →</button>
                  ) : (
                    <button type="button" style={btnPrimary} onClick={() => void confirmBlog()} disabled={busy || !blog}>블로그 글 확정하기</button>
                  )
                ) : (
                  <Link href="/admin/case-blog" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>진료케이스 보러가기</Link>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Loading({ text }: { text: string }) {
  return <div style={{ padding: '48px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{text}</div>;
}

function RowTools({ onUp, onDown, onRemove, busy }: { onUp: () => void; onDown: () => void; onRemove: () => void; busy?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button type="button" style={btnTiny} onClick={onUp} disabled={busy}>↑</button>
      <button type="button" style={btnTiny} onClick={onDown} disabled={busy}>↓</button>
      <button type="button" style={{ ...btnTiny, color: 'var(--danger)', borderColor: 'var(--danger-subtle)' }} onClick={onRemove} disabled={busy}>삭제</button>
    </div>
  );
}

// 한 날짜(phase) 카드: 날짜를 제목처럼, 성격 해시태그(다중), 행위별 카드(무엇/왜/결과),
// 맨 아래 Next step + 날짜별 다시 생성(피드백 반영).
function PhaseCard({ p, busy, regenBusy, onUp, onDown, onRemove, update, onRegen }: {
  p: Phase; busy: boolean; regenBusy: boolean; onUp: () => void; onDown: () => void; onRemove: () => void;
  update: (patch: Partial<Phase>) => void; onRegen: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const setActions = (actions: Action[]) => update({ actions });
  const updAction = (ai: number, patch: Partial<Action>) => setActions(p.actions.map((a, j) => (j === ai ? { ...a, ...patch } : a)));
  const moveAction = (ai: number, dir: -1 | 1) => { const j = ai + dir; if (j < 0 || j >= p.actions.length) return; const a = [...p.actions]; [a[ai], a[j]] = [a[j]!, a[ai]!]; setActions(a); };
  const addAction = () => setActions([...p.actions, { what: '', why: '', result: '' }]);
  const rmAction = (ai: number) => setActions(p.actions.filter((_, j) => j !== ai));
  const toggleType = (t: string) => {
    if (p.types.includes(t)) { update({ types: p.types.filter((x) => x !== t) }); return; }
    // 켤 때: 외과↔내과는 상호 배타 — 다른 하나는 끈다.
    const other = t === 'surgical' ? 'medical' : t === 'medical' ? 'surgical' : null;
    const base = other ? p.types.filter((x) => x !== other) : p.types;
    update({ types: [...base, t] });
  };

  const nextSteps = p.nextStep.filter((s) => s.trim());
  const selectedTypes = PHASE_TYPE_ORDER.filter((t) => p.types.includes(t));

  return (
    <div style={{ ...cardBox, opacity: regenBusy ? 0.6 : 1 }}>
      {/* 헤더: 날짜(제목) + 우측 버튼(다시 생성 / 수기 수정 / [편집 시 순서 이동] / 삭제) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: editMode ? 8 : 10 }}>
        {editMode ? (
          <input
            value={p.period}
            onChange={(e) => update({ period: e.target.value })}
            placeholder="날짜 (예: 2026년 02월 17일 (최초 진단일))"
            style={{ ...inputStyle, flex: 1, fontWeight: 700, fontSize: 14 }}
          />
        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{p.period || '날짜 미입력'}</div>
            {p.name ? <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{p.name}</div> : null}
          </div>
        )}
        <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setRegenOpen(true)} disabled={busy} style={btnTiny}>
            {regenBusy ? '생성 중…' : '이 날짜 다시 생성'}
          </button>
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            disabled={busy}
            style={editMode ? { ...btnTiny, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : btnTiny}
          >
            {editMode ? '수정 완료' : '수기 수정'}
          </button>
          {editMode ? (
            <>
              <button type="button" style={btnTiny} onClick={onUp} disabled={busy} title="위로 이동">↑</button>
              <button type="button" style={btnTiny} onClick={onDown} disabled={busy} title="아래로 이동">↓</button>
            </>
          ) : null}
          <button type="button" style={{ ...btnTiny, color: 'var(--danger)', borderColor: 'var(--danger-subtle)' }} onClick={onRemove} disabled={busy}>삭제</button>
        </div>
      </div>

      {editMode ? (
        <>
          {/* 성격 해시태그(다중 선택) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {PHASE_TYPE_ORDER.map((t) => (
              <button key={t} type="button" onClick={() => toggleType(t)} disabled={busy} style={hashChip(p.types.includes(t))}>
                #{PHASE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          {/* 단계명(선택) */}
          <div style={{ display: 'grid', gap: 3, marginBottom: 12 }}>
            <span style={fieldLabel}>단계명 (선택)</span>
            <input value={p.name} onChange={(e) => update({ name: e.target.value })} placeholder="이 날 요약 이름" style={inputStyle} />
          </div>

          {/* 행위별 카드(편집) */}
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={fieldLabel}>무엇을 했나 (행위별)</span>
            {p.actions.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 2px' }}>행위가 없습니다. 아래에서 추가하세요. (기록 없는 날짜는 비워둬도 됩니다)</div>
            ) : (
              p.actions.map((a, ai) => (
                <div key={ai} style={actionBox}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <input
                      value={a.what}
                      onChange={(e) => updAction(ai, { what: e.target.value })}
                      placeholder="무엇을 했나 (한 줄 제목)"
                      style={{ ...inputStyle, flex: 1, fontWeight: 700, color: actionWhatColor }}
                    />
                    <RowTools onUp={() => moveAction(ai, -1)} onDown={() => moveAction(ai, 1)} onRemove={() => rmAction(ai)} busy={busy} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, alignItems: 'start' }}>
                    <AutoTextarea label="왜 했나" value={a.why} onChange={(v) => updAction(ai, { why: v })} placeholder="임상적 이유" />
                    <AutoTextarea label="결과" value={a.result} onChange={(v) => updAction(ai, { result: v })} placeholder="도출된 결과" />
                  </div>
                </div>
              ))
            )}
            <button type="button" style={{ ...btnTiny, alignSelf: 'flex-start' }} onClick={addAction} disabled={busy}>+ 행위 추가</button>
          </div>

          {/* Next step(편집) */}
          <div style={{ marginTop: 12 }}>
            <LabeledTextarea
              label="Next step (이 날 결정한 다음 단계 · 한 줄에 한 항목)"
              value={p.nextStep.join('\n')}
              onChange={(v) => update({ nextStep: v.split('\n') })}
              rows={2}
            />
          </div>
        </>
      ) : (
        <>
          {/* 성격 해시태그(읽기 전용) */}
          {selectedTypes.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {selectedTypes.map((t) => (
                <span key={t} style={{ ...hashChip(true), cursor: 'default' }}>#{PHASE_TYPE_LABEL[t]}</span>
              ))}
            </div>
          ) : null}

          {/* 행위별(읽기 전용) */}
          {p.actions.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '4px 2px' }}>기록된 행위가 없는 날짜입니다.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {p.actions.map((a, ai) => (
                <div key={ai} style={actionBox}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: actionWhatColor }}>{a.what || '—'}</div>
                  {a.why.trim() ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      <span style={viewMiniLabel}>왜</span><span style={{ whiteSpace: 'pre-wrap' }}>{a.why}</span>
                    </div>
                  ) : null}
                  {a.result.trim() ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      <span style={viewMiniLabel}>결과</span><span style={{ whiteSpace: 'pre-wrap' }}>{a.result}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Next step(읽기 전용) */}
          {nextSteps.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <span style={fieldLabel}>NEXT STEP</span>
              <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
                {nextSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ) : null}
        </>
      )}


      {regenOpen ? (
        <div style={regenOverlay} onClick={() => setRegenOpen(false)}>
          <div style={regenDialog} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>이 날짜 다시 생성</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 10 }}>
              {p.period || '이 날짜'}에서 어떤 부분이 수정이 필요할까요? 지적하면 그 부분을 반영해 이 날짜만 다시 만듭니다.
              <br />(비워두면 품질만 개선해 다시 정리)
            </div>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="예: 초음파 결과가 빠졌어요 / 검사 순서가 틀렸어요 / 진단 근거를 더 구체적으로"
              rows={4}
              autoFocus
              style={{ ...inputStyle }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" style={btnSecondary} onClick={() => setRegenOpen(false)}>취소</button>
              <button type="button" style={btnPrimary} onClick={() => { setRegenOpen(false); onRegen(feedback); }}>다시 생성</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── 1단계 에디터 ──
function CausalEditor({ causal, busy, setField, updatePhase, movePhase, addPhase, removePhase, regenPhase, phaseBusy }: {
  causal: CausalFlow | null; busy: boolean;
  setField: <K extends keyof CausalFlow>(k: K, v: CausalFlow[K]) => void;
  updatePhase: (i: number, patch: Partial<Phase>) => void;
  movePhase: (i: number, dir: -1 | 1) => void; addPhase: () => void; removePhase: (i: number) => void;
  regenPhase: (i: number, feedback: string) => void; phaseBusy: number | null;
}) {
  if (!causal) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>인과 흐름이 없습니다. “다시 생성”을 눌러 주세요.</div>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={cardBox}>
        <div style={{ display: 'grid', gap: 10 }}>
          <LabeledTextarea label="흐름의 축 (한 줄 요약)" value={causal.axis} onChange={(v) => setField('axis', v)} rows={2} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={causal.anesthesia} onChange={(e) => setField('anesthesia', e.target.checked)} style={{ width: 15, height: 15 }} />
            전신마취 동반 (체크 시 2단계에서 마취 전 안전성 평가 비중↑)
          </label>
        </div>
      </div>
      {causal.phases.map((p, i) => (
        <PhaseCard key={p.id} p={p} busy={busy || phaseBusy !== null} regenBusy={phaseBusy === i}
          onUp={() => movePhase(i, -1)} onDown={() => movePhase(i, 1)} onRemove={() => removePhase(i)}
          update={(patch) => updatePhase(i, patch)} onRegen={(fb) => regenPhase(i, fb)} />
      ))}
      <button type="button" style={{ ...btnSecondary, width: '100%' }} onClick={addPhase} disabled={busy}>+ 단계 추가</button>
    </div>
  );
}

// ── 2단계 에디터 — 진단/치료 세부 흐름 ──
function DetailEditor({ detail, onChange }: { detail: DetailFlow | null; onChange: (d: DetailFlow) => void }) {
  if (!detail) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>진단·치료 세부 흐름이 없습니다. “다시 생성”을 눌러 주세요.</div>;

  // 진단
  const setDiag = (steps: DiagStep[]) => onChange({ ...detail, diagnosis: { steps } });
  const updDiag = (i: number, patch: Partial<DiagStep>) => setDiag(detail.diagnosis.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveDiag = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= detail.diagnosis.steps.length) return; const a = [...detail.diagnosis.steps]; [a[i], a[j]] = [a[j]!, a[i]!]; setDiag(a); };
  const addDiag = () => setDiag([...detail.diagnosis.steps, { name: '', why: '', what: '', result: '', fromChart: false }]);
  const rmDiag = (i: number) => setDiag(detail.diagnosis.steps.filter((_, j) => j !== i));

  // 치료
  const setProcs = (procedures: TreatProcedure[]) => onChange({ ...detail, treatment: { ...detail.treatment, procedures } });
  const updProc = (pi: number, patch: Partial<TreatProcedure>) => setProcs(detail.treatment.procedures.map((p, j) => (j === pi ? { ...p, ...patch } : p)));
  const moveProc = (pi: number, dir: -1 | 1) => { const j = pi + dir; if (j < 0 || j >= detail.treatment.procedures.length) return; const a = [...detail.treatment.procedures]; [a[pi], a[j]] = [a[j]!, a[pi]!]; setProcs(a); };
  const addProc = () => setProcs([...detail.treatment.procedures, { id: `proc_${uid()}`, name: '', steps: [] }]);
  const rmProc = (pi: number) => setProcs(detail.treatment.procedures.filter((_, j) => j !== pi));
  const setSteps = (pi: number, steps: TreatStep[]) => updProc(pi, { steps });
  const updStep = (pi: number, si: number, patch: Partial<TreatStep>) => setSteps(pi, (detail.treatment.procedures[pi]?.steps ?? []).map((s, j) => (j === si ? { ...s, ...patch } : s)));
  const moveStep = (pi: number, si: number, dir: -1 | 1) => { const steps = detail.treatment.procedures[pi]?.steps ?? []; const j = si + dir; if (j < 0 || j >= steps.length) return; const a = [...steps]; [a[si], a[j]] = [a[j]!, a[si]!]; setSteps(pi, a); };
  const addStep = (pi: number) => setSteps(pi, [...(detail.treatment.procedures[pi]?.steps ?? []), { step: '', why: '', detail: '', fromChart: false }]);
  const rmStep = (pi: number, si: number) => setSteps(pi, (detail.treatment.procedures[pi]?.steps ?? []).filter((_, j) => j !== si));

  const fromChartBox = (checked: boolean, on: (v: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} style={{ width: 13, height: 13 }} /> 차트 근거
    </label>
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* 진단 과정 */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>진단 과정 (검사 순서)</div>
      {detail.diagnosis.steps.map((s, i) => (
        <div key={i} style={cardBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <input value={s.name} onChange={(e) => updDiag(i, { name: e.target.value })} placeholder="검사명" style={{ ...inputStyle, fontWeight: 700, maxWidth: 280 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {fromChartBox(s.fromChart, (v) => updDiag(i, { fromChart: v }))}
              <RowTools onUp={() => moveDiag(i, -1)} onDown={() => moveDiag(i, 1)} onRemove={() => rmDiag(i)} />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <LabeledTextarea label="왜 (무엇을 확인하려고)" value={s.why} onChange={(v) => updDiag(i, { why: v })} rows={2} />
            <LabeledTextarea label="어떻게 (검사 방법 · 표준)" value={s.what} onChange={(v) => updDiag(i, { what: v })} rows={2} />
            <LabeledTextarea label="결과/소견 (차트 기록 · 없으면 비움)" value={s.result} onChange={(v) => updDiag(i, { result: v })} rows={2} />
          </div>
        </div>
      ))}
      <button type="button" style={{ ...btnSecondary, width: '100%' }} onClick={addDiag}>+ 진단 검사 추가</button>

      {/* 치료 과정 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>치료 과정</span>
        <select value={detail.treatment.type} onChange={(e) => onChange({ ...detail, treatment: { ...detail.treatment, type: e.target.value } })} style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 12 }}>
          {Object.entries(TREAT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {detail.treatment.procedures.map((p, pi) => (
        <div key={p.id} style={{ ...cardBox, borderColor: 'var(--accent-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <input value={p.name} onChange={(e) => updProc(pi, { name: e.target.value })} placeholder="처치명 (예: 치과 스케일링·발치)" style={{ ...inputStyle, fontWeight: 700 }} />
            <RowTools onUp={() => moveProc(pi, -1)} onDown={() => moveProc(pi, 1)} onRemove={() => rmProc(pi)} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {p.steps.map((st, si) => (
              <div key={si} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <input value={st.step} onChange={(e) => updStep(pi, si, { step: e.target.value })} placeholder={`단계 ${si + 1} (예: 전신마취)`} style={{ ...inputStyle, fontWeight: 600, maxWidth: 240 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {fromChartBox(st.fromChart, (v) => updStep(pi, si, { fromChart: v }))}
                    <RowTools onUp={() => moveStep(pi, si, -1)} onDown={() => moveStep(pi, si, 1)} onRemove={() => rmStep(pi, si)} />
                  </div>
                </div>
                <LabeledTextarea label="왜 (목적)" value={st.why} onChange={(v) => updStep(pi, si, { why: v })} rows={2} />
                <LabeledTextarea label="어떻게 (표준 방법)" value={st.detail} onChange={(v) => updStep(pi, si, { detail: v })} rows={2} />
              </div>
            ))}
            <button type="button" style={{ ...btnTiny, width: 'fit-content' }} onClick={() => addStep(pi)}>+ 세부 단계 추가</button>
          </div>
        </div>
      ))}
      <button type="button" style={{ ...btnSecondary, width: '100%' }} onClick={addProc}>+ 처치 추가</button>
    </div>
  );
}

// 케이스 이미지 썸네일 + 캡션(이미지 분석 때 AI가 적어둔 관찰). onRemove 있으면 제거 버튼 표시.
function CaseImageThumb({ fileName, meta, onRemove }: { fileName: string; meta: CaseImg | null; onRemove?: () => void }) {
  const url = meta?.signedUrl ?? null;
  const caption = meta?.caption ?? '';
  return (
    <figure style={{ width: 110, margin: 0 }}>
      <div style={{ position: 'relative' }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={fileName} title={fileName} style={{ width: 110, height: 78, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
        ) : (
          <div style={{ width: 110, height: 78, borderRadius: 6, border: '1px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', padding: 4, wordBreak: 'break-all' }}>{fileName}</div>
        )}
        {onRemove ? (
          <button type="button" onClick={onRemove} aria-label="이미지 제거" style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', fontSize: 11, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        ) : null}
      </div>
      {caption ? (
        <figcaption style={{ marginTop: 3, fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.35, wordBreak: 'break-word' }}>{caption}</figcaption>
      ) : null}
    </figure>
  );
}

// ── 2단계 에디터 ──
function OutlineEditor({ outline, updateSection, moveSection, addSection, removeSection, setOutline, imageMeta }: {
  outline: Outline | null;
  updateSection: (i: number, patch: Partial<Section>) => void;
  moveSection: (i: number, dir: -1 | 1) => void; addSection: () => void; removeSection: (i: number) => void;
  setOutline: (o: Outline) => void;
  imageMeta: (fileName: string) => CaseImg | null;
}) {
  if (!outline) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>아웃라인이 없습니다. “다시 생성”을 눌러 주세요.</div>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={cardBox}>
        <div style={{ display: 'grid', gap: 3 }}>
          <span style={fieldLabel}>제목 후보 (한 줄에 하나)</span>
          <textarea
            value={outline.title_candidates.join('\n')}
            onChange={(e) => setOutline({ ...outline, title_candidates: e.target.value.split('\n') })}
            rows={2}
            style={{ ...inputStyle, minHeight: 72 }}
          />
        </div>
      </div>
      {outline.sections.map((s, i) => (
        <div key={s.id} style={cardBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <input value={s.label} onChange={(e) => updateSection(i, { label: e.target.value })} placeholder="섹션명" style={{ ...inputStyle, fontWeight: 700, maxWidth: 280 }} />
            <RowTools onUp={() => moveSection(i, -1)} onDown={() => moveSection(i, 1)} onRemove={() => removeSection(i)} />
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <LabeledTextarea label="요점 points (한 줄에 하나 · 서술 방향)" value={s.points.join('\n')} onChange={(v) => updateSection(i, { points: v.split('\n') })} rows={3} />
            <LabeledTextarea label="팩트 facts (한 줄에 하나 · 반드시 들어갈 데이터)" value={s.facts.join('\n')} onChange={(v) => updateSection(i, { facts: v.split('\n') })} rows={3} />
            {s.imageFileNames.length > 0 ? (
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={fieldLabel}>관련 이미지 (팩트를 보여주는 분석 이미지)</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {s.imageFileNames.map((fn) => (
                    <CaseImageThumb
                      key={fn}
                      fileName={fn}
                      meta={imageMeta(fn)}
                      onRemove={() => updateSection(i, { imageFileNames: s.imageFileNames.filter((x) => x !== fn) })}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ))}
      <button type="button" style={{ ...btnSecondary, width: '100%' }} onClick={addSection}>+ 섹션 추가</button>
    </div>
  );
}

// ── 3단계 에디터 ──
function BlogEditor({ blog, setField, outline, imageMeta }: {
  blog: BlogPost | null;
  setField: <K extends keyof BlogPost>(k: K, v: BlogPost[K]) => void;
  outline: Outline | null;
  imageMeta: (fileName: string) => CaseImg | null;
}) {
  const liveCount = blog ? blog.bodyMarkdown.length : 0;
  const inRange = liveCount >= 2500 && liveCount <= 3500;
  const sectionsWithImages = (outline?.sections ?? []).filter((s) => s.imageFileNames.length > 0);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {blog ? (
        <>
          {sectionsWithImages.length > 0 ? (
            <div style={cardBox}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>관련 이미지 (아웃라인 연결 · 참고용)</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {sectionsWithImages.map((s) => (
                  <div key={s.id} style={{ display: 'grid', gap: 5 }}>
                    <span style={fieldLabel}>{s.label || '(섹션명 없음)'}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {s.imageFileNames.map((fn) => (
                        <CaseImageThumb key={fn} fileName={fn} meta={imageMeta(fn)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div style={cardBox}>
            <div style={{ display: 'grid', gap: 3 }}>
              <span style={fieldLabel}>제목</span>
              <input value={blog.title} onChange={(e) => setField('title', e.target.value)} style={{ ...inputStyle, fontWeight: 700 }} />
            </div>
          </div>
          <div style={cardBox}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={fieldLabel}>본문 (마크다운)</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: inRange ? 'var(--success)' : 'var(--danger)' }}>{liveCount.toLocaleString()}자 (목표 2,500~3,500)</span>
            </div>
            <textarea value={blog.bodyMarkdown} onChange={(e) => setField('bodyMarkdown', e.target.value)} rows={20} style={inputStyle} />
          </div>
          <div style={cardBox}>
            <LabeledTextarea label="태그 (한 줄에 하나)" value={blog.tags.join('\n')} onChange={(v) => setField('tags', v.split('\n').map((t) => t.trim()).filter(Boolean))} rows={2} />
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>블로그 글이 없습니다. “다시 생성”을 눌러 주세요.</div>
      )}
    </div>
  );
}

// ── 4단계 에디터 — 진단 기반 섹션별 이미지 배정(검수·수정) ──
function Step4Editor({ outline, caseImages, imageMeta, updateSection }: {
  outline: Outline | null;
  caseImages: CaseImg[];
  imageMeta: (fileName: string) => CaseImg | null;
  updateSection: (i: number, patch: Partial<Section>) => void;
}) {
  if (!outline) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>아웃라인이 없습니다.</div>;
  const assigned = new Set(outline.sections.flatMap((s) => s.imageFileNames));
  const unassigned = caseImages.filter((c) => !assigned.has(c.fileName));
  const addTo = (sectionIdx: number, fn: string) => {
    const s = outline.sections[sectionIdx];
    if (!s || s.imageFileNames.includes(fn)) return;
    updateSection(sectionIdx, { imageFileNames: [...s.imageFileNames, fn] });
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        진단 기반으로 섹션에 배정된 이미지입니다. ×로 제거하거나, 아래 미배정 이미지를 섹션에 추가할 수 있습니다. (“이미지 다시 분석”으로 재배정)
      </div>
      {outline.sections.map((s, i) => (
        <div key={s.id} style={cardBox}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{s.label || `섹션 ${i + 1}`}</div>
          {s.imageFileNames.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {s.imageFileNames.map((fn) => (
                <CaseImageThumb key={fn} fileName={fn} meta={imageMeta(fn)} onRemove={() => updateSection(i, { imageFileNames: s.imageFileNames.filter((x) => x !== fn) })} />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>배정된 이미지 없음</div>
          )}
        </div>
      ))}
      {unassigned.length ? (
        <div style={cardBox}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>미배정 이미지 ({unassigned.length}) — 섹션에 추가</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {unassigned.map((c) => (
              <div key={c.fileName} style={{ display: 'grid', gap: 4, width: 110 }}>
                <CaseImageThumb fileName={c.fileName} meta={c} />
                <select
                  defaultValue=""
                  onChange={(e) => { const idx = Number(e.target.value); if (Number.isInteger(idx)) addTo(idx, c.fileName); e.currentTarget.value = ''; }}
                  style={{ ...inputStyle, padding: '4px 6px', fontSize: 11 }}
                >
                  <option value="" disabled>섹션 선택…</option>
                  {outline.sections.map((s, i) => <option key={s.id} value={i}>{s.label || `섹션 ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
