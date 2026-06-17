'use client';

// 사전문진 메뉴(page.tsx) 의 상세 view 와 초진 접수 reception 모달 양쪽에서 재사용한다.
// page.tsx 와 reception 의 코드 중복을 막으려 타입/헬퍼/공용 컴포넌트/Modal 까지 한 파일에 모음.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Copy, Check } from 'lucide-react';
import { CenteredSpinner } from '@/components/ui/loading-spinner';
import { ddxGet } from '@/lib/ddx-api';

// ─── 타입 ────────────────────────────────────────────────
export type Question = {
  id: string;
  order: number;
  text: string;
  type: string;
};

export type Answer = {
  id: string;
  questionInstanceId: string;
  answerText: string | null;
  answerJson: unknown;
};

export type SessionDetail = {
  id: string;
  patientName: string | null;
  guardianName: string | null;
  contact: string | null;
  visitType: string | null;
  previousChartText?: string | null;
  status: string;
  token: string;
  createdAt: string;
  completedAt: string | null;
  analysisStatus?: string;
  draftSummary?: string | null;
  draftDdx?: string | null;
  followUpQuestions?: unknown;
  questions: Question[];
  answers: Answer[];
};

// ─── 상수 ────────────────────────────────────────────────
export const STATUS_LABEL: Record<string, string> = {
  pending: '대기 중',
  completed: '제출 완료',
  expired: '만료',
};

export const ANALYSIS_LABEL: Record<string, string> = {
  pending: '분석 대기',
  processing: '분석 중',
  done: '분석 완료',
  error: '분석 오류',
};

// ─── 헬퍼 ────────────────────────────────────────────────
export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return iso; }
}

export function answerDisplay(a: Answer | undefined): string {
  if (!a) return '';
  if (Array.isArray(a.answerJson)) return (a.answerJson as string[]).join(', ');
  if (typeof a.answerJson === 'string' && a.answerJson.trim()) return a.answerJson;
  return a.answerText ?? '';
}

export function parseDdxJson(raw: string | null | undefined): Array<{ name: string; likelihood?: string; reasons?: string[]; tests?: string[] }> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  return null;
}

export function followUpList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p.filter((q): q is string => typeof q === 'string');
    } catch { /* plain text */ }
  }
  return [];
}

// AI 사전 분석을 차트 프로그램에 바로 붙여넣을 수 있는 평문 텍스트로 합성.
function buildAnalysisCopyText(detail: SessionDetail): string {
  const out: string[] = [];
  if (detail.draftSummary?.trim()) {
    out.push('[차트 요약]');
    out.push(detail.draftSummary.trim());
  }
  const ddxParsed = parseDdxJson(detail.draftDdx);
  if (ddxParsed && ddxParsed.length > 0) {
    if (out.length) out.push('');
    out.push('[감별진단 (DDx)]');
    ddxParsed.forEach((d, i) => {
      out.push(`${i + 1}. ${d.name}${d.likelihood ? ` (가능도 ${d.likelihood})` : ''}`);
      if (Array.isArray(d.reasons)) d.reasons.forEach((r) => out.push(`  - 근거: ${r}`));
      if (Array.isArray(d.tests)) d.tests.forEach((t) => out.push(`  - 추천 검사: ${t}`));
    });
  } else if (detail.draftDdx?.trim()) {
    if (out.length) out.push('');
    out.push('[감별진단 (DDx)]');
    out.push(detail.draftDdx.trim());
  }
  const followUps = followUpList(detail.followUpQuestions);
  if (followUps.length > 0) {
    if (out.length) out.push('');
    out.push('[추천 추가 질문]');
    followUps.forEach((q, i) => out.push(`${i + 1}. ${q}`));
  }
  return out.join('\n');
}

