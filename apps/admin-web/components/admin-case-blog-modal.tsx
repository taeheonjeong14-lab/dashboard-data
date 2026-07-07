'use client';

import { useState, useRef, useEffect, type CSSProperties } from 'react';
import Link from 'next/link';

// ── 타입 ──────────────────────────────────────────────────────────────────
type StepNum = 1 | 2 | 3 | 4;
type OverviewItem = { label: string; value: string };
// 수술 절차 한 단계 = 절차 이름 + 그 절차에 대한 부연 설명.
type ProcStep = { step: string; note: string };
// 액션 1개 = 한 행위(무엇을 했나) + 그 이유(왜) + 도출 결과 + 성격 해시태그(types) + 상세. UI에서 카드 하나.
// types: 그 "행위" 하나의 성격(검사/진단·술 전 검사·수술·술 후 회복·내과·입원·퇴원·기타). 여러 개 가능, 애매하면 '기타'.
// procedure: #수술 카드의 시술 절차(단계별 {절차, 설명}). detail: #내과 치료 카드의 처방 약 종류(문자열). 그 외 태그면 둘 다 비움.
type Action = { what: string; why: string; result: string; types: string[]; detail: string; procedure: ProcStep[] };
type Phase = { id: string; name: string; period: string; actions: Action[]; nextStep: string[] };
type CausalFlow = { axis: string; anesthesia: boolean; phases: Phase[] };
// tag: 해시태그 섹션이면 ACTION_TYPE 키(exam_dx 등), 고정 서술 섹션(인트로/질환소개/…)이면 ''.
type Section = { id: string; tag: string; label: string; period: string; points: string[]; facts: string[]; imageFileNames: string[] };
type CaseImg = { fileName: string; signedUrl: string | null; caption: string };
// PDF 추출 검사결과(날짜별). /api/admin/runs/[runId]/detail 의 labItemsByDate.
type LabItem = { itemName: string; valueText: string; unit: string | null; referenceRange: string | null; flag: 'low' | 'high' | 'normal' | 'unknown' | '' };
type LabDate = { dateTime: string; items: LabItem[] };
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
// 아이콘 버튼 — 색 없이 회색 선 글리프만(수정 ✎ / 다시생성 ↻ / 삭제 ✕ / 간결화 ✂). title 로 설명.
const iconBtn: CSSProperties = { ...btnTiny, fontSize: 13, padding: '3px 7px', lineHeight: 1 };
const iconBtnActive: CSSProperties = { ...iconBtn, background: 'var(--bg-subtle)', borderColor: 'var(--text-muted)' }; // 편집 활성(색 없이 회색 강조)
const iconBtnDanger: CSSProperties = { ...iconBtn, color: 'var(--danger)' }; // 삭제 — 빨간 ✕
const fieldLabel: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '-0.01em' };
const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 13, lineHeight: 1.5,
  border: '1px solid var(--border)', borderRadius: 6, background: '#fff', color: 'var(--text)',
  outline: 'none', boxSizing: 'border-box', resize: 'vertical', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
};
const cardBox: CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' };
// 좌측 참고 패널(케이스 개요·검사결과) — 우측 메인 섹션과 구분되게 연두 테두리, 여백은 조금 작게.
const refCardBox: CSSProperties = { ...cardBox, border: '1.5px solid #8bc34a', padding: '9px 11px' };
// 행위(action) 박스 — 옅은 배경으로 구분(테두리 없이 플랫하게).
const actionBox: CSSProperties = { background: 'var(--bg-subtle)', border: 'none', borderRadius: 8, padding: '10px 12px' };
const actionWhatColor = 'var(--text)'; // '무엇을 했나' 강조 — 색 대신 굵기로
// 읽기 전용 뷰의 '왜/결과' 인라인 라벨.
const viewMiniLabel: CSSProperties = { flexShrink: 0, fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', minWidth: 30 };
// Next step — 액션 카드(회색)와 구분되게 accent 톤 박스 + accent 라벨.
const nextStepBox: CSSProperties = { marginTop: 12, border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 12px', background: 'var(--accent-subtle)' };
const nextStepLabel: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '0.02em', color: 'var(--accent)' };
// 성격 해시태그 칩(선택 on/off): 선택된 것만 accent, 평소엔 회색.
function hashChip(on: boolean): CSSProperties {
  return {
    padding: '4px 11px', fontSize: 12, fontWeight: 700, borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
    background: on ? 'rgba(49, 130, 246, 0.12)' : '#fff',
    color: on ? 'var(--accent)' : 'var(--text-muted)',
    transition: 'all 0.1s ease',
  };
}
// 수술 절차 하위 박스 — 테두리 없이 흰 배경으로(옅은 회색 액션박스 위에 얹혀 구분).
const procBox: CSSProperties = { borderRadius: 6, padding: '8px 10px', background: 'var(--bg)' };
const procNumBadge: CSSProperties = { flexShrink: 0, width: 18, height: 18, borderRadius: 999, background: 'var(--text-muted)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' };
// 읽기 모드 — 행위 제목 우측 성격 태그 스티커(회색, 차분하게).
const tagSticker: CSSProperties = {
  fontSize: 10.5, fontWeight: 700, lineHeight: 1.5, whiteSpace: 'nowrap',
  padding: '1px 7px', borderRadius: 999,
  border: '1px solid var(--border)', background: 'var(--bg-subtle)', color: 'var(--text-muted)',
};
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

// 수술 절차 배열 정규화: [{step, note}] 만 남기고 빈 단계는 제거.
function asProcedure(v: unknown): ProcStep[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => { const y = (s ?? {}) as Record<string, unknown>; return { step: str(y.step), note: str(y.note) }; })
    .filter((s) => s.step.trim() || s.note.trim());
}

// phase 를 { actions, nextStep } 로 정규화. 새 구조(actions/nextStep)면 그대로,
// 옛 구조(what[]/why[]/toNext[])면 자동 변환: what[i]↔why[i] 를 액션으로 짝짓고, toNext 는 nextStep 으로.
function asActionsAndNext(x: Record<string, unknown>): { actions: Action[]; nextStep: string[] } {
  if (Array.isArray(x.actions)) {
    const actions = x.actions.map((a) => {
      const y = (a ?? {}) as Record<string, unknown>;
      const types = normTypes(y.types ?? y.type);
      // 상세는 태그에 맞을 때만 보존: detail 은 #내과 치료(medical), procedure 는 #수술(surgical) 카드만.
      return {
        what: str(y.what), why: str(y.why), result: str(y.result), types,
        detail: types.includes('medical') ? str(y.detail) : '',
        procedure: types.includes('surgical') ? asProcedure(y.procedure) : [],
      };
    });
    return { actions, nextStep: toLines(x.nextStep) };
  }
  // 옛 구조 변환
  const whats = toLines(x.what);
  const whys = toLines(x.why);
  const actions: Action[] = whats.map((w, i) => ({ what: w, why: whys[i] ?? '', result: '', types: [], detail: '', procedure: [] }));
  // what 이 없는데 why 만 있으면(드묾) 이유들만이라도 액션으로 보존
  if (actions.length === 0 && whys.length > 0) {
    for (const w of whys) actions.push({ what: '', why: w, result: '', types: [], detail: '', procedure: [] });
  }
  return { actions, nextStep: toLines(x.toNext) };
}

