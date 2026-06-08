'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';

// ── 타입 ──────────────────────────────────────────────────────────────────
type StepNum = 1 | 2 | 3;
type OverviewItem = { label: string; value: string };
type Phase = { id: string; name: string; period: string; type: string; what: string[]; why: string[]; toNext: string[] };
type CausalFlow = { axis: string; anesthesia: boolean; phases: Phase[] };
type Section = { id: string; label: string; points: string[]; facts: string[] };
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

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const toLines = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v.trim() ? [v] : [];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function asCausal(raw: unknown): CausalFlow {
  const o = (raw ?? {}) as Record<string, unknown>;
  const phases = Array.isArray(o.phases) ? o.phases : [];
  return {
    axis: str(o.axis),
    anesthesia: o.anesthesia === true,
    phases: phases.map((p) => {
      const x = (p ?? {}) as Record<string, unknown>;
      const t = str(x.type);
      return {
        id: str(x.id) || `phase_${uid()}`,
        name: str(x.name), period: str(x.period),
        type: t === 'surgical' || t === 'medical' || t === 'diagnostic' ? t : 'medical',
        what: toLines(x.what), why: toLines(x.why), toNext: toLines(x.toNext),
      };
    }),
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
      return { id: str(x.id) || `sec_${uid()}`, label: str(x.label), points: toLines(x.points), facts: toLines(x.facts) };
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
const PHASE_TYPE_LABEL: Record<string, string> = { surgical: '수술/처치', medical: '내과 치료', diagnostic: '검사' };

// ── 작은 컴포넌트 ───────────────────────────────────────────────────────────
function LabeledTextarea({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <span style={fieldLabel}>{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} style={inputStyle} />
    </div>
  );
}

/**
 * 진료케이스 작성 — 3단계 위저드.
 * 1) 인과 흐름(causalFlow) → 2) 섹션 아웃라인(outline) → 3) 블로그 글(blogPost).
 * 각 단계는 검수·수정 → 저장(DB) → 다음 단계 입력으로 전달.
 */
export function CaseBlogButton({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<StepNum>(1);
  const [caseOverview, setCaseOverview] = useState<OverviewItem[]>([]);
  const [causal, setCausal] = useState<CausalFlow | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [blog, setBlog] = useState<BlogPost | null>(null);
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  // 하위 단계가 "어떤 입력으로" 생성됐는지 서명(JSON). 입력이 바뀌면 재생성 확인을 띄운다.
  const [outlineBasis, setOutlineBasis] = useState(''); // outline 을 만든 causal 의 서명
  const [blogBasis, setBlogBasis] = useState(''); // blog 를 만든 outline 의 서명

  const [genLoading, setGenLoading] = useState<null | 1 | 2 | 3>(null);
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
      const cP = find('blog_causal'); const oP = find('blog_outline'); const bP = find('blog_post');
      let ov: OverviewItem[] = [];
      if (cP && Array.isArray(cP.caseOverview)) ov = cP.caseOverview as OverviewItem[];
      else if (oP && Array.isArray(oP.caseOverview)) ov = oP.caseOverview as OverviewItem[];
      if (ov.length) setCaseOverview(ov);

      const hasCausal = cP && cP.causalFlow;
      const normCausal = hasCausal ? asCausal(cP!.causalFlow) : null;
      const normOutline = oP && oP.outline ? asOutline(oP.outline) : null;
      const normBlog = bP && (bP.bodyMarkdown || bP.title) ? asBlog(bP) : null;
      if (normCausal) setCausal(normCausal);
      if (normOutline) setOutline(normOutline);
      if (normBlog) setBlog(normBlog);
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

  async function genOutline() {
    if (!causal) return;
    setGenLoading(2); setError(null); setSavedMsg('');
    try {
      await callSave('blog_causal', { causalFlow: causal, caseOverview }); // 검수본 저장 후 다음 단계 입력
      const g = await callGenerate({ contentType: 'blog_outline', causalFlow: causal });
      setOutline(asOutline(g.outline));
      setOutlineBasis(JSON.stringify(causal));
      setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : '아웃라인 생성 실패'); }
    finally { setGenLoading(null); }
  }

  async function genBlog() {
    if (!outline) return;
    setGenLoading(3); setError(null); setSavedMsg('');
    try {
      await callSave('blog_outline', { outline, caseOverview });
      const g = await callGenerate({ contentType: 'blog_post', outline });
      setBlog(asBlog(g));
      setBlogBasis(JSON.stringify(outline));
      setStep(3);
    } catch (e) { setError(e instanceof Error ? e.message : '블로그 글 작성 실패'); }
    finally { setGenLoading(null); }
  }

  // 다음 단계로: 이미 생성된 게 있으면 유지(이동만), 이전 단계가 바뀐 경우에만 재생성 확인.
  function nextFromCausal() {
    if (!causal) return;
    if (!outline) { void genOutline(); return; } // 처음이면 생성
    if (JSON.stringify(causal) === outlineBasis) { setStep(2); setSavedMsg(''); return; } // 안 바뀜 → 이동만
    if (window.confirm('인과 흐름이 바뀌었습니다. 아웃라인을 다시 생성할까요?\n(취소하면 기존 아웃라인을 그대로 보여줍니다.)')) void genOutline();
    else { setStep(2); setSavedMsg(''); }
  }
  function nextFromOutline() {
    if (!outline) return;
    if (!blog) { void genBlog(); return; }
    if (JSON.stringify(outline) === blogBasis) { setStep(3); setSavedMsg(''); return; }
    if (window.confirm('아웃라인이 바뀌었습니다. 블로그 글을 다시 생성할까요?\n(취소하면 기존 글을 그대로 보여줍니다.)')) void genBlog();
    else { setStep(3); setSavedMsg(''); }
  }

  async function saveCurrent() {
    setSaving(true); setError(null); setSavedMsg('');
    try {
      if (step === 1 && causal) await callSave('blog_causal', { causalFlow: causal, caseOverview });
      else if (step === 2 && outline) await callSave('blog_outline', { outline, caseOverview });
      else if (step === 3 && blog) await callSave('blog_post', blog);
      setSavedMsg('저장됨');
    } catch (e) { setError(e instanceof Error ? e.message : '저장 실패'); }
    finally { setSaving(false); }
  }

  function openModal() {
    setOpen(true); setError(null); setSavedMsg('');
    if (loadedRunId !== runId) {
      setStep(1); setCausal(null); setOutline(null); setBlog(null); setCaseOverview([]);
      void loadAll();
    }
  }
  const closeModal = () => setOpen(false);
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
    setCausal((c) => (c ? { ...c, phases: [...c.phases, { id: `phase_${uid()}`, name: '', period: '', type: 'medical', what: [], why: [], toNext: [] }] } : c)); dirty();
  }
  function removePhase(i: number) {
    setCausal((c) => (c ? { ...c, phases: c.phases.filter((_, j) => j !== i) } : c)); dirty();
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
    setOutline((o) => (o ? { ...o, sections: [...o.sections, { id: `sec_${uid()}`, label: '', points: [], facts: [] }] } : o)); dirty();
  }
  function removeSection(i: number) {
    setOutline((o) => (o ? { ...o, sections: o.sections.filter((_, j) => j !== i) } : o)); dirty();
  }
  function setBlogField<K extends keyof BlogPost>(k: K, v: BlogPost[K]) {
    setBlog((b) => (b ? { ...b, [k]: v } : b)); dirty();
  }

  const missingOverview = caseOverview.filter((o) => !o.value).length;

  return (
    <>
      <button type="button" className="adminLegacySecondaryBtn" onClick={openModal}>진료케이스 작성</button>
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
                {([[1, '인과 흐름'], [2, '아웃라인'], [3, '블로그 글']] as [StepNum, string][]).map(([n, label]) => {
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

                  {/* 개요 누락 점검 — 2단계 아웃라인 기준, 케이스 개요 아래에 표시 */}
                  {step === 2 && outline && outline.overviewCheck.length ? (
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
                    {step === 1 ? '1단계 — 인과 흐름 (검수·수정)' : step === 2 ? '2단계 — 섹션 아웃라인 (검수·수정)' : '3단계 — 블로그 글 (검수·수정)'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {savedMsg ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>{savedMsg}</span> : null}
                    <button type="button" style={btnSecondary} onClick={() => { if (step === 1) void genCausal(); else if (step === 2) void genOutline(); else void genBlog(); }} disabled={busy}>
                      {genLoading === step ? '생성 중…' : '다시 생성'}
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
                  {genLoading === step && step === 1 && !causal ? (
                    <Loading text="AI가 인과 흐름을 재구성하는 중…" />
                  ) : step === 1 ? (
                    <CausalEditor
                      causal={causal} busy={busy}
                      setField={setCausalField} updatePhase={updatePhase} movePhase={movePhase} addPhase={addPhase} removePhase={removePhase}
                    />
                  ) : step === 2 ? (
                    genLoading === 2 && !outline ? <Loading text="AI가 아웃라인을 배치하는 중…" /> : (
                      <OutlineEditor outline={outline} updateSection={updateSection} moveSection={moveSection} addSection={addSection} removeSection={removeSection} setOutline={(o) => { setOutline(o); dirty(); }} />
                    )
                  ) : (
                    genLoading === 3 && !blog ? <Loading text="AI가 블로그 글을 작성하는 중…" /> : (
                      <BlogEditor blog={blog} setField={setBlogField} />
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
                <button type="button" style={btnSecondary} onClick={() => void saveCurrent()} disabled={busy || (step === 1 ? !causal : step === 2 ? !outline : !blog)}>
                  {saving ? '저장 중…' : '저장'}
                </button>
                {step === 1 ? (
                  <button type="button" style={btnPrimary} onClick={() => nextFromCausal()} disabled={busy || !causal}>{genLoading === 2 ? '생성 중…' : '다음: 아웃라인 →'}</button>
                ) : step === 2 ? (
                  <button type="button" style={btnPrimary} onClick={() => nextFromOutline()} disabled={busy || !outline}>{genLoading === 3 ? '생성 중…' : '다음: 글 작성 →'}</button>
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

// ── 1단계 에디터 ──
function CausalEditor({ causal, busy, setField, updatePhase, movePhase, addPhase, removePhase }: {
  causal: CausalFlow | null; busy: boolean;
  setField: <K extends keyof CausalFlow>(k: K, v: CausalFlow[K]) => void;
  updatePhase: (i: number, patch: Partial<Phase>) => void;
  movePhase: (i: number, dir: -1 | 1) => void; addPhase: () => void; removePhase: (i: number) => void;
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
        <div key={p.id} style={cardBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>단계 {i + 1}</span>
            <RowTools onUp={() => movePhase(i, -1)} onDown={() => movePhase(i, 1)} onRemove={() => removePhase(i)} busy={busy} />
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div style={{ display: 'grid', gap: 3 }}>
                <span style={fieldLabel}>단계명</span>
                <input value={p.name} onChange={(e) => updatePhase(i, { name: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gap: 3 }}>
                <span style={fieldLabel}>경과 시점</span>
                <input value={p.period} onChange={(e) => updatePhase(i, { period: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gap: 3 }}>
                <span style={fieldLabel}>성격</span>
                <select value={p.type} onChange={(e) => updatePhase(i, { type: e.target.value })} style={{ ...inputStyle, whiteSpace: 'normal' }}>
                  {Object.entries(PHASE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <LabeledTextarea label="무엇을 했나? (한 줄에 한 항목, 간단명료하게)" value={p.what.join('\n')} onChange={(v) => updatePhase(i, { what: v.split('\n') })} rows={4} />
            <LabeledTextarea label="왜 했나? (임상 원리 · 한 줄에 한 항목)" value={p.why.join('\n')} onChange={(v) => updatePhase(i, { why: v.split('\n') })} rows={4} />
            <LabeledTextarea label="결과 및 다음 단계 (검사 결과·경과 + 그에 따른 다음 단계 · 한 줄에 한 항목)" value={p.toNext.join('\n')} onChange={(v) => updatePhase(i, { toNext: v.split('\n') })} rows={4} />
          </div>
        </div>
      ))}
      <button type="button" style={{ ...btnSecondary, width: '100%' }} onClick={addPhase} disabled={busy}>+ 단계 추가</button>
    </div>
  );
}

// ── 2단계 에디터 ──
function OutlineEditor({ outline, updateSection, moveSection, addSection, removeSection, setOutline }: {
  outline: Outline | null;
  updateSection: (i: number, patch: Partial<Section>) => void;
  moveSection: (i: number, dir: -1 | 1) => void; addSection: () => void; removeSection: (i: number) => void;
  setOutline: (o: Outline) => void;
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
          </div>
        </div>
      ))}
      <button type="button" style={{ ...btnSecondary, width: '100%' }} onClick={addSection}>+ 섹션 추가</button>
    </div>
  );
}

// ── 3단계 에디터 ──
function BlogEditor({ blog, setField }: {
  blog: BlogPost | null;
  setField: <K extends keyof BlogPost>(k: K, v: BlogPost[K]) => void;
}) {
  const liveCount = blog ? blog.bodyMarkdown.length : 0;
  const inRange = liveCount >= 2000 && liveCount <= 3000;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {blog ? (
        <>
          <div style={cardBox}>
            <div style={{ display: 'grid', gap: 3 }}>
              <span style={fieldLabel}>제목</span>
              <input value={blog.title} onChange={(e) => setField('title', e.target.value)} style={{ ...inputStyle, fontWeight: 700 }} />
            </div>
          </div>
          <div style={cardBox}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={fieldLabel}>본문 (마크다운)</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: inRange ? 'var(--success)' : 'var(--danger)' }}>{liveCount.toLocaleString()}자 (목표 2,000~3,000)</span>
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