// ─── 상세 view (사전문진 메뉴 우측 / 모달 안에서 모두 사용) ──
export function SessionDetailView({ detail, origin, hideShareLink = false }: {
  detail: SessionDetail;
  origin: string;
  /** 모달처럼 보호자에게 다시 발송할 필요가 없는 컨텍스트에서는 상단 작성 링크 블록을 숨긴다. */
  hideShareLink?: boolean;
}) {
  const shareUrl = origin && detail.token ? `${origin}/survey/${detail.token}` : '';
  const ddxParsed = parseDdxJson(detail.draftDdx);
  const followUps = followUpList(detail.followUpQuestions);
  const completed = detail.status === 'completed';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {!hideShareLink && shareUrl && (
        <div style={{ display: 'grid', gap: 10, padding: '12px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>작성 링크</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shareUrl}</span>
            <CopyBtn text={shareUrl} label="링크 복사" />
          </div>
          <SurveyKakaoSend
            token={detail.token}
            defaultPhone={detail.contact ?? ''}
            patientName={detail.patientName ?? ''}
            guardianName={detail.guardianName ?? ''}
          />
        </div>
      )}

      <Section title="문진 정보">
        <Row k="환자 이름" v={detail.patientName || '—'} />
        <Row k="보호자 성명" v={detail.guardianName || '—'} />
        <Row k="연락처" v={detail.contact || '—'} />
        <Row k="방문 유형" v={detail.visitType || '—'} />
        <Row k="발송일시" v={fmtDateTime(detail.createdAt)} copyable={false} />
        <Row k="제출일시" v={detail.completedAt ? fmtDateTime(detail.completedAt) : '미제출'} copyable={false} />
      </Section>

      {completed && (
        <Section
          tone="accent"
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>AI 사전 분석</span>
              {detail.analysisStatus && (
                <StatusBadge status={detail.analysisStatus} label={ANALYSIS_LABEL[detail.analysisStatus] ?? detail.analysisStatus} variant="analysis" />
              )}
            </span>
          }
          right={
            detail.analysisStatus === 'done'
              ? <CopyBtn text={buildAnalysisCopyText(detail)} label="전체 복사" />
              : null
          }
        >
          {detail.analysisStatus === 'pending' || detail.analysisStatus === 'processing' ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>AI가 사전문진을 분석하고 있습니다…</p>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {detail.draftSummary && (
                <div>
                  <p style={subHeadStyle}>요약</p>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{detail.draftSummary}</p>
                </div>
              )}
              {ddxParsed ? (
                <div>
                  <p style={subHeadStyle}>예상 감별진단 (DDx)</p>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {ddxParsed.map((d, i) => (
                      <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px', background: 'var(--bg-subtle)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                          {d.name}{d.likelihood ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>가능도 {d.likelihood}</span> : null}
                        </div>
                        {Array.isArray(d.reasons) && d.reasons.length > 0 && (
                          <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            {d.reasons.map((r, ri) => <li key={ri}>{r}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : detail.draftDdx ? (
                <div>
                  <p style={subHeadStyle}>예상 감별진단 (DDx)</p>
                  <pre style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', lineHeight: 1.6 }}>{detail.draftDdx}</pre>
                </div>
              ) : null}
              {followUps.length > 0 && (
                <div>
                  <p style={subHeadStyle}>추천 추가 질문</p>
                  <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
                    {followUps.map((q, i) => <li key={i}>{q}</li>)}
                  </ol>
                </div>
              )}
              {!detail.draftSummary && !detail.draftDdx && followUps.length === 0 && detail.analysisStatus === 'done' && (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>분석 결과가 없습니다.</p>
              )}
              {detail.analysisStatus === 'error' && (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>분석 중 오류가 발생했습니다. 재분석을 시도해 주세요.</p>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title={completed ? '문진 답변' : '문진 질문'}>
        {detail.questions.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>질문이 없습니다.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {[...detail.questions].sort((a, b) => a.order - b.order).map((q) => {
              const ans = detail.answers?.find((a) => a.questionInstanceId === q.id);
              const disp = answerDisplay(ans);
              return (
                <div key={q.id} style={{ padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 3px', fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)' }}>Q{q.order}. {q.text}</p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: disp ? 'var(--text)' : 'var(--text-muted)' }}>{disp || '미응답'}</p>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── 모달: reception 등 다른 화면에서 사전문진 상세를 띄울 때 사용 ──
export function SessionDetailModal({ open, sessionIds, userId, onClose }: {
  open: boolean;
  sessionIds: string[];
  userId: string;
  onClose: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  // 모달이 닫혔다 다시 열리면 첫 탭부터.
  useEffect(() => {
    if (open) setActiveIdx(0);
  }, [open]);

  const activeId = sessionIds[activeIdx];

  useEffect(() => {
    if (!open || !activeId || !userId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setDetail(null);
    ddxGet<{ success: boolean; session?: SessionDetail; error?: string }>(
      `/api/surveys/sessions/${encodeURIComponent(activeId)}`,
      userId,
    )
      .then((data) => {
        if (cancelled) return;
        if (data.success && data.session) setDetail(data.session);
        else setLoadError(data.error || '사전문진을 불러오지 못했습니다.');
      })
      .catch(() => { if (!cancelled) setLoadError('사전문진을 불러오지 못했습니다.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, activeId, userId]);

  if (!open) return null;

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={panelStyle}>
        <header style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>사전문진 상세</h2>
          <button type="button" onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </header>

        {sessionIds.length > 1 && (
          <div style={{ display: 'flex', gap: 6, padding: '8px 20px 0', flexWrap: 'wrap' }}>
            {sessionIds.map((sid, i) => (
              <button key={sid} type="button" onClick={() => setActiveIdx(i)}
                style={{
                  padding: '6px 12px', borderRadius: 'var(--radius)',
                  border: `1px solid ${i === activeIdx ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: i === activeIdx ? 'var(--accent-subtle)' : 'var(--bg)',
                  color: i === activeIdx ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: 12.5, fontWeight: i === activeIdx ? 600 : 500, cursor: 'pointer',
                }}>
                환자 {i + 1}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading ? (
            <CenteredSpinner minHeight={200} />
          ) : loadError ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{loadError}</p>
          ) : detail ? (
            <SessionDetailView detail={detail} origin={origin} hideShareLink />
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>표시할 사전문진이 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 공용 작은 컴포넌트(상세 view 안에서 사용) ─────────────
export function Section({ title, right, children, tone = 'default' }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; tone?: 'default' | 'accent' }) {
  const isAccent = tone === 'accent';
  return (
    <div style={{ border: `1px solid ${isAccent ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 16px', background: isAccent ? 'var(--accent-subtle)' : 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Row({ k, v, copyable = true }: { k: string; v: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const canCopy = copyable && !!v && v !== '—' && v !== '미제출' && v !== '미응답';
  async function copy() {
    try { await navigator.clipboard.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* 무시 */ }
  }
  return (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 13, alignItems: 'flex-start' }}>
      <span style={{ width: 84, flexShrink: 0, color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', wordBreak: 'break-word' }}>{v}</span>
      {canCopy && (
        <button type="button" onClick={copy} title="복사"
          style={{ flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: '1px 2px', display: 'flex', alignItems: 'center', color: copied ? 'var(--success)' : 'var(--text-muted)' }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  );
}

export function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* 무시 */ } }}
      style={{ flexShrink: 0, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', borderRadius: 'var(--radius)', border: `1px solid ${copied ? 'var(--success)' : 'var(--border-strong)'}`, background: 'var(--bg)', color: copied ? 'var(--success)' : 'var(--text)' }}>
      {copied ? '복사됨' : label}
    </button>
  );
}

// 사전문진 작성 링크를 보호자에게 카카오 알림톡으로 발송. 작성 링크(/survey/[token])는 매번 바뀌지만
// 템플릿 WL 버튼은 도메인만 고정 등록 → 발송 시 전체 URL 을 linkMo 로 넣어도 통과한다.
export function SurveyKakaoSend({ token, defaultPhone, patientName, guardianName }: {
  token: string; defaultPhone: string; patientName: string; guardianName: string;
}) {
  const [phone, setPhone] = useState(formatPhone(defaultPhone));
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const send = async () => {
    setErr(''); setMsg('');
    if (!phone.replace(/\D/g, '')) { setErr('연락처를 입력해 주세요.'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/surveys/send-kakao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, phone, patientName, guardianName }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; queued?: boolean; message?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '발송에 실패했습니다.');
      setMsg(data.queued ? (data.message ?? '발송이 요청되었습니다. 곧 전송됩니다.') : '전송되었습니다.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '발송에 실패했습니다.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>알림톡</span>
        <input
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          placeholder="010-0000-0000"
          type="tel"
          inputMode="numeric"
          style={{ flex: 1, minWidth: 0, padding: '7px 10px', fontSize: 12.5, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
        <button type="button" onClick={send} disabled={sending}
          style={{ flexShrink: 0, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: sending ? 'not-allowed' : 'pointer', borderRadius: 'var(--radius)', border: 'none', background: sending ? 'var(--bg-raised)' : '#fae100', color: sending ? 'var(--text-muted)' : '#3c1e1e' }}>
          {sending ? '발송 중…' : '카카오 발송'}
        </button>
      </div>
      {msg && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--success)' }}>{msg}</p>}
      {err && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--danger)' }}>{err}</p>}
    </div>
  );
}

// 숫자만 입력해도 휴대폰 번호 형식(010-1234-5678)으로 보이게 한다. 최대 11자리.
function formatPhone(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length < 11) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

export function StatusBadge({ status, label, variant = 'default' }: { status: string; label: string; variant?: 'default' | 'analysis' }) {
  const c = (() => {
    if (variant === 'analysis') {
      if (status === 'done') return { bg: 'var(--success-subtle)', color: 'var(--success)', border: 'var(--success)' };
      if (status === 'processing') return { bg: 'var(--accent-subtle)', color: 'var(--accent)', border: 'var(--accent)' };
      if (status === 'error') return { bg: 'var(--danger-subtle)', color: 'var(--danger)', border: 'var(--danger)' };
      return { bg: 'var(--bg-raised)', color: 'var(--text-muted)', border: 'var(--border)' };
    }
    if (status === 'completed') return { bg: 'var(--success-subtle)', color: 'var(--success)', border: 'var(--success)' };
    if (status === 'used') return { bg: 'var(--accent-subtle)', color: 'var(--accent)', border: 'var(--accent)' };
    if (status === 'expired') return { bg: 'var(--bg-raised)', color: 'var(--text-muted)', border: 'var(--border)' };
    return { bg: 'var(--bg-raised)', color: 'var(--text-secondary)', border: 'var(--border)' };
  })();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', background: c.bg, color: c.color, border: `1px solid ${c.border}`, borderRadius: 999, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

export const subHeadStyle: CSSProperties = { margin: '0 0 6px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' };

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
};
const panelStyle: CSSProperties = {
  width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
};
const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
};
