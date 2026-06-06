'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';

type Step = 'storyline' | 'done';
type OverviewItem = { label: string; value: string };
type Part = { key: string; title: string; summary: string; facts: string[]; emphasis: string[] };

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 16,
};
const cardStyle: CSSProperties = {
  background: 'var(--bg-subtle)',
  borderRadius: 12,
  width: 'min(1400px, 96vw)',
  maxHeight: '94vh',
  overflowY: 'auto',
  padding: 24,
  boxShadow: '0 10px 40px rgba(0,0,0,0.18)',
};
const btnPrimary: CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 8,
  background: 'var(--accent)',
  color: '#fff',
  border: '1px solid var(--accent)',
  cursor: 'pointer',
};
const btnSecondary: CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 8,
  background: '#fff',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  cursor: 'pointer',
};
const fieldLabel: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '-0.01em' };
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  lineHeight: 1.5,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: '#fff',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
  resize: 'vertical',
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
};

function asPart(raw: unknown, idx: number): Part {
  const o = (raw ?? {}) as Record<string, unknown>;
  const toLines = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v.trim() ? [v] : [];
  return {
    key: typeof o.key === 'string' && o.key ? o.key : `part-${idx}`,
    title: typeof o.title === 'string' ? o.title : `파트 ${idx + 1}`,
    summary: typeof o.summary === 'string' ? o.summary : '',
    facts: toLines(o.facts),
    emphasis: toLines(o.emphasis),
  };
}

