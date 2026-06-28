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

type Cond = { on?: number; value?: string; answered?: boolean };

// ─── 옵션/조건 파싱 헬퍼 ──────────────────────────────────
function optObj(q: Question): Record<string, unknown> | null {
  const o = q.options;
  if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
  return null;
}

function getChoices(q: Question): string[] {
  const o = q.options;
  if (!o) return [];
  if (Array.isArray(o)) return o as string[];
  const c = (o as Record<string, unknown>).choices;
  if (Array.isArray(c)) return c as string[];
  return [];
}

function getScaleMeta(q: Question): { min: number; max: number; minLabel: string; maxLabel: string } {
  const o = optObj(q);
  return {
    min: typeof o?.min === 'number' ? o.min : 0,
    max: typeof o?.max === 'number' ? o.max : 10,
    minLabel: typeof o?.minLabel === 'string' ? o.minLabel : '',
    maxLabel: typeof o?.maxLabel === 'string' ? o.maxLabel : '',
  };
}

function getMaxSelections(q: Question): number | null {
  const o = optObj(q);
  return typeof o?.maxSelections === 'number' ? o.maxSelections : null;
}

function getCond(q: Question): Cond {
  const o = optObj(q);
  if (!o) return {};
  return {
    on: typeof o.conditionalOn === 'number' ? o.conditionalOn : undefined,
    value: typeof o.conditionalValue === 'string' ? o.conditionalValue : undefined,
    answered: o.conditionalAnswered === true,
  };
}

// conditional_select: 이전 답변(종류)에 따라 품종 보기 매핑
function getConditionalChoices(q: Question): { on?: number; map: Record<string, string[] | null> } {
  const o = optObj(q);
  const map = (o?.choices && typeof o.choices === 'object' && !Array.isArray(o.choices)) ? (o.choices as Record<string, string[] | null>) : {};
  return { on: typeof o?.conditionalOn === 'number' ? o.conditionalOn : undefined, map };
}

function isFreeOption(opt: string, qType: string): boolean {
  if (qType === 'conditional_select') return /기타|직접\s*입력|그\s*외/.test(opt);
  return /기타|직접\s*입력/.test(opt);
}

// pet_birthday 답변에서 "생일 모름 + 대략 나이" 케이스는 클라이언트 state 에서 마커 prefix 로 인코딩한다(객체 state 도입 회피).
// 제출(buildPayload) 단계에서 백엔드가 기대하는 answerJson({ unknownBirthday, approximateYears }) 으로 변환된다.
const UNKNOWN_AGE_PREFIX = 'UNKNOWN_AGE:';

function answerNonEmpty(a: string | string[] | undefined): boolean {
  if (a == null) return false;
  if (Array.isArray(a)) return a.length > 0;
  if (typeof a !== 'string') return false;
  if (a.startsWith(UNKNOWN_AGE_PREFIX)) {
    const rest = a.slice(UNKNOWN_AGE_PREFIX.length);
    return rest.length > 0 && Number(rest) > 0;
  }
  return a.trim().length > 0;
}

function answerMatches(a: string | string[] | undefined, value: string): boolean {
  const opts = value.split('||');
  if (Array.isArray(a)) return a.some((x) => opts.includes(x));
  return opts.includes(String(a ?? ''));
}

