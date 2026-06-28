'use client';

// 사전문진 메뉴(page.tsx) 의 상세 view 와 초진 접수 reception 모달 양쪽에서 재사용한다.
// page.tsx 와 reception 의 코드 중복을 막으려 타입/헬퍼/공용 컴포넌트/Modal 까지 한 파일에 모음.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Copy, Check, ClipboardList, FileText, Stethoscope, HelpCircle, Sparkles } from 'lucide-react';
import { CenteredSpinner } from '@/components/ui/loading-spinner';
import { Modal } from '@/components/ui/modal';
import { ddxGet } from '@/lib/ddx-api';
import { kakaoPillStyle } from '@/lib/form-styles';

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
  scheduledDate?: string | null;
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

/** 실제로 노출·응답된 질문만(답변 있는 것). 질문 뱅크의 미노출/미응답 항목 제외. */
export function answeredQuestionsFromDetail(detail: SessionDetail): { q: Question; disp: string }[] {
  return [...detail.questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => ({ q, disp: answerDisplay(detail.answers?.find((a) => a.questionInstanceId === q.id)) }))
    .filter((x) => x.disp.trim().length > 0);
}

/** 문진 답변 모달 — 사전문진 목록·상세 어디서든 재사용. */
export function AnswersModal({ detail, onClose }: { detail: SessionDetail; onClose: () => void }) {
  const answered = answeredQuestionsFromDetail(detail);
  return (
    <Modal title={`문진 답변${detail.patientName ? ` — ${detail.patientName}` : ''}`} onClose={onClose} maxWidth={560}>
      {answered.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>응답한 문진이 없습니다.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {answered.map(({ q, disp }) => (
            <div key={q.id} style={{ padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <p style={{ margin: '0 0 3px', fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)' }}>Q{q.order}. {q.text}</p>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{disp}</p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
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

// 박스별 복사용 평문 — 예상 감별진단(DDx)만.
function ddxCopyText(detail: SessionDetail): string {
  const ddxParsed = parseDdxJson(detail.draftDdx);
  if (ddxParsed && ddxParsed.length > 0) {
    const out: string[] = [];
    ddxParsed.forEach((d, i) => {
      out.push(`${i + 1}. ${d.name}${d.likelihood ? ` (가능도 ${d.likelihood})` : ''}`);
      if (Array.isArray(d.reasons)) d.reasons.forEach((r) => out.push(`  - 근거: ${r}`));
      if (Array.isArray(d.tests)) d.tests.forEach((t) => out.push(`  - 추천 검사: ${t}`));
    });
    return out.join('\n');
  }
  return detail.draftDdx?.trim() ?? '';
}

// 박스별 복사용 평문 — 추천 추가 질문만.
function followUpsCopyText(detail: SessionDetail): string {
  return followUpList(detail.followUpQuestions).map((q, i) => `${i + 1}. ${q}`).join('\n');
}

// 가능도(높음/중간/낮음 등)를 점+색 글씨로. 한국어·영어 표기 모두 대응, 못 알아보면 회색.
// (반투명 파스텔 배경은 쓰지 않음 — 색 점과 글씨로만 절제해서 표현)
function likelihoodChip(raw?: string) {
  const v = (raw ?? '').trim();
  if (!v) return null;
  let color = 'var(--text-muted)';
  if (/높|high|상/i.test(v)) color = '#e5484d';
  else if (/중|mid|medium/i.test(v)) color = '#bf6a00';
  else if (/낮|low|하/i.test(v)) color = 'var(--text-muted)';
  return (
    <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {v}
    </span>
  );
}

// ─── 상세 view (사전문진 메뉴 우측 / 모달 안에서 모두 사용) ──
export function SessionDetailView({ detail, origin, hideShareLink = false, hideAnswersButton = false }: {
  detail: SessionDetail;
  origin: string;
  /** 모달처럼 보호자에게 다시 발송할 필요가 없는 컨텍스트에서는 상단 작성 링크 블록을 숨긴다. */
  hideShareLink?: boolean;
  /** 목록에서 '문진 답변' 버튼을 따로 제공하는 경우(사전문진 메뉴) 상세 헤더의 버튼을 숨긴다. */
  hideAnswersButton?: boolean;
}) {
  const shareUrl = origin && detail.token ? `${origin}/survey/${detail.token}` : '';
  const ddxParsed = parseDdxJson(detail.draftDdx);
  const followUps = followUpList(detail.followUpQuestions);
  const completed = detail.status === 'completed';

  const [qListOpen, setQListOpen] = useState(false);
  const answeredQuestions = answeredQuestionsFromDetail(detail);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Section
        title="문진 정보"
        icon={<ClipboardList size={15} />}
        right={
          !hideAnswersButton && completed && answeredQuestions.length > 0 ? (
            <button
              type="button"
              onClick={() => setQListOpen(true)}
              style={{
                padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text)',
                background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              문진 답변 {answeredQuestions.length}개 ›
            </button>
          ) : null
        }
      >
        <Row k="환자 이름" v={detail.patientName || '—'} />
        <Row k="보호자 성명" v={detail.guardianName || '—'} />
        <Row k="연락처" v={detail.contact || '—'} />
        <Row k="방문 유형" v={detail.visitType || '—'} />
        <Row k="발송일시" v={fmtDateTime(detail.createdAt)} copyable={false} />
        <Row k="제출일시" v={detail.completedAt ? fmtDateTime(detail.completedAt) : '미제출'} copyable={false} />
      </Section>

      {completed && (
        detail.analysisStatus === 'pending' || detail.analysisStatus === 'processing' ? (
          <Section
            icon={<Sparkles size={15} />}
            title="AI 사전 분석"
            right={<StatusBadge status={detail.analysisStatus} label={ANALYSIS_LABEL[detail.analysisStatus] ?? detail.analysisStatus} variant="analysis" />}
          >
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>AI가 사전문진을 분석하고 있습니다…</p>
          </Section>
        ) : detail.analysisStatus === 'error' ? (
          <Section
            icon={<Sparkles size={15} />}
            title="AI 사전 분석"
            right={<StatusBadge status="error" label={ANALYSIS_LABEL.error ?? '오류'} variant="analysis" />}
          >
            <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>분석 중 오류가 발생했습니다. 재분석을 시도해 주세요.</p>
          </Section>
        ) : (
          <>
            <Section
              icon={<FileText size={15} />}
              title="요약"
              right={<CopyIconBtn text={detail.draftSummary ?? ''} title="요약 복사" />}
            >
              {detail.draftSummary
                ? <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text)', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{detail.draftSummary}</p>
                : <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>요약이 없습니다.</p>}
            </Section>

            <Section icon={<Stethoscope size={15} />} title="예상 감별진단 (DDx)" right={<CopyIconBtn text={ddxCopyText(detail)} title="감별진단 복사" />}>
              {ddxParsed ? (
                <div>
                  {ddxParsed.map((d, i) => (
                    <div key={i} style={{ padding: i === 0 ? '0 0 11px' : '11px 0', borderTop: i === 0 ? undefined : '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text)', wordBreak: 'break-word' }}>{d.name}</span>
                        {likelihoodChip(d.likelihood)}
                      </div>
                      {Array.isArray(d.reasons) && d.reasons.length > 0 && (
                        <ul style={{ margin: '5px 0 0', paddingLeft: 27, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                          {d.reasons.map((r, ri) => <li key={ri}>{r}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              ) : detail.draftDdx ? (
                <pre style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', lineHeight: 1.6 }}>{detail.draftDdx}</pre>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>예상 감별진단이 없습니다.</p>
              )}
            </Section>

            <Section icon={<HelpCircle size={15} />} title="추천 추가 질문" right={<CopyIconBtn text={followUpsCopyText(detail)} title="추천 질문 복사" />}>
              {followUps.length > 0 ? (
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--text)', lineHeight: 1.55, listStyleType: 'decimal' }}>
                  {followUps.map((q, i) => <li key={i} style={{ marginTop: i === 0 ? 0 : 6 }}>{q}</li>)}
                </ol>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>추천 추가 질문이 없습니다.</p>
              )}
            </Section>
          </>
        )
      )}

      {qListOpen && <AnswersModal detail={detail} onClose={() => setQListOpen(false)} />}
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
export function Section({ title, right, children, tone = 'default', icon, accentBar = false }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; tone?: 'default' | 'accent'; icon?: React.ReactNode; accentBar?: boolean }) {
  const isAccent = tone === 'accent';
  const hasIcon = !!icon;
  return (
    <div style={{ position: 'relative', overflow: 'hidden', border: `1px solid ${isAccent ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: accentBar ? '15px 17px 15px 20px' : '15px 17px', background: isAccent ? 'var(--accent-subtle)' : 'var(--bg)', boxShadow: hasIcon && !isAccent ? '0 1px 3px rgba(0, 0, 0, 0.045)' : undefined }}>
      {accentBar && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--accent)' }} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: hasIcon ? 10 : 8 }}>
        {hasIcon ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            <span style={{ display: 'inline-flex', color: 'var(--text-muted)' }}>{icon}</span>
            {title}
          </div>
        ) : (
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
        )}
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

// 아이콘만 있는 복사 버튼 — 박스 헤더 우측에서 그 박스 내용만 복사할 때 사용. 내용이 비면 렌더 안 함.
export function CopyIconBtn({ text, title = '복사' }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  if (!text?.trim()) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* 무시 */ }
  }
  return (
    <button type="button" onClick={copy} title={title}
      style={{ flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: '2px 3px', display: 'inline-flex', alignItems: 'center', color: copied ? 'var(--success)' : 'var(--text-muted)' }}>
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

export function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* 무시 */ } }}
      style={{ flexShrink: 0, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', borderRadius: 'var(--radius)', border: `1px solid ${copied ? 'var(--success)' : 'var(--border-strong)'}`, background: 'var(--bg)', color: copied ? 'var(--success)' : 'var(--text)' }}>
      {copied ? '복사 완료' : label}
    </button>
  );
}

// 사전문진 작성 링크를 보호자에게 카카오 알림톡으로 발송. 작성 링크(/survey/[token])는 매번 바뀌지만
// 템플릿 WL 버튼은 도메인만 고정 등록 → 발송 시 전체 URL 을 linkMo 로 넣어도 통과한다.
export function SurveyKakaoSend({ token, defaultPhone, patientName, guardianName, scheduledDate }: {
  token: string; defaultPhone: string; patientName: string; guardianName: string; scheduledDate?: string;
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
        body: JSON.stringify({ token, phone, patientName, guardianName, scheduledDate: scheduledDate ?? '' }),
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
          style={{ flex: 1, minWidth: 0, padding: '7px 2px', fontSize: 12.5, color: 'var(--text)', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-strong)', borderRadius: 0, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
        <button type="button" onClick={send} disabled={sending} style={{ ...kakaoPillStyle(sending), flexShrink: 0, padding: '7px 14px', fontSize: 12.5 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
            <path fill={sending ? 'var(--text-muted)' : '#3c1e1e'} d="M12 3C6.477 3 2 6.486 2 10.79c0 2.79 1.86 5.236 4.65 6.61-.205.73-.74 2.64-.847 3.05-.133.51.187.503.394.366.163-.108 2.6-1.766 3.65-2.48.51.075 1.034.114 1.553.114 5.523 0 10-3.486 10-7.79C22 6.486 17.523 3 12 3z" />
          </svg>
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