function serializeStoryline(caseOverview: OverviewItem[], parts: Part[]): string {
  const lines: string[] = [];
  if (caseOverview.length) {
    lines.push('[케이스 개요 — 담당자 작성]');
    for (const o of caseOverview) lines.push(`- ${o.label}: ${o.value}`);
    lines.push('');
  }
  lines.push('[스토리라인]');
  for (const p of parts) {
    lines.push(`## ${p.title}`);
    if (p.summary.trim()) lines.push(`한 줄 요약: ${p.summary.trim()}`);
    const facts = p.facts.map((f) => f.trim()).filter(Boolean);
    if (facts.length) {
      lines.push('언급할 팩트:');
      for (const f of facts) lines.push(`- ${f}`);
    }
    const emphasis = p.emphasis.map((e) => e.trim()).filter(Boolean);
    if (emphasis.length) {
      lines.push('강조할 내용:');
      for (const e of emphasis) lines.push(`- ${e}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/**
 * 진료케이스 작성 버튼 + 모달.
 * 1) 차트(PDF)+케이스 개요로 AI 스토리라인(5개 파트 아웃라인) 생성 — 저장 안 함, 수정 가능
 * 2) "블로그 글 작성" → 편집된 스토리라인 기반으로 blog_post 생성·저장
 * 생성된 글은 /admin/case-blog(진료케이스) 메뉴에서 열람.
 */
export function CaseBlogButton({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('storyline');
  const [caseOverview, setCaseOverview] = useState<OverviewItem[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [storylineLoading, setStorylineLoading] = useState(false);
  const [blogLoading, setBlogLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 현재 메모리 상태가 어느 run 을 반영하는지 — 같은 run 은 다시 불러오거나 재생성하지 않는다.
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);

  async function generateStoryline() {
    setStorylineLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/health-report/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, contentType: 'blog_storyline' }),
      });
      const data = (await res.json()) as {
        error?: string;
        generated?: { caseOverview?: OverviewItem[]; parts?: unknown[] };
      };
      if (!res.ok) throw new Error(data.error ?? '스토리라인 생성 실패');
      const co = Array.isArray(data.generated?.caseOverview) ? data.generated!.caseOverview! : [];
      const rawParts = Array.isArray(data.generated?.parts) ? data.generated!.parts! : [];
      setCaseOverview(co.filter((x) => x && typeof x.label === 'string'));
      setParts(rawParts.map(asPart));
      setLoadedRunId(runId);
      setSavedMsg('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '스토리라인 생성 실패');
    } finally {
      setStorylineLoading(false);
    }
  }

  // DB에 저장된 스토리라인이 있으면 불러오고(재생성 X), 없으면 AI로 새로 생성.
  async function loadStoryline() {
    setStorylineLoading(true);
    setError(null);
    setSavedMsg('');
    try {
      const res = await fetch(`/api/admin/health-report/content?runId=${encodeURIComponent(runId)}`, {
        credentials: 'include',
      });
      const data = (await res.json()) as { items?: { contentType?: string; payload?: unknown }[] };
      if (res.ok) {
        const item = (data.items ?? []).find((i) => i.contentType === 'blog_storyline');
        const payload = (item?.payload ?? null) as { caseOverview?: OverviewItem[]; parts?: unknown[] } | null;
        if (payload && Array.isArray(payload.parts) && payload.parts.length > 0) {
          setCaseOverview(Array.isArray(payload.caseOverview) ? payload.caseOverview.filter((x) => x && typeof x.label === 'string') : []);
          setParts(payload.parts.map(asPart));
          setLoadedRunId(runId);
          setStorylineLoading(false);
          return;
        }
      }
    } catch {
      // 조회 실패 시에는 생성으로 폴백.
    }
    await generateStoryline();
  }

  async function saveStoryline() {
    if (parts.length === 0) return;
    setSaving(true);
    setError(null);
    setSavedMsg('');
    try {
      const res = await fetch('/api/admin/health-report/content', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, contentType: 'blog_storyline', payload: { caseOverview, parts } }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '스토리라인 저장 실패');
      setLoadedRunId(runId);
      setSavedMsg('저장됨');
    } catch (e) {
      setError(e instanceof Error ? e.message : '스토리라인 저장 실패');
    } finally {
      setSaving(false);
    }
  }

  function openModal() {
    setOpen(true);
    setStep('storyline');
    setError(null);
    setSavedMsg('');
    // 이 run 의 상태가 이미 메모리에 있으면 그대로(편집 내용 포함), 없으면 DB 로드 → 없으면 생성.
    if (loadedRunId !== runId) {
      setCaseOverview([]);
      setParts([]);
      void loadStoryline();
    }
  }

  function closeModal() {
    setOpen(false);
  }

  function updatePart(idx: number, patch: Partial<Part>) {
    setParts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
    if (savedMsg) setSavedMsg('');
  }

  async function generateBlog() {
    if (parts.length === 0) {
      setError('스토리라인이 비어 있습니다. 먼저 생성하세요.');
      return;
    }
    setBlogLoading(true);
    setError(null);
    try {
      const storyline = serializeStoryline(caseOverview, parts);
      const res = await fetch('/api/admin/health-report/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, contentType: 'blog_post', storyline }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '블로그 글 작성 실패');
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : '블로그 글 작성 실패');
    } finally {
      setBlogLoading(false);
    }
  }

  const busy = storylineLoading || blogLoading || saving;
  const missingOverview = caseOverview.filter((o) => !o.value).length;

  return (
    <>
      <button type="button" className="adminLegacySecondaryBtn" onClick={openModal}>
        진료케이스 작성
      </button>

      {open ? (
        <div style={overlayStyle} role="presentation" onClick={closeModal}>
          <div style={cardStyle} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>진료케이스 작성</h2>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  AI가 만든 스토리라인(아웃라인)을 검토·수정한 뒤 블로그 글을 생성합니다.
                </p>
              </div>
              <button type="button" className="adminLegacySmallBtn" onClick={closeModal}>닫기</button>
            </div>

            {error ? (
              <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--danger-subtle)', color: 'var(--danger)', fontSize: 12.5 }}>
                {error}
              </div>
            ) : null}

            {step === 'storyline' ? (
              <>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  {/* LEFT — 케이스 개요 (담당자 작성, 그대로 표시) */}
                  <div style={{ flex: '1 1 0', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>케이스 개요 (담당자 작성)</span>
                      {missingOverview > 0 ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)' }}>
                          ⚠ 미작성 {missingOverview}개 항목
                        </span>
                      ) : null}
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', maxHeight: '74vh', overflowY: 'auto' }}>
                      {caseOverview.length ? (
                        <div style={{ display: 'grid', gap: 10 }}>
                          {caseOverview.map((o) => {
                            const empty = !o.value;
                            return (
                              <div key={o.label} style={{ display: 'grid', gap: 3 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: empty ? 'var(--danger)' : 'var(--text-muted)' }}>{o.label}</span>
                                <span style={{ fontSize: 12.5, color: empty ? 'var(--danger)' : 'var(--text)', whiteSpace: 'pre-wrap', fontStyle: empty ? 'italic' : 'normal' }}>
                                  {empty ? '미작성' : o.value}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {storylineLoading ? '불러오는 중…' : '케이스 개요 정보를 불러오지 못했습니다.'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RIGHT — AI 스토리라인 */}
                  <div style={{ flex: '1.3 1 0', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>AI 스토리라인 (검토·수정 가능)</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {savedMsg ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>{savedMsg}</span> : null}
                        <button type="button" style={btnSecondary} onClick={() => void saveStoryline()} disabled={busy || parts.length === 0}>
                          {saving ? '저장 중…' : '스토리라인 저장'}
                        </button>
                        <button type="button" style={btnSecondary} onClick={() => void generateStoryline()} disabled={busy}>
                          {storylineLoading ? '생성 중…' : '다시 생성'}
                        </button>
                      </div>
                    </div>
                    {storylineLoading && parts.length === 0 ? (
                      <div style={{ padding: '40px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        AI가 스토리라인을 작성하는 중…
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: 12, maxHeight: '74vh', overflowY: 'auto', paddingRight: 4 }}>
                        {parts.map((p, idx) => (
                          <div key={p.key} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>
                              {idx + 1}. {p.title}
                            </div>
                            <div style={{ display: 'grid', gap: 10 }}>
                              <div style={{ display: 'grid', gap: 3 }}>
                                <span style={fieldLabel}>한 줄 요약</span>
                                <textarea value={p.summary} onChange={(e) => updatePart(idx, { summary: e.target.value })} rows={2} style={inputStyle} />
                              </div>
                              <div style={{ display: 'grid', gap: 3 }}>
                                <span style={fieldLabel}>언급할 팩트 (한 줄에 하나)</span>
                                <textarea
                                  value={p.facts.join('\n')}
                                  onChange={(e) => updatePart(idx, { facts: e.target.value.split('\n') })}
                                  rows={Math.max(2, p.facts.length)}
                                  style={inputStyle}
                                />
                              </div>
                              <div style={{ display: 'grid', gap: 3 }}>
                                <span style={fieldLabel}>강조할 내용 (한 줄에 하나)</span>
                                <textarea
                                  value={p.emphasis.join('\n')}
                                  onChange={(e) => updatePart(idx, { emphasis: e.target.value.split('\n') })}
                                  rows={Math.max(2, p.emphasis.length)}
                                  style={inputStyle}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button type="button" style={btnSecondary} onClick={closeModal} disabled={blogLoading}>
                    취소
                  </button>
                  <button type="button" style={btnPrimary} onClick={() => void generateBlog()} disabled={busy || parts.length === 0}>
                    {blogLoading ? '블로그 글 작성 중…' : '블로그 글 작성'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ padding: '24px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>블로그 글이 생성되었습니다</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
                  진료케이스 메뉴에서 작성된 글을 확인할 수 있습니다.
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                  <button type="button" style={btnSecondary} onClick={closeModal}>
                    닫기
                  </button>
                  <Link href="/admin/case-blog" style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                    진료케이스 보러가기
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