// ─── 라이트 고정 팔레트 (초진 접수증과 동일 톤) ─────────────
const C = {
  bg: '#ffffff', subtle: '#f7f7f8', border: '#e8e8eb', borderStrong: '#d8d9dd',
  text: '#18181b', textSec: '#71717a', muted: '#a1a1aa', ink: '#18181b', danger: '#dc2626',
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

function formatScheduledDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
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
          setErrorMsg(
            data.error === 'not_found' ? '문진을 찾을 수 없습니다. 링크를 다시 확인해 주세요.'
              : data.error === 'expired' ? '문진 작성 기간이 만료되었습니다. 병원에 문의해 주세요.'
                : '문진을 불러오지 못했습니다.',
          );
          return;
        }
        setSession(data.session);
        const prefill: Record<string, string | string[]> = {};
        const qById = new Map(data.session.questions.map((q) => [q.id, q]));
        for (const a of data.session.answers ?? []) {
          if (!qById.has(a.questionInstanceId)) continue;
          const q = qById.get(a.questionInstanceId)!;
          if (q.type === 'pet_birthday') {
            // 백엔드는 answerJson 에 { date } 또는 { unknownBirthday: true, approximateYears } 형태로 저장한다.
            const j = a.answerJson;
            if (j && typeof j === 'object' && !Array.isArray(j)) {
              const obj = j as { date?: unknown; unknownBirthday?: unknown; approximateYears?: unknown };
              if (obj.unknownBirthday === true && typeof obj.approximateYears === 'number' && obj.approximateYears > 0) {
                prefill[a.questionInstanceId] = `${UNKNOWN_AGE_PREFIX}${obj.approximateYears}`;
                continue;
              }
              if (typeof obj.date === 'string' && obj.date) {
                prefill[a.questionInstanceId] = obj.date;
                continue;
              }
            }
            if (a.answerText != null) prefill[a.questionInstanceId] = a.answerText;
            continue;
          }
          if (Array.isArray(a.answerJson)) prefill[a.questionInstanceId] = a.answerJson as string[];
          else if (a.answerText != null) prefill[a.questionInstanceId] = a.answerText;
        }
        setAnswers(prefill);
        if (data.session.status === 'completed') setStep('already');
        else setStep('intro');
      })
      .catch(() => { setStep('error'); setErrorMsg('문진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
  }, [token]);

  const allQuestions = session?.questions ?? [];
  const byOrder = useMemo(() => {
    const m = new Map<number, Question>();
    for (const q of allQuestions) m.set(q.order, q);
    return m;
  }, [allQuestions]);

  // 조건부 분기: 이전 답변에 따라 보일 질문만 추림
  const isVisible = useMemo(() => {
    return (q: Question): boolean => {
      const c = getCond(q);
      const condOn = q.type === 'conditional_select' ? getConditionalChoices(q).on : c.on;
      if (condOn === undefined) return true;
      const condQ = byOrder.get(condOn);
      if (!condQ) return true;
      const ans = answers[condQ.id];
      if (!answerNonEmpty(ans)) return false;
      if (q.type === 'conditional_select') return true;
      if (c.answered) return true;
      if (c.value !== undefined) return answerMatches(ans, c.value);
      return true;
    };
  }, [answers, byOrder]);

  const visible = useMemo(() => allQuestions.filter(isVisible), [allQuestions, isVisible]);
  const totalQ = visible.length;
  const clampedIdx = Math.min(currentQ, Math.max(0, totalQ - 1));
  const question = visible[clampedIdx] ?? null;
  const currentAnswer = question ? (answers[question.id] ?? '') : '';

  // conditional_select: 현재 종류 답변 → 품종 보기 결정
  const condSelect = useMemo(() => {
    if (!question || question.type !== 'conditional_select') return null;
    const { on, map } = getConditionalChoices(question);
    const condQ = on !== undefined ? byOrder.get(on) : undefined;
    const speciesAns = condQ ? answers[condQ.id] : undefined;
    const key = Array.isArray(speciesAns) ? speciesAns[0] : (typeof speciesAns === 'string' ? speciesAns : '');
    const list = map[key];
    return { list: Array.isArray(list) ? list : null }; // null → 자유 입력
  }, [question, byOrder, answers]);

  const needsFreeText = useMemo(() => {
    if (!question) return false;
    if (question.type === 'single_choice') return typeof currentAnswer === 'string' && isFreeOption(currentAnswer, 'single_choice');
    if (question.type === 'multi_choice') return Array.isArray(currentAnswer) && currentAnswer.some((o) => isFreeOption(o, 'multi_choice'));
    if (question.type === 'conditional_select') {
      if (condSelect && condSelect.list === null) return false; // 직접 입력 자체가 답변
      return typeof currentAnswer === 'string' && isFreeOption(currentAnswer, 'conditional_select');
    }
    return false;
  }, [question, currentAnswer, condSelect]);

  const canGoNext = (() => {
    if (!question) return false;
    // conditional_select 자유 입력형: answers 에 직접 입력
    if (question.type === 'conditional_select' && condSelect && condSelect.list === null) {
      return typeof currentAnswer === 'string' && currentAnswer.trim().length > 0;
    }
    if (!answerNonEmpty(currentAnswer as string | string[])) return false;
    if (needsFreeText && !(otherText[question.id]?.trim())) return false;
    return true;
  })();

  const setAns = (qid: string, value: string | string[]) => setAnswers((p) => ({ ...p, [qid]: value }));
  const toggleMulti = (qid: string, option: string, max: number | null) => {
    setAnswers((p) => {
      const cur = Array.isArray(p[qid]) ? (p[qid] as string[]) : [];
      const has = cur.includes(option);
      if (has) return { ...p, [qid]: cur.filter((v) => v !== option) };
      if (max != null && cur.length >= max) return p; // 최대 선택 제한
      return { ...p, [qid]: [...cur, option] };
    });
  };

  const handleNext = () => {
    if (!canGoNext) return;
    if (clampedIdx < totalQ - 1) setCurrentQ(clampedIdx + 1);
    else handleSubmit();
  };
  const handlePrev = () => { if (clampedIdx > 0) setCurrentQ(clampedIdx - 1); };

  const buildPayload = () => {
    const applyFree = (qid: string, opt: string, qType: string) =>
      (isFreeOption(opt, qType) && otherText[qid]?.trim() ? otherText[qid].trim() : opt);
    return allQuestions
      .filter(isVisible)
      .map((q) => {
        const a = answers[q.id];
        if (a == null) return null;
        if (q.type === 'pet_birthday') {
          // UNKNOWN_AGE: prefix → { unknownBirthday, approximateYears }, 일반 string → { date }
          if (typeof a !== 'string') return null;
          if (a.startsWith(UNKNOWN_AGE_PREFIX)) {
            const years = parseInt(a.slice(UNKNOWN_AGE_PREFIX.length), 10);
            if (!Number.isFinite(years) || years <= 0) return null;
            return {
              questionInstanceId: q.id,
              answerJson: { unknownBirthday: true, approximateYears: years },
              answerText: `약 ${years}세`,
            };
          }
          const date = a.trim();
          if (!date) return null;
          return { questionInstanceId: q.id, answerJson: { date }, answerText: date };
        }
        if (Array.isArray(a)) {
          if (a.length === 0) return null;
          const mapped = a.map((opt) => applyFree(q.id, opt, q.type));
          return { questionInstanceId: q.id, answerJson: mapped, answerText: mapped.join(', ') };
        }
        const s = String(a).trim();
        if (!s) return null;
        const finalText = (q.type === 'single_choice' || q.type === 'conditional_select') ? applyFree(q.id, s, q.type) : s;
        return { questionInstanceId: q.id, answerText: finalText };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  };

  const handleSubmit = async () => {
    if (!token) return;
    setStep('submitting');
    try {
      const res = await ddxPostPublic<{ success: boolean; error?: string }>('/api/survey', {
        token, answers: buildPayload(), complete: true,
      });
      if (res.success) setStep('done');
      else if (res.error === 'already_completed') setStep('already');
      else { setStep('error'); setErrorMsg(res.error || '제출에 실패했습니다.'); }
    } catch {
      setStep('error');
      setErrorMsg('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  // 작성 중 답변을 백그라운드로 자동 저장(complete:false) — 중간에 나갔다 다시 들어와도 이어서 작성 가능.
  // 답변/기타입력이 바뀔 때마다 디바운스 후 현재까지의 답변을 upsert 한다(제출 전이므로 complete:false).
  useEffect(() => {
    if (step !== 'survey' || !token) return;
    const payload = buildPayload();
    if (payload.length === 0) return;
    const t = setTimeout(() => {
      ddxPostPublic('/api/survey', { token, answers: payload, complete: false }).catch(() => { /* 자동 저장 실패는 조용히 무시 */ });
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, otherText, step, token]);

  // ─── 렌더 ──────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={spinnerStyle(ac)} />
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
          <p style={{ fontSize: 16, color: C.textSec, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-line' }}>
            {isDone ? '사전문진 작성 감사합니다.\n꼼꼼하게 진료 준비하도록 하겠습니다.' : '이 문진은 이미 작성이 완료되었습니다.\n이 창은 닫으셔도 됩니다.'}
          </p>
        </div>
      </Screen>
    );
  }

  if (step === 'submitting') {
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <span style={spinnerStyle(ac)} />
          <p style={{ fontSize: 16, color: C.textSec, margin: 0 }}>제출하는 중…</p>
        </div>
      </Screen>
    );
  }

  if (step === 'intro') {
    const patient = session?.patientName?.trim() || '';
    const scheduledText = formatScheduledDate(session?.scheduledDate);
    // 이전에 작성하던 답변이 있으면 "이어서 작성하기" 제공 — 첫 미답변 질문으로 점프.
    const answeredCount = visible.filter((q) => answerNonEmpty(answers[q.id])).length;
    const hasProgress = answeredCount > 0;
    const resumeIdx = (() => {
      const i = visible.findIndex((q) => !answerNonEmpty(answers[q.id]));
      return i === -1 ? Math.max(0, totalQ - 1) : i;
    })();
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ac)', marginBottom: 14, letterSpacing: '-0.01em' }}>
            {hospitalName ? `${hospitalName} 사전문진` : '사전문진'}
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.32, color: C.text, margin: 0 }}>
            사전문진 작성을 부탁 드려요!
          </h1>
          <p style={{ fontSize: 16, fontWeight: 500, color: C.textSec, letterSpacing: '-0.01em', lineHeight: 1.7, margin: '18px 0 0' }}>
            본원에서는 보다 정확한 환자 상태 파악과 진료를 위해<br />내원 전 사전문진을 진행하고 있습니다.
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
          {hasProgress ? (
            <>
              <p style={{ margin: '0 0 12px', fontSize: 14.5, color: C.textSec, textAlign: 'center', lineHeight: 1.6 }}>
                이전에 작성하던 내용이 저장되어 있어요.
              </p>
              <button type="button" className="sv-press" onClick={() => { setCurrentQ(resumeIdx); setStep('survey'); }} style={{ ...btnPrimary(false), width: '100%', padding: '17px', fontSize: 17 }}>
                이어서 작성하기
              </button>
              <button type="button" className="sv-press" onClick={() => { setCurrentQ(0); setStep('survey'); }} style={{ width: '100%', marginTop: 10, padding: '14px', fontSize: 15, fontWeight: 600, color: C.textSec, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                처음부터 다시 보기
              </button>
            </>
          ) : (
            <button type="button" className="sv-press" onClick={() => setStep('survey')} style={{ ...btnPrimary(false), width: '100%', padding: '17px', fontSize: 17 }}>
              시작하기
            </button>
          )}
        </div>
      </Screen>
    );
  }

  // 설문
  if (!question) return <Screen accent={ac}><div /></Screen>;
  const progress = totalQ > 1 ? clampedIdx / (totalQ - 1) : 0;
  const isLast = clampedIdx === totalQ - 1;

  return (
    <Screen accent={ac}>
      <div style={{ height: 3, background: C.border, borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--ac)', transition: 'width .25s' }} />
      </div>
      {hospitalName && (
        <div style={{ fontSize: 13, color: C.muted, marginTop: 10, flexShrink: 0, letterSpacing: '0.01em' }}>{hospitalName}</div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 2px 12vh' }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: C.text, margin: '0 0 20px', lineHeight: 1.45 }}>
            {question.text}
          </h2>

          {(question.type === 'short_text' || question.type === 'phone') && (
            <input autoFocus value={typeof currentAnswer === 'string' ? currentAnswer : ''}
              onChange={(e) => setAns(question.id, e.target.value)}
              inputMode={question.type === 'phone' ? 'tel' : undefined}
              type={question.type === 'phone' ? 'tel' : 'text'}
              placeholder={question.type === 'phone' ? '연락처를 입력해 주세요' : '답변을 입력해 주세요'} style={inputStyle} />
          )}

          {question.type === 'long_text' && (
            <textarea autoFocus value={typeof currentAnswer === 'string' ? currentAnswer : ''}
              onChange={(e) => setAns(question.id, e.target.value)} placeholder="자유롭게 적어 주세요" rows={4} style={textareaStyle} />
          )}

          {question.type === 'pet_birthday' && (() => {
            // 초진 접수증과 동일한 UX: 기본은 생일(date input), "생일을 모르겠어요" 체크 시 대략 나이(년) 입력.
            const raw = typeof currentAnswer === 'string' ? currentAnswer : '';
            const unknown = raw.startsWith(UNKNOWN_AGE_PREFIX);
            const dateVal = unknown ? '' : raw;
            const ageVal = unknown ? raw.slice(UNKNOWN_AGE_PREFIX.length) : '';
            return (
              <div>
                {!unknown && (
                  <input autoFocus type="date" max={new Date().toISOString().slice(0, 10)}
                    value={dateVal}
                    onChange={(e) => setAns(question.id, e.target.value)} style={inputStyle} />
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, fontSize: 15, color: C.textSec, cursor: 'pointer' }}>
                  <input type="checkbox" checked={unknown}
                    onChange={(e) => setAns(question.id, e.target.checked ? UNKNOWN_AGE_PREFIX : '')}
                    style={{ width: 18, height: 18, accentColor: 'var(--ac)', flexShrink: 0 }} />
                  생일을 모르겠어요
                </label>
                {unknown && (
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input autoFocus inputMode="numeric" value={ageVal}
                      onChange={(e) => setAns(question.id, UNKNOWN_AGE_PREFIX + e.target.value.replace(/\D/g, '').slice(0, 2))}
                      placeholder="대략적인 나이" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: 17, color: C.textSec }}>세</span>
                  </div>
                )}
              </div>
            );
          })()}

          {question.type === 'single_choice' && (
            <ChoiceList options={getChoices(question)} qid={question.id} qType="single_choice"
              currentAnswer={currentAnswer} otherText={otherText} setAns={setAns} setOtherText={setOtherText} />
          )}

          {question.type === 'conditional_select' && (
            condSelect && condSelect.list === null ? (
              <input autoFocus value={typeof currentAnswer === 'string' ? currentAnswer : ''}
                onChange={(e) => setAns(question.id, e.target.value)} placeholder="품종을 직접 입력해 주세요" style={inputStyle} />
            ) : (
              <ChoiceList options={condSelect?.list ?? []} qid={question.id} qType="conditional_select"
                currentAnswer={currentAnswer} otherText={otherText} setAns={setAns} setOtherText={setOtherText} columns={2} compact />
            )
          )}

          {question.type === 'multi_choice' && (
            <div style={{ display: 'grid', gap: 6 }}>
              <p style={{ margin: '0 0 4px', fontSize: 14, color: C.muted }}>
                여러 개 선택 가능{getMaxSelections(question) ? ` (최대 ${getMaxSelections(question)}개)` : ''}
              </p>
              {getChoices(question).map((opt) => {
                const arr = Array.isArray(currentAnswer) ? currentAnswer : [];
                const active = arr.includes(opt);
                return (
                  <div key={opt}>
                    <button type="button" className="sv-press" onClick={() => toggleMulti(question.id, opt, getMaxSelections(question))}
                      style={{ ...cardStyle(active), textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? 'var(--ac)' : '#e4e4e7', color: 'var(--ac-on)', fontSize: 12 }}>
                        {active ? '✓' : ''}
                      </span>
                      <span>{opt}</span>
                    </button>
                    {active && isFreeOption(opt, 'multi_choice') && (
                      <input autoFocus value={otherText[question.id] ?? ''} onChange={(e) => setOtherText((p) => ({ ...p, [question.id]: e.target.value }))}
                        placeholder="직접 입력해 주세요" style={{ ...inputStyle, marginTop: 10 }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {question.type === 'scale' && (() => {
            const m = getScaleMeta(question);
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: C.textSec, marginBottom: 14 }}>
                  <span>{m.minLabel || m.min}</span>
                  <span>{m.maxLabel || m.max}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {Array.from({ length: m.max - m.min + 1 }, (_, i) => m.min + i).map((n) => {
                    const active = currentAnswer === String(n);
                    return (
                      <button key={n} type="button" className="sv-press" onClick={() => setAns(question.id, String(n))}
                        style={{ ...cardStyle(active), flex: '1 1 44px', minWidth: 44, padding: '14px 0' }}>{n}</button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexShrink: 0, paddingTop: 8 }}>
        {clampedIdx > 0 && <button type="button" className="sv-press" onClick={handlePrev} style={btnSecondary}>이전</button>}
        <button type="button" className="sv-press" onClick={handleNext} disabled={!canGoNext} style={btnPrimary(!canGoNext)}>
          {isLast ? '제출하기' : '다음'}
        </button>
      </div>
    </Screen>
  );
}

// 단일선택/품종 선택 카드 리스트 (+ 기타/그 외 직접 입력)
function ChoiceList({ options, qid, qType, currentAnswer, otherText, setAns, setOtherText, columns = 1, compact = false }: {
  options: string[]; qid: string; qType: string;
  currentAnswer: string | string[];
  otherText: Record<string, string>;
  setAns: (qid: string, v: string | string[]) => void;
  setOtherText: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  columns?: number;
  compact?: boolean;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: compact ? 6 : 7 }}>
      {options.map((opt) => {
        const active = currentAnswer === opt;
        const free = active && isFreeOption(opt, qType);
        return (
          <div key={opt} style={{ gridColumn: free ? `1 / -1` : undefined }}>
            <button type="button" className="sv-press" onClick={() => setAns(qid, opt)} style={cardStyle(active, compact)}>{opt}</button>
            {free && (
              <input autoFocus value={otherText[qid] ?? ''} onChange={(e) => setOtherText((p) => ({ ...p, [qid]: e.target.value }))}
                placeholder="직접 입력해 주세요" style={{ ...inputStyle, marginTop: 10 }} />
            )}
          </div>
        );
      })}
    </div>
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

function spinnerStyle(ac: Accent): CSSProperties {
  return { width: 28, height: 28, border: `2.5px solid ${C.border}`, borderTopColor: ac.base, borderRadius: '50%', display: 'inline-block', animation: 'sv-spin 0.7s linear infinite' };
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
function cardStyle(active: boolean, compact = false): CSSProperties {
  return {
    width: '100%', padding: compact ? '9px 12px' : '15px 16px', fontSize: compact ? 15.5 : 16.5, fontWeight: active ? 600 : 500,
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
