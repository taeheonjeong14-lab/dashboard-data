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

// 라이트(강제) 팔레트 — 보호자 휴대폰용
const C = {
  bg: '#FFFFFF',
  subtle: '#F2F4F6',
  border: '#E5E8EB',
  borderStrong: '#D1D6DB',
  text: '#191F28',
  sub: '#4E5968',
  muted: '#8B95A1',
};

type Step = 'loading' | 'error' | 'already' | 'intro' | 'survey' | 'submitting' | 'done';

export default function PublicSurveyPage() {
  const params = useParams();
  const token = typeof params.token === 'string' ? params.token : Array.isArray(params.token) ? params.token[0] : '';

  const [step, setStep] = useState<Step>('loading');
  const [session, setSession] = useState<SurveySession | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  // "기타(직접 입력)" 자유 텍스트 (questionId -> text)
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [currentQ, setCurrentQ] = useState(0);

  const accent = session?.hospital?.brandColor?.trim() || '#3182F6';
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
        // 기존 답변 프리필
        const prefill: Record<string, string | string[]> = {};
        const prefillOther: Record<string, string> = {};
        const qById = new Map(data.session.questions.map((q) => [q.id, q]));
        for (const a of data.session.answers ?? []) {
          const q = qById.get(a.questionInstanceId);
          if (!q) continue;
          if (Array.isArray(a.answerJson)) prefill[a.questionInstanceId] = a.answerJson as string[];
          else if (a.answerText != null) prefill[a.questionInstanceId] = a.answerText;
        }
        setAnswers(prefill);
        setOtherText(prefillOther);
        if (data.session.status === 'completed') setStep('already');
        else setStep('intro');
      })
      .catch(() => { setStep('error'); setErrorMsg('문진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
  }, [token]);

  const questions = session?.questions ?? [];
  const totalQ = questions.length;
  const question = questions[currentQ] ?? null;
  const progress = totalQ > 0 ? Math.round(((currentQ + 1) / totalQ) * 100) : 0;

  const currentAnswer = question ? (answers[question.id] ?? '') : '';

  // "기타" 선택 시 자유 텍스트 필요 여부
  const needsOtherText = useMemo(() => {
    if (!question) return false;
    if (question.type === 'single_choice') {
      return typeof currentAnswer === 'string' && isOtherChoice(currentAnswer);
    }
    if (question.type === 'multi_choice') {
      return Array.isArray(currentAnswer) && currentAnswer.some(isOtherChoice);
    }
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

  // 답변을 서버 형식으로 변환 ("기타"는 자유 텍스트로 치환)
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
      const payload = buildPayload();
      const res = await ddxPostPublic<{ success: boolean; error?: string }>('/api/survey', {
        token,
        answers: payload,
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
  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100dvh', background: C.subtle, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 16px', fontFamily: 'inherit', color: C.text }}>
      <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        {children}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (step === 'loading') {
    return shell(
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTopColor: accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>,
    );
  }

  if (step === 'error') {
    return shell(
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
        <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.7, margin: 0 }}>{errorMsg || '문제가 발생했습니다.'}</p>
      </div>,
    );
  }

  if (step === 'already' || step === 'done') {
    const isDone = step === 'done';
    return shell(
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: `${accent}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>
          {isDone ? '제출이 완료되었습니다' : '이미 제출된 문진입니다'}
        </h1>
        <p style={{ margin: 0, fontSize: 14.5, color: C.sub, lineHeight: 1.7 }}>
          {isDone
            ? '소중한 답변 감사합니다. 진료 시 참고하겠습니다.'
            : '이 문진은 이미 작성이 완료되었습니다.'}
          <br />이 창은 닫으셔도 됩니다.
        </p>
      </div>,
    );
  }

  if (step === 'intro') {
    return shell(
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 8px', gap: 14 }}>
        {hospitalName && (
          <div style={{ fontSize: 13, fontWeight: 700, color: accent, letterSpacing: '0.02em' }}>{hospitalName}</div>
        )}
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1.35 }}>
          진료 전 사전문진을<br />작성해 주세요
        </h1>
        <p style={{ margin: 0, fontSize: 15, color: C.sub, lineHeight: 1.7 }}>
          {session?.patientName ? <><b style={{ color: C.text }}>{session.patientName}</b> 보호자님, </> : null}
          정확한 진료를 위한 짧은 문진입니다.<br />약 2~3분이면 완료됩니다.
        </p>
        <div style={{ marginTop: 8, fontSize: 13, color: C.muted }}>총 {totalQ}개 질문</div>
        <button type="button" onClick={() => setStep('survey')}
          style={{ marginTop: 12, width: '100%', maxWidth: 320, padding: '15px', border: 'none', borderRadius: 14, background: accent, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
          작성 시작하기
        </button>
      </div>,
    );
  }

  if (step === 'submitting') {
    return shell(
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTopColor: accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ fontSize: 14.5, color: C.sub, margin: 0 }}>제출하는 중...</p>
      </div>,
    );
  }

  // step === 'survey'
  if (!question) return shell(<div />);
  const choices = getChoices(question);
  const scaleMeta = getScaleMeta(question);

  const optBtn = (selected: boolean): CSSProperties => ({
    width: '100%', padding: '15px 16px', textAlign: 'left',
    border: `1.5px solid ${selected ? accent : C.border}`,
    borderRadius: 14, background: selected ? `${accent}12` : C.bg,
    color: selected ? accent : C.text, fontSize: 15.5, fontWeight: selected ? 700 : 500,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'inherit',
  });
  const otherInputStyle: CSSProperties = {
    width: '100%', marginTop: 8, padding: '13px 14px', border: `1.5px solid ${C.borderStrong}`,
    borderRadius: 12, background: C.bg, color: C.text, fontSize: 15, boxSizing: 'border-box',
    outline: 'none', fontFamily: 'inherit',
  };

  return shell(
    <>
      {/* 상단 진행바 */}
      <div style={{ paddingTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: C.muted, marginBottom: 8 }}>
          <span>{currentQ + 1} / {totalQ}</span>
          {hospitalName && <span style={{ fontWeight: 600, color: C.sub }}>{hospitalName}</span>}
        </div>
        <div style={{ height: 5, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: accent, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* 질문 */}
      <div style={{ flex: 1, paddingTop: 28, paddingBottom: 16 }}>
        <h2 style={{ margin: '0 0 22px', fontSize: 21, fontWeight: 800, color: C.text, lineHeight: 1.45 }}>
          {question.text}
        </h2>

        {question.type === 'short_text' && (
          <input style={otherInputStyle}
            value={typeof currentAnswer === 'string' ? currentAnswer : ''}
            onChange={(e) => setAns(question.id, e.target.value)}
            placeholder="답변을 입력해 주세요" autoFocus />
        )}

        {question.type === 'long_text' && (
          <textarea style={{ ...otherInputStyle, minHeight: 120, resize: 'vertical' }}
            value={typeof currentAnswer === 'string' ? currentAnswer : ''}
            onChange={(e) => setAns(question.id, e.target.value)}
            placeholder="자유롭게 적어 주세요" rows={4} autoFocus />
        )}

        {question.type === 'single_choice' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {choices.map((opt) => {
              const selected = currentAnswer === opt;
              return (
                <div key={opt}>
                  <button type="button" onClick={() => setAns(question.id, opt)} style={optBtn(selected)}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, border: `2px solid ${selected ? accent : C.borderStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {selected && <span style={{ width: 9, height: 9, borderRadius: '50%', background: accent }} />}
                    </span>
                    {opt}
                  </button>
                  {selected && isOtherChoice(opt) && (
                    <input style={otherInputStyle} value={otherText[question.id] ?? ''} onChange={(e) => setOtherText((p) => ({ ...p, [question.id]: e.target.value }))} placeholder="직접 입력해 주세요" autoFocus />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {question.type === 'multi_choice' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: '0 0 2px', fontSize: 13, color: C.muted }}>복수 선택 가능</p>
            {choices.map((opt) => {
              const arr = Array.isArray(currentAnswer) ? currentAnswer : [];
              const selected = arr.includes(opt);
              return (
                <div key={opt}>
                  <button type="button" onClick={() => toggleMulti(question.id, opt)} style={optBtn(selected)}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, border: `2px solid ${selected ? accent : C.borderStrong}`, background: selected ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {selected && (
                        <svg width="11" height="9" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                    </span>
                    {opt}
                  </button>
                  {selected && isOtherChoice(opt) && (
                    <input style={otherInputStyle} value={otherText[question.id] ?? ''} onChange={(e) => setOtherText((p) => ({ ...p, [question.id]: e.target.value }))} placeholder="직접 입력해 주세요" autoFocus />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {question.type === 'scale' && scaleMeta && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.muted, marginBottom: 14 }}>
              <span>{scaleMeta.minLabel || scaleMeta.min}</span>
              <span>{scaleMeta.maxLabel || scaleMeta.max}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {Array.from({ length: scaleMeta.max - scaleMeta.min + 1 }, (_, i) => scaleMeta.min + i).map((n) => {
                const selected = currentAnswer === String(n);
                return (
                  <button key={n} type="button" onClick={() => setAns(question.id, String(n))}
                    style={{ width: 46, height: 46, border: `1.5px solid ${selected ? accent : C.border}`, borderRadius: 12, background: selected ? `${accent}12` : C.bg, color: selected ? accent : C.text, fontSize: 16, fontWeight: selected ? 700 : 500, cursor: 'pointer' }}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 하단 내비게이션 */}
      <div style={{ position: 'sticky', bottom: 0, background: C.subtle, padding: '12px 0 20px', display: 'flex', gap: 10 }}>
        {currentQ > 0 && (
          <button type="button" onClick={handlePrev}
            style={{ flex: 1, padding: '15px', border: `1.5px solid ${C.borderStrong}`, borderRadius: 14, background: C.bg, color: C.sub, fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            이전
          </button>
        )}
        <button type="button" onClick={handleNext} disabled={!canGoNext}
          style={{ flex: 2, padding: '15px', border: 'none', borderRadius: 14, background: canGoNext ? accent : C.border, color: canGoNext ? '#fff' : C.muted, fontSize: 16, fontWeight: 700, cursor: canGoNext ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
          {currentQ === totalQ - 1 ? '제출하기' : '다음'}
        </button>
      </div>
    </>,
  );
}