function asPhase(raw: unknown): Phase {
  const x = (raw ?? {}) as Record<string, unknown>;
  // 성격(types)은 이제 action(행위)별. 옛 phase 태그는 이관하지 않는다
  // (모든 카드에 똑같이 복붙되는 걸 피하려고 — 재생성하면 AI가 카드별로 붙임).
  return {
    id: str(x.id) || `phase_${uid()}`,
    name: str(x.name), period: str(x.period),
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
      const tagRaw = str(x.tag);
      return { id: str(x.id) || `sec_${uid()}`, tag: tagRaw in ACTION_TYPE_LABEL ? tagRaw : '', label: str(x.label), period: str(x.period), points: toLines(x.points), facts: toLines(x.facts), imageFileNames: toLines(x.imageFileNames) };
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
// 행위(action) 성격(해시태그). 한 행위에 여러 개 가능, 애매하면 '기타'.
// intro~outro 는 2단계 서술 섹션용 태그(인과 흐름엔 잘 안 붙지만 태그 체계를 1·2단계 공통으로 두려고 목록에 포함).
const ACTION_TYPE_LABEL: Record<string, string> = {
  intro: '인트로', disease_intro: '질환 소개', visit_background: '내원 배경',
  exam_dx: '검사 및 진단', preop: '술 전 검사', surgical: '수술', medical: '내과 치료', recovery: '회복 및 경과 확인', aftercare: '사후 관리 안내', other: '기타',
  director_note: '원장님 한마디', outro: '아웃트로', faq: '자주 묻는 질문',
};
// 2단계 섹션 배치 순서 = 이 순서(서술 앞 3 → 진료 7 → 서술 뒤 3: 원장님 한마디·아웃트로·FAQ). 서술 태그는 2단계 섹션 전용.
const ACTION_TYPE_ORDER = ['intro', 'disease_intro', 'visit_background', 'exam_dx', 'preop', 'surgical', 'medical', 'recovery', 'aftercare', 'other', 'director_note', 'outro', 'faq'];
// 1단계 행위 카드에 붙일 수 있는 진료 태그(7종). 서술 태그(intro~outro)는 실제 진료 행위가 아니라 여기서 제외.
const CLINICAL_TAG_ORDER = ['exam_dx', 'preop', 'surgical', 'medical', 'recovery', 'aftercare', 'other'];
// 옛 값 → 신규 키 매핑. 입원·퇴원·술후회복·술후경과확인은 모두 '회복 및 경과 확인'의 한 단계로 흡수.
const LEGACY_TYPE_MAP: Record<string, string> = { diagnostic: 'exam_dx', diagnosis: 'exam_dx', postop_recovery: 'recovery', postop_followup: 'recovery', admission: 'recovery', discharge: 'recovery' };
// 외과·내과는 한 행위에 하나만(상호 배타). 둘 다면 외과 우선.
function resolveExclusiveTypes(types: string[]): string[] {
  return types.includes('surgical') && types.includes('medical') ? types.filter((x) => x !== 'medical') : types;
}
// 옛 값 정규화 + 유효값만 + 상호 배타 정리.
function normTypes(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [];
  const out = arr.map((x) => { const s = String(x).trim(); return LEGACY_TYPE_MAP[s] ?? s; }).filter((x) => x in ACTION_TYPE_LABEL);
  return resolveExclusiveTypes([...new Set(out)]);
}

// 변경된 부분을 사람이 읽을 수 있는 목록으로 — 재생성 확인창에 표시.
const arrEq = (a: string[], b: string[]): boolean => a.join('') === b.join('');
const actionsKey = (a: Action[]): string => a.map((x) => `${x.what}|${x.why}|${x.result}|${x.types.join(',')}|${x.detail}|${x.procedure.map((s) => `${s.step}~${s.note}`).join('¶')}`).join('§');
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
    if (actionsKey(a.actions) !== actionsKey(b.actions)) sub.push('행위(무엇/왜/결과/성격)');
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

// 이상치 방향 표시: 높음 ↑(빨강)/낮음 ↓(파랑). 정상·미판정은 표시 없음.
function labFlagMark(flag: LabItem['flag']): { text: string; color: string } | null {
  if (flag === 'high') return { text: '↑', color: 'var(--danger)' };
  if (flag === 'low') return { text: '↓', color: 'var(--accent)' };
  return null;
}
// PDF에서 추출된 검사결과를 날짜별로 보여주는 좌측 참고 패널. 항목: 이름 · 값(단위) · 이상치 화살표 · 참고범위. 헤더 클릭으로 접기/펼치기.
function LabResultsPanel({ dates, open, onToggle }: { dates: LabDate[]; open: boolean; onToggle: () => void }) {
  if (!dates.length) return null;
  return (
    <div style={refCardBox}>
      <button
        type="button"
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: open ? 8 : 0, background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 10 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>검사결과 (PDF 추출)</span>
      </button>
      {open ? (
      <div style={{ display: 'grid', gap: 10 }}>
        {dates.map((d, di) => (
          <div key={di} style={{ display: 'grid', gap: 3 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '-0.01em' }}>{d.dateTime || '날짜 미상'}</div>
            <div style={{ display: 'grid', gap: 2 }}>
              {d.items.map((it, ii) => {
                const mark = labFlagMark(it.flag);
                return (
                  <div key={ii} style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{it.itemName || '—'}</span>{' '}
                    <span style={{ color: mark ? mark.color : 'var(--text-secondary)', fontWeight: mark ? 700 : 400 }}>
                      {it.valueText}{it.unit ? ` ${it.unit}` : ''}{mark ? ` ${mark.text}` : ''}
                    </span>
                    {it.referenceRange ? <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}> ({it.referenceRange})</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      ) : null}
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
  const [outline, setOutline] = useState<Outline | null>(null);
  const [blog, setBlog] = useState<BlogPost | null>(null);
  const [caseImages, setCaseImages] = useState<CaseImg[]>([]); // 파일명→signedUrl (섹션 썸네일용)
  const [labDates, setLabDates] = useState<LabDate[]>([]); // PDF 추출 검사결과(날짜별) — 좌측 참고 패널
  const [overviewOpen, setOverviewOpen] = useState(false); // 좌측 케이스 개요 접기/펼치기 (기본 닫힘)
  const [labOpen, setLabOpen] = useState(false); // 좌측 검사결과 접기/펼치기 (기본 닫힘)
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  // 하위 단계가 "어떤 입력으로" 생성됐는지 서명(JSON). 입력이 바뀌면 재생성 확인을 띄운다.
  const [outlineBasis, setOutlineBasis] = useState(''); // outline 을 만든 causal 의 서명
  const [blogBasis, setBlogBasis] = useState(''); // blog 를 만든 outline 의 서명

  const [genLoading, setGenLoading] = useState<null | 1 | 2 | 3 | 4>(null);
  const [phaseBusy, setPhaseBusy] = useState<number | null>(null); // 날짜별 다시 생성 중인 phase 인덱스
  const [confirmed, setConfirmed] = useState(false); // 블로그 글 확정됨(AI 재생성 불가)
  const [savedFlag, setSavedFlag] = useState(false);  // 네이버 저장완료 — 수기 수정 시 보존(상태 되돌림 방지)
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState('');

  const busy = genLoading !== null || saving;

  // 1단계 인과 흐름(날짜·카드 내용·해시태그 전부)을 생성/편집 시 자동 저장(디바운스).
  // callSave 로 causalFlow JSON 을 DB에 upsert → 새로고침해도 유지. 불러온 직후엔 ref 로 중복 저장 방지.
  const lastSavedCausalRef = useRef('');
  useEffect(() => {
    if (!open || !causal || loadedRunId !== runId) return;
    const snap = JSON.stringify(causal);
    if (snap === lastSavedCausalRef.current) return;
    const t = setTimeout(() => {
      lastSavedCausalRef.current = snap;
      callSave('blog_causal', { causalFlow: causal, caseOverview })
        .then(() => setSavedMsg('자동 저장됨'))
        .catch(() => { lastSavedCausalRef.current = ''; }); // 실패 시 다음 변경에서 재시도
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, causal, caseOverview, loadedRunId, runId]);

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
      const cP = find('blog_causal'); const oP = find('blog_outline'); const bP = find('blog_post');
      let ov: OverviewItem[] = [];
      if (cP && Array.isArray(cP.caseOverview)) ov = cP.caseOverview as OverviewItem[];
      else if (oP && Array.isArray(oP.caseOverview)) ov = oP.caseOverview as OverviewItem[];
      if (ov.length) setCaseOverview(ov);

      const hasCausal = cP && cP.causalFlow;
      const normCausal = hasCausal ? asCausal(cP!.causalFlow) : null;
      const normOutline = oP && oP.outline ? asOutline(oP.outline) : null;
      const normBlog = bP && (bP.bodyMarkdown || bP.title) ? asBlog(bP) : null;
      if (normCausal) { setCausal(normCausal); lastSavedCausalRef.current = JSON.stringify(normCausal); }
      if (normOutline) setOutline(normOutline);
      if (normBlog) setBlog(normBlog);
      setConfirmed(Boolean(bP?.confirmed));
      setSavedFlag(Boolean(bP?.saved));
      // 저장된 단계는 서로 일관됐다고 보고 서명을 맞춰둔다(불필요한 재생성 확인 방지).
      if (normCausal && normOutline) setOutlineBasis(JSON.stringify(normCausal));
      if (normOutline && normBlog) setBlogBasis(JSON.stringify(normOutline));
      setLoadedRunId(runId);

      if (bP && (bP.bodyMarkdown || bP.title)) setStep(3);
      else if (oP && oP.outline) setStep(2);
      else if (hasCausal) setStep(1);
      else { await genCausal(); return; } // 저장된 게 없으면 1단계 생성
      setGenLoading(null);
    } catch {
      // 로드 실패 → 생성으로 폴백
      await genCausal();
    }
  }

  // 2단계 — 섹션 아웃라인. 입력=검수된 causalFlow(1단계의 모든 정보).
  async function genOutline() {
    if (!causal) return;
    setGenLoading(2); setError(null); setSavedMsg('');
    try {
      await callSave('blog_causal', { causalFlow: causal, caseOverview }); // 검수본 저장 후 다음 단계 입력
      lastSavedCausalRef.current = JSON.stringify(causal);
      const g = await callGenerate({ contentType: 'blog_outline', causalFlow: causal });
      setOutline(asOutline(g.outline));
      setOutlineBasis(JSON.stringify(causal));
      setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : '아웃라인 생성 실패'); }
    finally { setGenLoading(null); }
  }

  // 3단계 — 블로그 글. 입력=검수된 outline.
  async function genBlog() {
    if (!outline) return;
    setGenLoading(3); setError(null); setSavedMsg('');
    try {
      await callSave('blog_outline', { outline, caseOverview });
      // causalFlow 도 함께: 수술 절차(procedure) 등 세부는 outline facts 가 아니라 causalFlow 에서 읽어 풀어씀.
      const g = await callGenerate({ contentType: 'blog_post', outline, causalFlow: causal });
      setBlog(asBlog(g));
      setBlogBasis(JSON.stringify(outline));
      setStep(3);
    } catch (e) { setError(e instanceof Error ? e.message : '블로그 글 작성 실패'); }
    finally { setGenLoading(null); }
  }

  // 3단계 블로그 글의 한 섹션만 다시 생성(피드백 반영)/간결화(내용 유지·글자수 ~10%↓). 실패 시 null.
  async function generateBlogSection(args: { mode: 'regenerate' | 'condense'; heading: string; body: string; feedback: string }): Promise<{ heading: string; body: string } | null> {
    setError(null);
    try {
      const g = await callGenerate({ contentType: 'blog_section', mode: args.mode, heading: args.heading, body: args.body, feedback: args.feedback });
      const sec = (g.section ?? {}) as { heading?: unknown; body?: unknown };
      const body = typeof sec.body === 'string' ? sec.body : '';
      if (!body.trim()) return null;
      const heading = typeof sec.heading === 'string' && sec.heading.trim() ? sec.heading.trim() : args.heading;
      return { heading, body };
    } catch (e) {
      setError(e instanceof Error ? e.message : '섹션 처리 실패');
      return null;
    }
  }

  // 5단계 — 진단 기반 섹션별 이미지 배정(비전). 결과를 아웃라인 imageFileNames 에 반영·저장.
  async function genImages() {
    if (!outline) return;
    setGenLoading(4); setError(null); setSavedMsg('');
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

  // 블로그 글 확정 — 확인 후 잠금(AI 재생성 불가), 이미지 단계로 이동하며 이미지 분석 1회 실행.
  async function confirmBlog() {
    if (!blog) return;
    if (!window.confirm('블로그글 확정 이후에는 수기 수정만 가능하며 AI 재생성은 불가합니다.\n\n확정할까요?')) return;
    setSaving(true); setError(null); setSavedMsg('');
    try {
      await callSave('blog_post', { ...blog, confirmed: true, saved: savedFlag });
      setConfirmed(true);
      setStep(4);
    } catch (e) { setError(e instanceof Error ? e.message : '확정 실패'); setSaving(false); return; }
    setSaving(false);
    void genImages();
  }

  // 다음 단계로: 이미 생성된 게 있으면 유지(이동만), 이전 단계가 바뀐 경우에만 재생성 확인.
  // 1단계(인과 흐름) → 2단계(아웃라인)
  function nextFromCausal() {
    if (!causal) return;
    if (confirmed) { setStep(2); setSavedMsg(''); return; } // 확정 후엔 재생성 없이 이동만
    if (!outline) { void genOutline(); return; } // 처음이면 생성
    if (JSON.stringify(causal) === outlineBasis) { setStep(2); setSavedMsg(''); return; } // 안 바뀜 → 이동만
    let changes: string[] = [];
    try { if (outlineBasis) changes = diffCausal(asCausal(JSON.parse(outlineBasis)), causal); } catch { /* noop */ }
    if (confirmRegen('인과 흐름이 변경되었습니다.', changes, '아웃라인을 다시 생성할까요?')) void genOutline();
    else { setStep(2); setSavedMsg(''); }
  }
  // 2단계(아웃라인) → 3단계(블로그 글)
  function nextFromOutline() {
    if (!outline) return;
    if (confirmed) { setStep(3); setSavedMsg(''); return; } // 확정 후엔 재생성 없이 이동만
    if (!blog) { void genBlog(); return; }
    if (JSON.stringify(outline) === blogBasis) { setStep(3); setSavedMsg(''); return; }
    let changes: string[] = [];
    try { if (blogBasis) changes = diffOutline(JSON.parse(blogBasis) as Outline, outline); } catch { /* noop */ }
    if (confirmRegen('아웃라인이 변경되었습니다.', changes, '블로그 글을 다시 생성할까요?')) void genBlog();
    else { setStep(3); setSavedMsg(''); }
  }

  async function saveCurrent() {
    setSaving(true); setError(null); setSavedMsg('');
    try {
      if (step === 1 && causal) { await callSave('blog_causal', { causalFlow: causal, caseOverview }); lastSavedCausalRef.current = JSON.stringify(causal); }
      else if (step === 2 && outline) await callSave('blog_outline', { outline, caseOverview });
      else if (step === 3 && blog) await callSave('blog_post', { ...blog, confirmed, saved: savedFlag });
      else if (step === 4 && outline) await callSave('blog_outline', { outline, caseOverview });
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

  // PDF 추출 검사결과(날짜별). 좌측 참고 패널용. 열 때마다 새로 가져온다.
  async function loadLabResults() {
    try {
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(runId)}/detail`, { credentials: 'include' });
      const data = (await res.json()) as { labItemsByDate?: unknown };
      const arr = res.ok && Array.isArray(data.labItemsByDate) ? data.labItemsByDate : [];
      const dates: LabDate[] = arr
        .map((dRaw) => {
          const d = (dRaw ?? {}) as Record<string, unknown>;
          const itemsRaw = Array.isArray(d.items) ? d.items : [];
          const items: LabItem[] = itemsRaw
            .map((iRaw) => {
              const it = (iRaw ?? {}) as Record<string, unknown>;
              const flag = String(it.flag ?? '');
              return {
                itemName: String(it.itemName ?? ''),
                valueText: String(it.valueText ?? ''),
                unit: it.unit != null ? String(it.unit) : null,
                referenceRange: it.referenceRange != null ? String(it.referenceRange) : null,
                flag: (['low', 'high', 'normal', 'unknown'].includes(flag) ? flag : '') as LabItem['flag'],
              };
            })
            .filter((it) => it.itemName || it.valueText);
          return { dateTime: String(d.dateTime ?? ''), items };
        })
        .filter((d) => d.items.length);
      setLabDates(dates);
    } catch {
      /* 검사결과 없거나 조회 실패 시 무시 */
    }
  }

  function openModal() {
    setOpen(true); setError(null); setSavedMsg('');
    void loadCaseImages();
    void loadLabResults();
    if (loadedRunId !== runId) {
      setStep(1); setCausal(null); setOutline(null); setBlog(null); setCaseOverview([]); setConfirmed(false);
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
    setCausal((c) => (c ? { ...c, phases: [...c.phases, { id: `phase_${uid()}`, name: '', period: '', actions: [], nextStep: [] }] } : c)); dirty();
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
      updatePhase(i, { name: np.name, period: np.period, actions: np.actions, nextStep: np.nextStep });
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
    setOutline((o) => (o ? { ...o, sections: [...o.sections, { id: `sec_${uid()}`, tag: '', label: '', period: '', points: [], facts: [], imageFileNames: [] }] } : o)); dirty();
  }
  function removeSection(i: number) {
    setOutline((o) => (o ? { ...o, sections: o.sections.filter((_, j) => j !== i) } : o)); dirty();
  }
  function setBlogField<K extends keyof BlogPost>(k: K, v: BlogPost[K]) {
    setBlog((b) => (b ? { ...b, [k]: v } : b)); dirty();
  }

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
                {([[1, '인과 흐름'], [2, '아웃라인'], [3, '블로그 글'], [4, '이미지']] as [StepNum, string][]).map(([n, label]) => {
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
                {/* 우측 컨트롤 헤더와 같은 높이의 스페이서 — 좌우 카드 시작 높이 정렬 */}
                <div style={{ height: 34, marginBottom: 8, flexShrink: 0 }} aria-hidden />
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 8, alignContent: 'start' }}>
                  {/* 케이스 개요 카드 — 검사결과 카드와 같은 레벨(카드 안 헤더 토글) */}
                  <div style={refCardBox}>
                    <button
                      type="button"
                      onClick={() => setOverviewOpen((v) => !v)}
                      style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: overviewOpen ? 8 : 0, background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                    >
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 10 }}>{overviewOpen ? '▾' : '▸'}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>케이스 개요 (담당자 작성)</span>
                      {missingOverview > 0 ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)' }}>⚠ 미작성 {missingOverview}</span> : null}
                    </button>
                    {overviewOpen ? (
                      caseOverview.length ? (
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
                      )
                    ) : null}
                  </div>

                  {/* PDF 추출 검사결과(날짜별) — 케이스 개요와 같은 레벨의 카드 */}
                  <LabResultsPanel dates={labDates} open={labOpen} onToggle={() => setLabOpen((v) => !v)} />
                </div>
              </div>

              {/* 우 — 단계 편집 */}
              <div style={{ flex: '6.5 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, height: 34, marginBottom: 8, flexShrink: 0 }}>
                  {savedMsg ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>{savedMsg}</span> : null}
                  {step === 4 ? (
                    <button type="button" style={btnSecondary} onClick={() => void genImages()} disabled={busy}>
                      {genLoading === 4 ? '분석 중…' : '이미지 다시 분석'}
                    </button>
                  ) : confirmed ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>확정됨 · 수기 수정만 가능</span>
                  ) : (
                    <button type="button" style={btnSecondary} onClick={() => { if (step === 1) void genCausal(); else if (step === 2) void genOutline(); else void genBlog(); }} disabled={busy}>
                      {genLoading === step ? '생성 중…' : '전체 다시 생성'}
                    </button>
                  )}
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
                    genLoading === 2 && !outline ? <Loading text="AI가 아웃라인을 배치하는 중…" /> : (
                      <OutlineEditor outline={outline} causal={causal} updateSection={updateSection} moveSection={moveSection} addSection={addSection} removeSection={removeSection} imageMeta={(fn) => imageMetaByName.get(fn) ?? null} />
                    )
                  ) : step === 3 ? (
                    genLoading === 3 && !blog ? <Loading text="AI가 블로그 글을 작성하는 중…" /> : (
                      <BlogEditor blog={blog} setField={setBlogField} outline={outline} imageMeta={(fn) => imageMetaByName.get(fn) ?? null} generateSection={generateBlogSection} confirmed={confirmed} />
                    )
                  ) : (
                    genLoading === 4 ? <Loading text="AI가 진단 기반으로 이미지를 배정하는 중…" /> : (
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
                <button type="button" style={btnSecondary} onClick={() => void saveCurrent()} disabled={busy || (step === 1 ? !causal : step === 2 ? !outline : step === 3 ? !blog : !outline)}>
                  {saving ? '저장 중…' : '저장'}
                </button>
                {step === 1 ? (
                  <button type="button" style={btnPrimary} onClick={() => nextFromCausal()} disabled={busy || !causal}>{genLoading === 2 ? '생성 중…' : '다음: 아웃라인 →'}</button>
                ) : step === 2 ? (
                  <button type="button" style={btnPrimary} onClick={() => nextFromOutline()} disabled={busy || !outline}>{genLoading === 3 ? '생성 중…' : '다음: 글 작성 →'}</button>
                ) : step === 3 ? (
                  confirmed ? (
                    <button type="button" style={btnPrimary} onClick={() => { setStep(4); setSavedMsg(''); }} disabled={busy}>다음: 이미지 →</button>
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
      <button type="button" style={iconBtn} onClick={onUp} disabled={busy} title="위로 이동" aria-label="위로 이동">↑</button>
      <button type="button" style={iconBtn} onClick={onDown} disabled={busy} title="아래로 이동" aria-label="아래로 이동">↓</button>
      <button type="button" style={iconBtnDanger} onClick={onRemove} disabled={busy} title="삭제" aria-label="삭제">✕</button>
    </div>
  );
}

// 한 날짜(phase) 카드: 날짜를 제목처럼, 행위별 카드(무엇/왜/결과 + 성격 해시태그),
// 맨 아래 Next step + 날짜별 다시 생성(피드백 반영).
function PhaseCard({ p, isLast, busy, regenBusy, onUp, onDown, onRemove, update, onRegen }: {
  p: Phase; isLast: boolean; busy: boolean; regenBusy: boolean; onUp: () => void; onDown: () => void; onRemove: () => void;
  update: (patch: Partial<Phase>) => void; onRegen: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const setActions = (actions: Action[]) => update({ actions });
  const updAction = (ai: number, patch: Partial<Action>) => setActions(p.actions.map((a, j) => (j === ai ? { ...a, ...patch } : a)));
  const moveAction = (ai: number, dir: -1 | 1) => { const j = ai + dir; if (j < 0 || j >= p.actions.length) return; const a = [...p.actions]; [a[ai], a[j]] = [a[j]!, a[ai]!]; setActions(a); };
  const addAction = () => setActions([...p.actions, { what: '', why: '', result: '', types: [], detail: '', procedure: [] }]);
  // 수술 절차(procedure) 편집 헬퍼
  const updProc = (ai: number, si: number, patch: Partial<ProcStep>) =>
    updAction(ai, { procedure: (p.actions[ai]?.procedure ?? []).map((s, j) => (j === si ? { ...s, ...patch } : s)) });
  const addProc = (ai: number) => updAction(ai, { procedure: [...(p.actions[ai]?.procedure ?? []), { step: '', note: '' }] });
  const rmProc = (ai: number, si: number) => updAction(ai, { procedure: (p.actions[ai]?.procedure ?? []).filter((_, j) => j !== si) });
  const rmAction = (ai: number) => setActions(p.actions.filter((_, j) => j !== ai));
  // 행위(카드)별 성격 태그 토글. 외과↔내과는 상호 배타 — 켤 때 다른 하나는 끈다.
  const toggleActionType = (ai: number, t: string) => {
    const cur = p.actions[ai]?.types ?? [];
    if (cur.includes(t)) { updAction(ai, { types: cur.filter((x) => x !== t) }); return; }
    const other = t === 'surgical' ? 'medical' : t === 'medical' ? 'surgical' : null;
    const base = other ? cur.filter((x) => x !== other) : cur;
    updAction(ai, { types: [...base, t] });
  };

  const nextSteps = p.nextStep.filter((s) => s.trim());

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
          <button type="button" onClick={() => setRegenOpen(true)} disabled={busy} style={iconBtn} title="이 날짜 다시 생성" aria-label="이 날짜 다시 생성">
            {regenBusy ? '…' : '↻'}
          </button>
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            disabled={busy}
            style={editMode ? iconBtnActive : iconBtn}
            title={editMode ? '수정 완료' : '수기 수정'}
            aria-label={editMode ? '수정 완료' : '수기 수정'}
          >
            {editMode ? '✓' : '✎'}
          </button>
          {editMode ? (
            <>
              <button type="button" style={iconBtn} onClick={onUp} disabled={busy} title="위로 이동" aria-label="위로 이동">↑</button>
              <button type="button" style={iconBtn} onClick={onDown} disabled={busy} title="아래로 이동" aria-label="아래로 이동">↓</button>
            </>
          ) : null}
          <button type="button" style={iconBtnDanger} onClick={onRemove} disabled={busy} title="삭제" aria-label="삭제">✕</button>
        </div>
      </div>

      {editMode ? (
        <>
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
                  {/* 이 행위의 성격 해시태그(다중 선택) — 1단계는 진료 7종만 */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                    {CLINICAL_TAG_ORDER.map((t) => (
                      <button key={t} type="button" onClick={() => toggleActionType(ai, t)} disabled={busy} style={hashChip((a.types ?? []).includes(t))}>
                        #{ACTION_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, alignItems: 'start' }}>
                    <AutoTextarea label="목적" value={a.why} onChange={(v) => updAction(ai, { why: v })} placeholder="임상적 이유" />
                    <AutoTextarea label="결과" value={a.result} onChange={(v) => updAction(ai, { result: v })} placeholder="도출된 결과" />
                  </div>
                  {/* 수술 절차(단계별) — #수술 카드에만. 한 단계 = 가로로 긴 박스(절차 + 부연 설명) */}
                  {(a.types ?? []).includes('surgical') ? (
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      <span style={fieldLabel}>수술 절차 (단계별 · 시간순)</span>
                      {(a.procedure ?? []).map((s, si) => (
                        <div key={si} style={procBox}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={procNumBadge}>{si + 1}</span>
                            <input value={s.step} onChange={(e) => updProc(ai, si, { step: e.target.value })} placeholder="절차 (예: 병변 절제)" style={{ ...inputStyle, flex: 1, fontWeight: 700 }} />
                            <button type="button" style={btnTiny} onClick={() => rmProc(ai, si)} disabled={busy} title="이 절차 삭제">✕</button>
                          </div>
                          <textarea value={s.note} onChange={(e) => updProc(ai, si, { note: e.target.value })} placeholder="이 절차에 대한 부연 설명 (무엇을·어떻게/왜)" rows={2} style={{ ...inputStyle, marginTop: 6, resize: 'vertical' }} />
                        </div>
                      ))}
                      <button type="button" style={{ ...btnTiny, alignSelf: 'flex-start' }} onClick={() => addProc(ai)} disabled={busy}>+ 절차 추가</button>
                    </div>
                  ) : (a.types ?? []).includes('medical') ? (
                    <div style={{ marginTop: 8 }}>
                      <AutoTextarea label="상세 내용 (처방한 약의 종류)" value={a.detail} onChange={(v) => updAction(ai, { detail: v })} placeholder="예: 항생제, 소염진통제 등 성분·약효 분류" />
                    </div>
                  ) : null}
                </div>
              ))
            )}
            <button type="button" style={{ ...btnTiny, alignSelf: 'flex-start' }} onClick={addAction} disabled={busy}>+ 행위 추가</button>
          </div>

          {/* Next step(편집) — 마지막 날짜는 다음 단계가 없으므로 숨김 */}
          {!isLast ? (
            <div style={nextStepBox}>
              <span style={nextStepLabel}>NEXT STEP (이 날 결정한 다음 단계 · 한 줄에 한 항목)</span>
              <textarea
                value={p.nextStep.join('\n')}
                onChange={(e) => update({ nextStep: e.target.value.split('\n') })}
                rows={2}
                style={{ ...inputStyle, marginTop: 4 }}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          {/* 행위별(읽기 전용) — 성격 해시태그를 각 행위 카드에 표시 */}
          {p.actions.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '4px 2px' }}>기록된 행위가 없는 날짜입니다.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {p.actions.map((a, ai) => (
                <div key={ai} style={actionBox}>
                  <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: actionWhatColor }}>{a.what || '—'}</div>
                    {ACTION_TYPE_ORDER.filter((t) => (a.types ?? []).includes(t)).map((t) => (
                      <span key={t} style={tagSticker}>#{ACTION_TYPE_LABEL[t]}</span>
                    ))}
                  </div>
                  {a.why.trim() ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      <span style={viewMiniLabel}>목적</span><span style={{ whiteSpace: 'pre-wrap' }}>{a.why}</span>
                    </div>
                  ) : null}
                  {a.result.trim() ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      <span style={viewMiniLabel}>결과</span><span style={{ whiteSpace: 'pre-wrap' }}>{a.result}</span>
                    </div>
                  ) : null}
                  {(a.types ?? []).includes('medical') && a.detail.trim() ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      <span style={viewMiniLabel}>상세</span><span style={{ whiteSpace: 'pre-wrap' }}>{a.detail}</span>
                    </div>
                  ) : null}
                  {(a.types ?? []).includes('surgical') && (a.procedure ?? []).length > 0 ? (
                    <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                      {a.procedure.map((s, si) => (
                        <div key={si} style={procBox}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={procNumBadge}>{si + 1}</span>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{s.step || '—'}</span>
                          </div>
                          {s.note.trim() ? <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{s.note}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Next step(읽기 전용) — 마지막 날짜는 숨김 */}
          {!isLast && nextSteps.length > 0 ? (
            <div style={nextStepBox}>
              <span style={nextStepLabel}>NEXT STEP</span>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, listStyleType: 'disc', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
                {nextSteps.map((s, i) => <li key={i} style={{ listStyleType: 'disc' }}>{s}</li>)}
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
// 흐름 요약 카드(흐름의 축 + 전신마취): 기본은 읽기 전용, '수기 수정'으로 편집.
function AxisCard({ axis, anesthesia, busy, setField }: {
  axis: string; anesthesia: boolean; busy: boolean;
  setField: <K extends keyof CausalFlow>(k: K, v: CausalFlow[K]) => void;
}) {
  const [edit, setEdit] = useState(false);
  return (
    <div style={cardBox}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: edit ? 10 : 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>흐름 요약</span>
        <button type="button" onClick={() => setEdit((v) => !v)} disabled={busy}
          style={edit ? iconBtnActive : iconBtn} title={edit ? '수정 완료' : '수기 수정'} aria-label={edit ? '수정 완료' : '수기 수정'}>
          {edit ? '✓' : '✎'}
        </button>
      </div>
      {edit ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <LabeledTextarea label="한 줄 요약" value={axis} onChange={(v) => setField('axis', v)} rows={2} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={anesthesia} onChange={(e) => setField('anesthesia', e.target.checked)} style={{ width: 15, height: 15 }} />
            전신마취 동반 (체크 시 2단계에서 마취 전 안전성 평가 비중↑)
          </label>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13.5, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{axis || '—'}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            전신마취 동반: <b style={{ color: anesthesia ? 'var(--accent)' : 'var(--text-muted)' }}>{anesthesia ? '예' : '아니오'}</b>
          </div>
        </div>
      )}
    </div>
  );
}

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
      <AxisCard axis={causal.axis} anesthesia={causal.anesthesia} busy={busy} setField={setField} />
      {causal.phases.map((p, i) => (
        <PhaseCard key={p.id} p={p} isLast={i === causal.phases.length - 1} busy={busy || phaseBusy !== null} regenBusy={phaseBusy === i}
          onUp={() => movePhase(i, -1)} onDown={() => movePhase(i, 1)} onRemove={() => removePhase(i)}
          update={(patch) => updatePhase(i, patch)} onRegen={(fb) => regenPhase(i, fb)} />
      ))}
      <button type="button" style={{ ...btnSecondary, width: '100%' }} onClick={addPhase} disabled={busy}>+ 단계 추가</button>
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
// 아웃라인 섹션 좌측 행위 카드 칩 — 제목(what)만 보이고, hover 하면 목적·결과(있으면 상세/절차)를 툴팁으로.
function OutlineActionChip({ a }: { a: Action }) {
  const [hover, setHover] = useState(false);
  const isMed = (a.types ?? []).includes('medical');
  const isSurg = (a.types ?? []).includes('surgical');
  const hasDetail = Boolean(a.why.trim() || a.result.trim() || (isMed && a.detail.trim()) || (isSurg && (a.procedure ?? []).length > 0));
  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ ...actionBox, padding: '5px 9px', cursor: hasDetail ? 'help' : 'default', display: 'flex', alignItems: 'flex-start', gap: 5 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: actionWhatColor, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>{a.what || '—'}</span>
        {hasDetail ? <span style={{ flexShrink: 0, marginTop: 1, fontSize: 10, color: 'var(--text-muted)' }}>ⓘ</span> : null}
      </div>
      {hover && hasDetail ? (
        <div style={{ position: 'absolute', top: -2, left: '100%', marginLeft: 8, zIndex: 60, width: 280, maxWidth: '60vw', background: 'var(--text)', color: '#fff', borderRadius: 8, padding: '9px 11px', boxShadow: '0 8px 24px rgba(0,0,0,0.28)', fontSize: 11.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {a.why.trim() ? <div><b style={{ opacity: 0.7 }}>목적 </b>{a.why}</div> : null}
          {a.result.trim() ? <div style={{ marginTop: a.why.trim() ? 4 : 0 }}><b style={{ opacity: 0.7 }}>결과 </b>{a.result}</div> : null}
          {isMed && a.detail.trim() ? <div style={{ marginTop: 4 }}><b style={{ opacity: 0.7 }}>상세 </b>{a.detail}</div> : null}
          {isSurg && (a.procedure ?? []).length > 0 ? <div style={{ marginTop: 4 }}><b style={{ opacity: 0.7 }}>절차 </b>{a.procedure.map((s, si) => `${si + 1}. ${s.step}`).join('  →  ')}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// 아웃라인 섹션 1개 = 읽기 편한 박스. 기본은 읽기 전용(해시태그 제목 + 핵심요약/팩트 불릿),
// '수기 수정'으로 편집 모드(태그 선택 + 요약/팩트 입력). 1단계 PhaseCard 와 동일한 UX.
function SectionCard({ s, i, tagCards, updateSection, moveSection, removeSection, imageMeta }: {
  s: Section; i: number; tagCards: { period: string; actions: Action[] }[];
  updateSection: (i: number, patch: Partial<Section>) => void;
  moveSection: (i: number, dir: -1 | 1) => void; removeSection: (i: number) => void;
  imageMeta: (fileName: string) => CaseImg | null;
}) {
  const [edit, setEdit] = useState(false);
  const title = s.tag ? `#${ACTION_TYPE_LABEL[s.tag] ?? s.tag}` : s.label ? `#${s.label}` : '(섹션 태그 없음)';
  const totalCards = tagCards.reduce((n, g) => n + g.actions.length, 0);
  const points = s.points.filter((p) => p.trim());
  const facts = s.facts.filter((f) => f.trim());
  const listUl: CSSProperties = { margin: 0, paddingLeft: 18, listStyleType: 'disc', fontSize: 13, lineHeight: 1.6 };
  return (
    <div style={cardBox}>
      {/* 헤더: 해시태그 제목(편집 시 태그 선택) + 수기수정/이동/삭제 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        {edit ? (
          <select
            value={s.tag}
            onChange={(e) => updateSection(i, { tag: e.target.value, label: e.target.value ? (ACTION_TYPE_LABEL[e.target.value] ?? s.label) : s.label })}
            style={{ ...inputStyle, fontWeight: 700, maxWidth: 240 }}
          >
            <option value="">(태그 없음)</option>
            {ACTION_TYPE_ORDER.map((t) => <option key={t} value={t}>#{ACTION_TYPE_LABEL[t]}</option>)}
          </select>
        ) : (
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)' }}>{title}</div>
        )}
        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setEdit((v) => !v)}
            style={edit ? iconBtnActive : iconBtn}
            title={edit ? '수정 완료' : '수기 수정'} aria-label={edit ? '수정 완료' : '수기 수정'}
          >
            {edit ? '✓' : '✎'}
          </button>
          {edit ? (
            <>
              <button type="button" style={iconBtn} onClick={() => moveSection(i, -1)} title="위로 이동" aria-label="위로 이동">↑</button>
              <button type="button" style={iconBtn} onClick={() => moveSection(i, 1)} title="아래로 이동" aria-label="아래로 이동">↓</button>
            </>
          ) : null}
          <button type="button" style={iconBtnDanger} onClick={() => removeSection(i)} title="삭제" aria-label="삭제">✕</button>
        </div>
      </div>

      {/* 본문: 좌(행위 카드 제목 · hover 상세) 3 | 우(핵심요약·팩트·이미지) 7 */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {/* 좌 — 이 태그가 붙은 인과 흐름 카드(제목만, hover 로 상세). 날짜별로 묶어 표시. 카드 없으면(서술 섹션) 생략 */}
        {s.tag && totalCards ? (
          <div style={{ flex: '3 1 0', minWidth: 0, display: 'grid', gap: 6, alignContent: 'start' }}>
            <span style={fieldLabel}>행위 카드 {totalCards}개</span>
            <div style={{ display: 'grid', gap: 8 }}>
              {tagCards.map((g, gi) => (
                <div key={gi} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '-0.01em' }}>{g.period || '날짜 미상'}</span>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {g.actions.map((a, ai) => <OutlineActionChip key={ai} a={a} />)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* 우 — 핵심 요약 + 팩트 (+ 이미지) */}
        <div style={{ flex: s.tag && totalCards ? '7 1 0' : '1 1 0', minWidth: 0, display: 'grid', gap: 10 }}>
          {edit ? (
            <>
              <LabeledTextarea label="핵심 요약 (한 줄에 하나 · 서술 방향)" value={s.points.join('\n')} onChange={(v) => updateSection(i, { points: v.split('\n') })} rows={3} />
              <LabeledTextarea label="팩트 facts (한 줄에 하나 · 반드시 들어갈 데이터)" value={s.facts.join('\n')} onChange={(v) => updateSection(i, { facts: v.split('\n') })} rows={3} />
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={fieldLabel}>핵심 요약</span>
                {points.length ? (
                  <ul style={{ ...listUl, color: 'var(--text)' }}>
                    {points.map((p, k) => <li key={k} style={{ listStyleType: 'disc' }}>{p}</li>)}
                  </ul>
                ) : <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>—</span>}
              </div>
              {facts.length ? (
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={fieldLabel}>팩트</span>
                  <ul style={{ ...listUl, color: 'var(--text-secondary)' }}>
                    {facts.map((f, k) => {
                      // 앞에 공백이 있으면 2차 불릿(들여쓰기), ":"로 끝나면 그룹 헤더(예: "혈액검사:").
                      const isSub = /^\s/.test(f);
                      const text = f.trim();
                      const isHeader = !isSub && text.endsWith(':');
                      return (
                        <li
                          key={k}
                          style={{
                            listStyleType: isSub ? 'circle' : 'disc',
                            marginLeft: isSub ? 16 : 0,
                            fontWeight: isHeader ? 700 : 400,
                            color: isHeader ? 'var(--text)' : 'var(--text-secondary)',
                          }}
                        >{text}</li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </>
          )}
          {s.imageFileNames.length > 0 ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={fieldLabel}>관련 이미지</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {s.imageFileNames.map((fn) => (
                  <CaseImageThumb key={fn} fileName={fn} meta={imageMeta(fn)} onRemove={edit ? () => updateSection(i, { imageFileNames: s.imageFileNames.filter((x) => x !== fn) }) : undefined} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OutlineEditor({ outline, causal, updateSection, moveSection, addSection, removeSection, imageMeta }: {
  outline: Outline | null;
  causal: CausalFlow | null;
  updateSection: (i: number, patch: Partial<Section>) => void;
  moveSection: (i: number, dir: -1 | 1) => void; addSection: () => void; removeSection: (i: number) => void;
  imageMeta: (fileName: string) => CaseImg | null;
}) {
  if (!outline) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>아웃라인이 없습니다. “다시 생성”을 눌러 주세요.</div>;
  // 해시태그 섹션에 묶일 카드: 그 태그가 붙은 행위를 날짜(phase)별로 묶어 반환(빈 날짜 제외). 다중 태그면 여러 섹션에 중복 등장.
  const cardsForTag = (tag: string): { period: string; actions: Action[] }[] =>
    tag && causal
      ? causal.phases
          .map((p) => ({ period: p.period, actions: p.actions.filter((a) => (a.types ?? []).includes(tag)) }))
          .filter((g) => g.actions.length > 0)
      : [];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {outline.sections.map((s, i) => (
        <SectionCard
          key={s.id}
          s={s}
          i={i}
          tagCards={cardsForTag(s.tag)}
          updateSection={updateSection}
          moveSection={moveSection}
          removeSection={removeSection}
          imageMeta={imageMeta}
        />
      ))}
      <button type="button" style={{ ...btnSecondary, width: '100%' }} onClick={addSection}>+ 섹션 추가</button>
    </div>
  );
}

// ── 3단계 에디터 ──
// 블로그 본문(마크다운)을 "## 헤딩" 기준으로 섹션 분할. 첫 헤딩 앞 내용은 heading="" 로.
function parseBlogSections(md: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  let cur: { heading: string; body: string } | null = null;
  for (const line of md.split('\n')) {
    const m = /^#{1,4}\s+(.*)$/.exec(line.trim());
    if (m) {
      if (cur) out.push(cur);
      cur = { heading: m[1].trim(), body: '' };
    } else {
      if (!cur) cur = { heading: '', body: '' };
      cur.body += (cur.body ? '\n' : '') + line;
    }
  }
  if (cur) out.push(cur);
  return out.filter((s) => s.heading || s.body.trim());
}

// 블로그 섹션 본문 렌더 — 빈 줄로 문단 분리, "[사진: 설명]" 은 칩으로 표시.
function BlogBody({ body }: { body: string }) {
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {blocks.map((b, i) => {
        const photo = /^\[사진:\s*(.*?)\]$/.exec(b);
        if (photo) {
          return (
            <div key={i} style={{ justifySelf: 'start', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-subtle)', border: '1px dashed var(--border-strong)', borderRadius: 6, padding: '4px 10px' }}>
              📷 {photo[1] || '사진'}
            </div>
          );
        }
        return <p key={i} style={{ margin: 0, fontSize: 13.5, lineHeight: 1.75, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{b}</p>;
      })}
    </div>
  );
}

// 섹션 배열 → 마크다운 재구성. "## 제목\n\n본문" 블록을 빈 줄로 잇는다.
function rebuildBlogMarkdown(sections: { heading: string; body: string }[]): string {
  return sections
    .map((s) => [s.heading.trim() ? `## ${s.heading.trim()}` : '', s.body.trim()].filter(Boolean).join('\n\n'))
    .filter(Boolean)
    .join('\n\n');
}

function BlogEditor({ blog, setField, outline, imageMeta, generateSection, confirmed }: {
  blog: BlogPost | null;
  setField: <K extends keyof BlogPost>(k: K, v: BlogPost[K]) => void;
  outline: Outline | null;
  imageMeta: (fileName: string) => CaseImg | null;
  generateSection: (args: { mode: 'regenerate' | 'condense'; heading: string; body: string; feedback: string }) => Promise<{ heading: string; body: string } | null>;
  confirmed: boolean;
}) {
  const [draft, setDraft] = useState<{ index: number; heading: string; body: string } | null>(null); // 인라인 수기 수정 중인 섹션
  const [tagsEdit, setTagsEdit] = useState(false); // 태그 편집 모드(끄면 해시태그처럼 표시)
  const [busy, setBusy] = useState<{ index: number; mode: 'regenerate' | 'condense' } | null>(null); // AI 처리 중인 섹션
  const [regen, setRegen] = useState<{ index: number; text: string } | null>(null); // 다시 생성 피드백 모달
  if (!blog) return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12 }}>블로그 글이 없습니다. “다시 생성”을 눌러 주세요.</div>;
  const liveCount = blog.bodyMarkdown.length;
  const inRange = liveCount >= 2500 && liveCount <= 3500;
  const sectionsWithImages = (outline?.sections ?? []).filter((s) => s.imageFileNames.length > 0);
  const sections = parseBlogSections(blog.bodyMarkdown);

  // 섹션 i 를 새 내용으로 교체 → 전체 마크다운 재구성해 저장(수기수정·재생성·간결화 공통).
  const applySection = (index: number, next: { heading: string; body: string }) => {
    setField('bodyMarkdown', rebuildBlogMarkdown(sections.map((s, j) => (j === index ? next : s))));
  };
  const runOp = async (index: number, mode: 'regenerate' | 'condense', feedback: string) => {
    const sec = sections[index];
    if (!sec || busy) return;
    setBusy({ index, mode });
    const res = await generateSection({ mode, heading: sec.heading, body: sec.body, feedback });
    if (res) applySection(index, res);
    setBusy(null);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* 상단 바: 총 글자수 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: inRange ? 'var(--success)' : 'var(--danger)' }}>총 {liveCount.toLocaleString()}자 (목표 2,500~3,500)</span>
      </div>

      {/* 관련 이미지 (아웃라인 연결 · 참고용) */}
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

      {/* 제목 — 가장 큰 헤딩(인라인 편집 가능) */}
      <div style={cardBox}>
        <input
          value={blog.title}
          onChange={(e) => setField('title', e.target.value)}
          placeholder="제목"
          style={{ width: '100%', fontSize: 16, fontWeight: 800, color: 'var(--text)', lineHeight: 1.4, border: 'none', outline: 'none', background: 'transparent', padding: 0 }}
        />
      </div>
      {/* 섹션별 카드 — 제목 라인은 크고 굵은 색 글씨 + [다시 생성/수기 수정/간결화] + 글자수 */}
      {sections.length ? sections.map((sec, i) => {
            const isBusy = busy?.index === i;
            const count = sec.body.trim().length;
            if (draft?.index === i) {
              return (
                <div key={i} style={cardBox}>
                  <input value={draft.heading} onChange={(e) => setDraft({ ...draft, heading: e.target.value })} placeholder="섹션 제목" style={{ ...inputStyle, fontWeight: 800, color: 'var(--accent)', marginBottom: 8 }} />
                  <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={12} style={inputStyle} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)' }}>{draft.body.trim().length}자</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" style={btnTiny} onClick={() => setDraft(null)}>취소</button>
                      <button type="button" style={{ ...btnTiny, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }} onClick={() => { applySection(i, { heading: draft.heading, body: draft.body }); setDraft(null); }}>수정 완료</button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={i} style={{ ...cardBox, opacity: isBusy ? 0.55 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', lineHeight: 1.4, flex: 1, minWidth: 0 }}>{sec.heading || '(제목 없음)'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)' }}>{count.toLocaleString()}자</span>
                    {isBusy ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>{busy?.mode === 'condense' ? '간결화 중…' : '생성 중…'}</span>
                    ) : (
                      <>
                        {!confirmed ? <button type="button" style={iconBtn} disabled={Boolean(busy)} onClick={() => setRegen({ index: i, text: '' })} title="다시 생성" aria-label="다시 생성">↻</button> : null}
                        <button type="button" style={iconBtn} disabled={Boolean(busy)} onClick={() => setDraft({ index: i, heading: sec.heading, body: sec.body })} title="수기 수정" aria-label="수기 수정">✎</button>
                        {!confirmed ? <button type="button" style={iconBtn} disabled={Boolean(busy)} onClick={() => void runOp(i, 'condense', '')} title="간결화" aria-label="간결화">{'✂︎'}</button> : null}
                      </>
                    )}
                  </div>
                </div>
                <BlogBody body={sec.body} />
              </div>
            );
          }) : (
            <div style={cardBox}><BlogBody body={blog.bodyMarkdown} /></div>
          )}
          {/* 태그 — 편집 아닐 땐 해시태그처럼, 편집 버튼(✎)으로 수정 */}
          <div style={cardBox}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <span style={fieldLabel}>태그</span>
              <button type="button" style={tagsEdit ? iconBtnActive : iconBtn} onClick={() => setTagsEdit((v) => !v)} title={tagsEdit ? '수정 완료' : '수기 수정'} aria-label={tagsEdit ? '수정 완료' : '수기 수정'}>{tagsEdit ? '✓' : '✎'}</button>
            </div>
            {tagsEdit ? (
              <textarea
                value={blog.tags.join('\n')}
                onChange={(e) => setField('tags', e.target.value.split('\n').map((t) => t.trim().replace(/^#/, '')).filter(Boolean))}
                rows={3}
                placeholder="한 줄에 하나"
                style={inputStyle}
              />
            ) : blog.tags.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {blog.tags.map((t, i) => (
                  <span key={i} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-subtle)', borderRadius: 999, padding: '3px 10px' }}>#{t}</span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>태그 없음</span>
            )}
          </div>

      {/* 다시 생성 — 피드백 입력 모달 */}
      {regen ? (
        <div style={regenOverlay} onClick={() => setRegen(null)}>
          <div style={regenDialog} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>이 섹션 다시 생성</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, marginBottom: 10 }}>
              어떤 부분을 어떻게 고칠지 알려주세요. 그 내용을 반영해 이 섹션만 다시 씁니다.
              <br />(비워두면 뜻은 유지한 채 문장 품질만 개선)
            </div>
            <textarea
              value={regen.text}
              onChange={(e) => setRegen({ ...regen, text: e.target.value })}
              placeholder="예: 검사 결과를 더 짧게 / 보호자 공감 문장을 앞에 / 이 부분 톤을 더 부드럽게"
              rows={4}
              autoFocus
              style={inputStyle}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" style={btnSecondary} onClick={() => setRegen(null)}>취소</button>
              <button type="button" style={btnPrimary} onClick={() => { const r = regen; setRegen(null); void runOp(r.index, 'regenerate', r.text); }}>다시 생성</button>
            </div>
          </div>
        </div>
      ) : null}
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
