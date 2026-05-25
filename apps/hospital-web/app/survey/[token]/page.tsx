'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { ddxGetPublic, ddxPostPublic } from '@/lib/ddx-api';

// ─── 타입 ────────────────────────────────────────────────
type Question = {
  id: string;
  order: number;
  text: string;
  type: string;
  options?: unknown;
};

type ServerAnswer = {
  questionInstanceId: string;
  answerText: string | null;
  answerJson: unknown;
};

type SurveySession = {
  id: string;
  patientName: string | null;
  guardianName: string | null;
  visitType: string | null;
  scheduledDate?: string | null;
  status: string;
  hospital?: { name?: string | null; logoUrl?: string | null; brandColor?: string | null } | null;
  questions: Question[];
  answers?: ServerAnswer[];
};

// ─── 헬퍼 ────────────────────────────────────────────────
function getChoices(q: Question): string[] {
  const opts = q.options;
  if (!opts) return [];
  if (Array.isArray(opts)) return opts as string[];
  const c = (opts as Record<string, unknown>).choices;
  if (Array.isArray(c)) return c as string[];
  return [];
}

function getScaleMeta(q: Question): { min: number; max: number; minLabel: string; maxLabel: string } | null {
  if (q.type !== 'scale') return null;
  const opts = q.options as Record<string, unknown> | null | undefined;
  if (!opts) return { min: 0, max: 10, minLabel: '', maxLabel: '' };
  return {
    min: typeof opts.min === 'number' ? opts.min : 0,
    max: typeof opts.max === 'number' ? opts.max : 10,
    minLabel: typeof opts.minLabel === 'string' ? opts.minLabel : '',
    maxLabel: typeof opts.maxLabel === 'string' ? opts.maxLabel : '',
  };
}

const OTHER_RE = /기타|직접\s*입력/;
function isOtherChoice(opt: string): boolean { return OTHER_RE.test(opt); }

function formatScheduledDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

// ─── 라이트 고정 팔레트 (초진 접수증과 동일 톤) ─────────────
const C = {
  bg: '#ffffff',
  subtle: '#f7f7f8',
  border: '#e8e8eb',
  borderStrong: '#d8d9dd',
  text: '#18181b',
  textSec: '#71717a',
  muted: '#a1a1aa',
  ink: '#18181b',
  danger: '#dc2626',
};

type Accent = { base: string; on: string; tint: string };
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#18181b' : '#ffffff';
}
function buildAccent(hex: string | null | undefined): Accent {
  const base = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : C.ink;
  return { base, on: readableOn(base), tint: base + '1a' };
}

type Step = 'loading' | 'error' | 'already' | 'intro' | 'survey' | 'submitting' | 'done';

export default function PublicSurveyPage() {
  const params = useParams();
  const token = typeof params.token === 'string' ? params.token : Array.isArray(params.token) ? params.token[0] : '';

  const [step, setStep] = useState<Step>('loading');
  const [session, setSession] = useState<SurveySession | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [currentQ, setCurrentQ] = useState(0);

  const ac = useMemo(() => buildAccent(session?.hospital?.brandColor), [session]);
  const hospitalName = session?.hospital?.name?.trim() || '';

  useEffect(() => {
    if (!token) { setStep('error'); setErrorMsg('유효하지 않은 링크입니다.'); return; }
    ddxGetPublic<{ success: boolean; session?: SurveySession; error?: string }>(`/api/survey?token=${encodeURIComponent(token)}`)
      .then((data) => {
        if (!data.success || !data.session) {
          setStep('error');
          setErrorMsg(data.error === 'not_found' ? '문진을 찾을 수 없습니다. 링크를 다시 확인해 주세요.' : '문진을 불러오지 못했습니다.');
          return;
        }
        setSession(data.session);
        const prefill: Record<string, string | string[]> = {};
        const qById = new Map(data.session.questions.map((q) => [q.id, q]));
        for (const a of data.session.answers ?? []) {
          if (!qById.has(a.questionInstanceId)) continue;
          if (Array.isArray(a.answerJson)) prefill[a.questionInstanceId] = a.answerJson as string[];
          else if (a.answerText != null) prefill[a.questionInstanceId] = a.answerText;
        }
        setAnswers(prefill);
        if (data.session.status === 'completed') setStep('already');
        else setStep('intro');
      })
      .catch(() => { setStep('error'); setErrorMsg('문진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
  }, [token]);

  const questions = session?.questions ?? [];
  const totalQ = questions.length;
  const question = questions[currentQ] ?? null;
  const currentAnswer = question ? (answers[question.id] ?? '') : '';

  const needsOtherText = useMemo(() => {
    if (!question) return false;
    if (question.type === 'single_choice') return typeof currentAnswer === 'string' && isOtherChoice(currentAnswer);
    if (question.type === 'multi_choice') return Array.isArray(currentAnswer) && currentAnswer.some(isOtherChoice);
    return false;
  }, [question, currentAnswer]);

  const canGoNext = (() => {
    if (!question) return false;
    const a = answers[question.id];
    if (a == null) return false;
    if (Array.isArray(a)) {
      if (a.length === 0) return false;
      if (needsOtherText && !(otherText[question.id]?.trim())) return false;
      return true;
    }
    if (typeof a === 'string') {
      if (!a.trim()) return false;
      if (needsOtherText && !(otherText[question.id]?.trim())) return false;
      return true;
    }
    return false;
  })();

  const setAns = (qid: string, value: string | string[]) => setAnswers((p) => ({ ...p, [qid]: value }));
  const toggleMulti = (qid: string, option: string) => {
    setAnswers((p) => {
      const cur = Array.isArray(p[qid]) ? (p[qid] as string[]) : [];
      const has = cur.includes(option);
      return { ...p, [qid]: has ? cur.filter((v) => v !== option) : [...cur, option] };
    });
  };

  const handleNext = () => {
    if (!canGoNext) return;
    if (currentQ < totalQ - 1) setCurrentQ((i) => i + 1);
    else handleSubmit();
  };
  const handlePrev = () => { if (currentQ > 0) setCurrentQ((i) => i - 1); };

  const buildPayload = () => {
    const applyOther = (qid: string, opt: string) => (isOtherChoice(opt) && otherText[qid]?.trim() ? otherText[qid].trim() : opt);
    return questions
      .map((q) => {
        const a = answers[q.id];
        if (a == null) return null;
        if (Array.isArray(a)) {
          if (a.length === 0) return null;
          const mapped = a.map((opt) => applyOther(q.id, opt));
          return { questionInstanceId: q.id, answerJson: mapped, answerText: mapped.join(', ') };
        }
        const s = String(a).trim();
        if (!s) return null;
        const finalText = q.type === 'single_choice' ? applyOther(q.id, s) : s;
        return { questionInstanceId: q.id, answerText: finalText };
      })
      .filter((x): x is { questionInstanceId: string; answerText: string; answerJson?: string[] } => x !== null);
  };

  const handleSubmit = async () => {
    if (!token) return;
    setStep('submitting');
    try {
      const res = await ddxPostPublic<{ success: boolean; error?: string }>('/api/survey', {
        token,
        answers: buildPayload(),
        complete: true,
      });
      if (res.success) setStep('done');
      else if (res.error === 'already_completed') setStep('already');
      else { setStep('error'); setErrorMsg(res.error || '제출에 실패했습니다.'); }
    } catch {
      setStep('error');
      setErrorMsg('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  // ─── 렌더 ──────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 28, height: 28, border: `2.5px solid ${C.border}`, borderTopColor: ac.base, borderRadius: '50%', display: 'inline-block', animation: 'sv-spin 0.7s linear infinite' }} />
        </div>
      </Screen>
    );
  }

  if (step === 'error') {
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
          <p style={{ fontSize: 16, color: C.textSec, lineHeight: 1.7, margin: 0 }}>{errorMsg || '문제가 발생했습니다.'}</p>
        </div>
      </Screen>
    );
  }

  if (step === 'already' || step === 'done') {
    const isDone = step === 'done';
    return (
      <Screen accent={ac}>
        <div style={{ textAlign: 'center', margin: 'auto', maxWidth: 420 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: ac.base, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: ac.on }}><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 10px', color: C.text }}>
            {isDone ? '제출이 완료되었어요' : '이미 제출된 문진이에요'}
          </h1>
          <p style={{ fontSize: 16, color: C.textSec, lineHeight: 1.7, margin: 0 }}>
            {isDone
              ? '소중한 답변 감사합니다.\n진료 시 참고하겠습니다.'
              : '이 문진은 이미 작성이 완료되었습니다.\n이 창은 닫으셔도 됩니다.'}
          </p>
        </div>
      </Screen>
    );
  }

  if (step === 'submitting') {
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <span style={{ width: 28, height: 28, border: `2.5px solid ${C.border}`, borderTopColor: ac.base, borderRadius: '50%', display: 'inline-block', animation: 'sv-spin 0.7s linear infinite' }} />
          <p style={{ fontSize: 16, color: C.textSec, margin: 0 }}>제출하는 중…</p>
        </div>
      </Screen>
    );
  }

  // 인트로(웰컴)
  if (step === 'intro') {
    const patient = session?.patientName?.trim() || '';
    const scheduledText = formatScheduledDate(session?.scheduledDate);
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ac)', marginBottom: 14, letterSpacing: '-0.01em' }}>
            {hospitalName ? `${hospitalName} 사전문진` : '사전문진'}
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.32, color: C.text, margin: 0 }}>
            사전문진을 작성해주세요
          </h1>
          <p style={{ fontSize: 16, fontWeight: 500, color: C.textSec, letterSpacing: '-0.01em', lineHeight: 1.7, margin: '18px 0 0' }}>
            보다 정확한 환자 상태 파악과 진료를 위해 내원 전 사전문진을 진행하고 있습니다.
          </p>
          <div style={{ marginTop: 22, background: C.subtle, borderRadius: 12, padding: '16px 18px', display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, fontSize: 16 }}>
              <span style={{ color: C.muted, minWidth: 82, flexShrink: 0 }}>환자명</span>
              <span style={{ color: C.text, fontWeight: 600 }}>{patient || '—'}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: 16 }}>
              <span style={{ color: C.muted, minWidth: 82, flexShrink: 0 }}>내원 예정일</span>
              <span style={{ color: C.text, fontWeight: 600 }}>{scheduledText || '—'}</span>
            </div>
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <button type="button" className="sv-press" onClick={() => setStep('survey')} style={{ ...btnPrimary(false), width: '100%', padding: '17px', fontSize: 17 }}>
            시작하기
          </button>
        </div>
      </Screen>
    );
  }

  // 설문
  if (!question) return <Screen accent={ac}><div /></Screen>;
  const progress = totalQ > 1 ? currentQ / (totalQ - 1) : 0;
  const choices = getChoices(question);
  const scaleMeta = getScaleMeta(question);
  const isLast = currentQ === totalQ - 1;

  return (
    <Screen accent={ac}>
      <div style={{ height: 3, background: C.border, borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--ac)', transition: 'width .25s' }} />
      </div>
      {hospitalName && (
        <div style={{ fontSize: 13, color: C.muted, marginTop: 10, flexShrink: 0, letterSpacing: '0.01em' }}>
          {hospitalName}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 2px 12vh' }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: C.text, margin: '0 0 20px', lineHeight: 1.45 }}>
            {question.text}
          </h2>

          {question.type === 'short_text' && (
            <input autoFocus value={typeof currentAnswer === 'string' ? currentAnswer : ''}
              onChange={(e) => setAns(question.id, e.target.value)} placeholder="답변을 입력해 주세요" style={inputStyle} />
          )}

          {question.type === 'long_text' && (
            <textarea autoFocus value={typeof currentAnswer === 'string' ? currentAnswer : ''}
              onChange={(e) => setAns(question.id, e.target.value)} placeholder="자유롭게 적어 주세요" rows={4} style={textareaStyle} />
          )}

          {question.type === 'single_choice' && (
            <div style={{ display: 'grid', gap: 7 }}>
              {choices.map((opt) => {
                const active = currentAnswer === opt;
                return (
                  <div key={opt}>
                    <button type="button" className="sv-press" onClick={() => setAns(question.id, opt)} style={cardStyle(active)}>{opt}</button>
                    {active && isOtherChoice(opt) && (
                      <input autoFocus value={otherText[question.id] ?? ''} onChange={(e) => setOtherText((p) => ({ ...p, [question.id]: e.target.value }))}
                        placeholder="직접 입력해 주세요" style={{ ...inputStyle, marginTop: 10 }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {question.type === 'multi_choice' && (
            <div style={{ display: 'grid', gap: 6 }}>
              <p style={{ margin: '0 0 4px', fontSize: 14, color: C.muted }}>여러 개 선택 가능</p>
              {choices.map((opt) => {
                const arr = Array.isArray(currentAnswer) ? currentAnswer : [];
                const active = arr.includes(opt);
                return (
                  <div key={opt}>
                    <button type="button" className="sv-press" onClick={() => toggleMulti(question.id, opt)}
                      style={{ ...cardStyle(active), textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? 'var(--ac)' : '#e4e4e7', color: 'var(--ac-on)', fontSize: 12 }}>
                        {active ? '✓' : ''}
                      </span>
                      <span>{opt}</span>
                    </button>
                    {active && isOtherChoice(opt) && (
                      <input autoFocus value={otherText[question.id] ?? ''} onChange={(e) => setOtherText((p) => ({ ...p, [question.id]: e.target.value }))}
                        placeholder="직접 입력해 주세요" style={{ ...inputStyle, marginTop: 10 }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {question.type === 'scale' && scaleMeta && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: C.textSec, marginBottom: 14 }}>
                <span>{scaleMeta.minLabel || scaleMeta.min}</span>
                <span>{scaleMeta.maxLabel || scaleMeta.max}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {Array.from({ length: scaleMeta.max - scaleMeta.min + 1 }, (_, i) => scaleMeta.min + i).map((n) => {
                  const active = currentAnswer === String(n);
                  return (
                    <button key={n} type="button" className="sv-press" onClick={() => setAns(question.id, String(n))}
                      style={{ ...cardStyle(active), flex: '1 1 44px', minWidth: 44, padding: '14px 0' }}>
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexShrink: 0, paddingTop: 8 }}>
        {currentQ > 0 && <button type="button" className="sv-press" onClick={handlePrev} style={btnSecondary}>이전</button>}
        <button type="button" className="sv-press" onClick={handleNext} disabled={!canGoNext} style={btnPrimary(!canGoNext)}>
          {isLast ? '제출하기' : '다음'}
        </button>
      </div>
    </Screen>
  );
}

// ─── 공통 UI ─────────────────────────────────────────────
function Screen({ children, accent }: { children: React.ReactNode; accent: Accent }) {
  return (
    <div
      style={{
        minHeight: '100dvh', background: C.bg, color: C.text, display: 'flex', justifyContent: 'center',
        fontFamily: '"Pretendard", "Pretendard Variable", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        ['--ac' as string]: accent.base, ['--ac-on' as string]: accent.on, ['--ac-tint' as string]: accent.tint,
      } as CSSProperties}
    >
      <style>{`.sv-press{transition:transform .12s ease,opacity .12s ease}.sv-press:not(:disabled):active{transform:scale(.975)}@keyframes sv-spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', padding: '22px 20px 24px' }}>
        {children}
      </div>
    </div>
  );
}

// ─── 스타일 ──────────────────────────────────────────────
const inputStyle: CSSProperties = {
  width: '100%', padding: '12px 2px', fontSize: 17, color: C.text, background: 'transparent',
  border: 'none', borderBottom: `1.5px solid ${C.border}`, borderRadius: 0, outline: 'none', fontFamily: 'inherit',
};
const textareaStyle: CSSProperties = {
  width: '100%', padding: '14px', fontSize: 16.5, color: C.text, background: C.subtle,
  border: 'none', borderRadius: 12, outline: 'none', resize: 'vertical', minHeight: 120, lineHeight: 1.6,
  fontFamily: 'inherit', boxSizing: 'border-box',
};
function cardStyle(active: boolean): CSSProperties {
  return {
    padding: '15px 16px', fontSize: 16.5, fontWeight: active ? 600 : 500,
    color: C.text, textAlign: 'center', background: active ? 'var(--ac-tint)' : C.subtle,
    border: `1.5px solid ${active ? 'var(--ac)' : 'transparent'}`, borderRadius: 12, cursor: 'pointer', transition: 'all .12s',
  };
}
function btnPrimary(disabled: boolean): CSSProperties {
  return {
    flex: 1, padding: '16px', fontSize: 16.5, fontWeight: 700, letterSpacing: '-0.01em',
    color: disabled ? '#fff' : 'var(--ac-on)',
    background: disabled ? C.borderStrong : 'var(--ac)', border: 'none', borderRadius: 14, cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
const btnSecondary: CSSProperties = {
  flexShrink: 0, minWidth: 96, padding: '16px 20px', fontSize: 16, fontWeight: 600,
  color: C.textSec, background: C.subtle, border: 'none', borderRadius: 14, cursor: 'pointer', whiteSpace: 'nowrap',
};
