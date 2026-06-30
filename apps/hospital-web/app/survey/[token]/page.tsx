'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { ddxGetPublic, ddxPostPublic } from '@/lib/ddx-api';
import { consentRequiredText, consentMarketingText, CONSENT_REQUIRED_LABEL, CONSENT_MARKETING_LABEL } from '@/lib/intake/form-spec';

// ─── 타입 ────────────────────────────────────────────────
type Question = {
  id: string;
  order: number;
  text: string;
  type: string;
  options?: unknown;
  stage?: string | null; // 카테고리 키(guardian/basic/lifestyle/history/visit)를 운반
  source?: string | null; // 'prefilled' 이면 병원이 미리 답한 숨김 질문(보호자에겐 안 보임)
};

// 이름 마지막 글자에 받침이 있는지(한글이 아니면 false).
function nameHasBatchim(name: string): boolean {
  const c = name.charCodeAt(name.length - 1);
  const isHangul = c >= 0xac00 && c <= 0xd7a3;
  return isHangul && (c - 0xac00) % 28 !== 0;
}

// 이름 뒤 주격 조사 '가'를 붙인다. 받침 있는 이름은 친근한 '이'를 넣어 'OO이가'(콩→콩이가), 없으면 'OO가'(초코→초코가).
function withSubjectParticle(name: string): string {
  return name + (nameHasBatchim(name) ? '이가' : '가');
}

// 이름 뒤 관형격 조사 '의'를 붙인다. 받침 있는 이름은 친근한 '이'를 넣어 'OO이의'(콩→콩이의), 없으면 'OO의'(초코→초코의).
function withPossessive(name: string): string {
  return name + (nameHasBatchim(name) ? '이의' : '의');
}

// 카테고리가 바뀌는 첫 질문 앞에 잠깐 띄우는 대화형 인트로 멘트.
// 환자 기본 정보 다음(생활/병력/내원사유)부터는 아이 이름을 넣어 더 친근하게.
function categoryIntroMent(category: string, petName: string): string | null {
  const name = petName.trim();
  switch (category) {
    case 'guardian': return '먼저 보호자님 정보를 여쭤볼게요 :)';
    case 'basic': return '이제 우리 아이에 대해서 알려주세요!';
    case 'lifestyle': return `${withPossessive(name || '아이')} 평소 생활은 어떤지 알아볼게요.`;
    case 'history': return `지금까지 ${withPossessive(name || '아이')} 건강·예방 이력을 확인할게요.`;
    case 'visit': return name
      ? `마지막으로, ${withSubjectParticle(name)} 이번에 병원에 내원하려는 이유를 알아볼게요!`
      : '마지막으로, 오늘 내원하신 이유를 자세히 들려주세요.';
    default: return null;
  }
}

// 마지막 질문 제출 시 잠깐 띄우는 마무리 인사(자동으로 제출로 이어짐).
const FINAL_THANKS = '문진표를 작성해주셔서 감사합니다 :)';

// 경과 확인(재진) 방문 여부. ('경과 확인' = 현행 라벨, '재진' = 레거시)
function isFollowUpVisitType(visitType: string | null | undefined): boolean {
  return visitType === '경과 확인' || visitType === '재진';
}
// 경과 확인 설문은 시작 시 한 번, 지난 진료 이후의 변화를 살핀다는 인사를 띄운다.
function followUpStartMent(petName: string): string {
  const name = petName.trim() || '아이';
  return `저번 진료 이후에 ${withPossessive(name)} 건강 상태에 어떤 변화가 있는지 알아볼게요!`;
}

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

// "없음 / 해당 없음 / 접종 안함" 류의 배타 선택지 — 멀티초이스에서 이걸 고르면 다른 보기와 동시 선택 불가.
// '없다'는 "기력이 없다" 같은 증상 보기와 헷갈리지 않게 단독일 때만 배타로 본다.
function isExclusiveOption(opt: string): boolean {
  const s = opt.replace(/\s/g, '');
  if (s === '없다') return true;
  return /없음|안함|해당없/.test(s);
}

// 멀티초이스 보기 정렬 — 배타 옵션(없음 류)을 맨 위로 올리고 나머지는 원래 순서 유지.
function orderMultiChoices(choices: string[]): string[] {
  return [...choices.filter(isExclusiveOption), ...choices.filter((c) => !isExclusiveOption(c))];
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

type Step = 'loading' | 'error' | 'already' | 'intro' | 'survey' | 'consent' | 'submitting' | 'done';

export default function PublicSurveyPage() {
  const params = useParams();
  const token = typeof params.token === 'string' ? params.token : Array.isArray(params.token) ? params.token[0] : '';

  const [step, setStep] = useState<Step>('loading');
  const [session, setSession] = useState<SurveySession | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [intro, setIntro] = useState<string | null>(null); // 카테고리 인트로 멘트(잠시 떴다가 자동으로 다음 질문)
  // 신규환자만 마지막에 개인정보 동의(필수)·마케팅 동의(선택)를 받는다.
  const [consentRequired, setConsentRequired] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);

  const ac = useMemo(() => buildAccent(session?.hospital?.brandColor), [session]);
  const hospitalName = session?.hospital?.name?.trim() || '';
  const isNewPatient = (session?.visitType ?? '') === '신규환자';

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
        const otherPrefill: Record<string, string> = {}; // 주소 상세주소 등 보조 입력
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
          if (q.type === 'address') {
            // answerJson 에 { base, detail } 로 저장. base=검색 주소, detail=상세주소(otherText).
            const j = a.answerJson;
            if (j && typeof j === 'object' && !Array.isArray(j)) {
              const obj = j as { base?: unknown; detail?: unknown };
              if (typeof obj.base === 'string' && obj.base) prefill[a.questionInstanceId] = obj.base;
              if (typeof obj.detail === 'string' && obj.detail) otherPrefill[a.questionInstanceId] = obj.detail;
              if (typeof obj.base === 'string') continue;
            }
            if (a.answerText != null) prefill[a.questionInstanceId] = a.answerText;
            continue;
          }
          if (Array.isArray(a.answerJson)) prefill[a.questionInstanceId] = a.answerJson as string[];
          else if (a.answerText != null) prefill[a.questionInstanceId] = a.answerText;
        }
        setAnswers(prefill);
        setOtherText(otherPrefill);
        if (data.session.status === 'completed') setStep('already');
        else setStep('intro');
      })
      .catch(() => { setStep('error'); setErrorMsg('문진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
  }, [token]);

  const allQuestions = session?.questions ?? [];
  // 인트로 멘트에 넣을 아이 이름 — 발송 시 받은 값 우선, 없으면 '반려동물 이름' 답변.
  const petName = useMemo(() => {
    const fromSession = session?.patientName?.trim();
    if (fromSession) return fromSession;
    const q = allQuestions.find((x) => x.text === '반려동물 이름');
    const a = q ? answers[q.id] : undefined;
    return typeof a === 'string' ? a.trim() : '';
  }, [session, allQuestions, answers]);
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

  // 분기는 모든 질문(선답변 포함) 기준으로 판정하되, 화면에는 선답변(prefilled) 질문을 노출하지 않는다.
  const visible = useMemo(() => allQuestions.filter(isVisible).filter((q) => q.source !== 'prefilled'), [allQuestions, isVisible]);
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
      // 배타 옵션(없음 류)을 고르면 나머지를 모두 해제하고 그것만 선택.
      if (isExclusiveOption(option)) return { ...p, [qid]: [option] };
      // 일반 옵션을 고르면 기존에 선택돼 있던 배타 옵션은 자동 해제.
      const base = cur.filter((v) => !isExclusiveOption(v));
      if (max != null && base.length >= max) return p; // 최대 선택 제한
      return { ...p, [qid]: [...base, option] };
    });
  };

  // 해당 인덱스 질문이 "새 카테고리의 첫 질문"이면 그 카테고리 인트로 멘트를 반환.
  const mentForIdx = (idx: number): string | null => {
    const q = visible[idx];
    if (!q?.stage) return null;
    const isFirstOfCategory = idx === 0 || visible[idx - 1]?.stage !== q.stage;
    return isFirstOfCategory ? categoryIntroMent(q.stage, petName) : null;
  };

  // 앞으로 이동할 때, 새 카테고리면 인트로를 잠깐 띄운다(뒤로 갈 땐 안 띄움).
  const goToIndex = (nextIdx: number) => {
    setCurrentQ(nextIdx);
    const m = mentForIdx(nextIdx);
    if (m) setIntro(m);
  };

  // intro 스텝 → survey 시작(시작/이어서/처음부터). 시작 지점이 카테고리 첫 질문이면 인트로 표시.
  // 경과 확인(재진) 방문은 처음부터 시작할 때(idx 0) 지난 진료 이후 변화를 살핀다는 인사를 먼저 띄운다.
  const startSurvey = (idx: number) => {
    setCurrentQ(idx);
    setStep('survey');
    if (idx === 0 && isFollowUpVisitType(session?.visitType)) setIntro(followUpStartMent(petName));
    else setIntro(mentForIdx(idx));
  };

  const handleNext = () => {
    if (!canGoNext) return;
    if (clampedIdx < totalQ - 1) goToIndex(clampedIdx + 1);
    // 신규환자는 마지막 답변 후 개인정보 동의 화면을 거친다. 그 외(기존환자)는 곧바로 제출.
    else if (isNewPatient) setStep('consent');
    // 마지막 답변 순간 곧바로 제출(complete:true)을 전송한다(keepalive 로 끝까지 전송 보장).
    else { setIntro(FINAL_THANKS); handleSubmit(); }
  };

  // 동의 화면에서 "동의하고 제출" — 필수 동의가 있어야 진행.
  const submitFromConsent = () => {
    if (!consentRequired) return;
    setStep('survey');
    setIntro(FINAL_THANKS);
    handleSubmit();
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
        if (q.type === 'address') {
          // base=검색 주소, detail=상세주소(otherText). answerText 는 합쳐서 저장.
          if (typeof a !== 'string') return null;
          const base = a.trim();
          if (!base) return null;
          const detail = otherText[q.id]?.trim() ?? '';
          const full = detail ? `${base} ${detail}` : base;
          return { questionInstanceId: q.id, answerJson: { base, detail }, answerText: full };
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
    // step 을 'submitting' 으로 바꾸지 않는다 — 요청이 끝날 때까지 마무리 인사(FINAL_THANKS)를 그대로 보여주고,
    // 완료되면 'done' 으로 전환한다. keepalive 로 전송 중 창을 닫아도 제출이 보장된다.
    try {
      const res = await ddxPostPublic<{ success: boolean; error?: string }>('/api/survey', {
        token, answers: buildPayload(), complete: true,
        // 신규환자 동의 결과(필수 동의시각 + 마케팅 여부). 그 외 방문유형은 동의 단계가 없어 전송 안 함.
        ...(isNewPatient ? { consentAgreedAt: new Date().toISOString(), consentMarketing } : {}),
      }, { keepalive: true });
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

  // 카테고리 인트로는 잠깐 떴다가(별도 버튼 없이) 자동으로 사라지고 다음 질문이 나타난다.
  // 단, 마무리 인사(FINAL_THANKS)는 자동으로 닫지 않는다 — 제출 결과(done/error)가 화면을 전환할 때까지 유지.
  useEffect(() => {
    if (!intro || intro === FINAL_THANKS) return;
    const t = setTimeout(() => setIntro(null), 1800);
    return () => clearTimeout(t);
  }, [intro]);

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

  if (step === 'consent') {
    const boxStyle: CSSProperties = { background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', fontSize: 13.5, color: C.textSec, lineHeight: 1.7, whiteSpace: 'pre-line', maxHeight: 200, overflowY: 'auto', marginBottom: 10 };
    const rowStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 20, fontSize: 15, color: C.text, lineHeight: 1.5, cursor: 'pointer' };
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: C.text, margin: '0 0 6px' }}>개인정보 수집·이용 동의</h1>
          <p style={{ fontSize: 14, color: C.muted, margin: '0 0 18px', lineHeight: 1.6 }}>원활한 진료를 위해 아래 동의가 필요합니다.</p>

          <div style={boxStyle}>{consentRequiredText(hospitalName)}</div>
          <label style={rowStyle}>
            <input type="checkbox" checked={consentRequired} onChange={(e) => setConsentRequired(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--ac)', flexShrink: 0, marginTop: 1 }} />
            <span>{CONSENT_REQUIRED_LABEL}</span>
          </label>

          <div style={boxStyle}>{consentMarketingText(hospitalName)}</div>
          <label style={rowStyle}>
            <input type="checkbox" checked={consentMarketing} onChange={(e) => setConsentMarketing(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--ac)', flexShrink: 0, marginTop: 1 }} />
            <span>{CONSENT_MARKETING_LABEL}</span>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, flexShrink: 0, paddingTop: 8 }}>
          <button type="button" className="sv-press" onClick={() => { setStep('survey'); setCurrentQ(Math.max(0, totalQ - 1)); }} style={btnSecondary}>이전</button>
          <button type="button" className="sv-press" onClick={submitFromConsent} disabled={!consentRequired} style={btnPrimary(!consentRequired)}>동의하고 제출</button>
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
              <button type="button" className="sv-press" onClick={() => startSurvey(resumeIdx)} style={{ ...btnPrimary(false), width: '100%', padding: '17px', fontSize: 17 }}>
                이어서 작성하기
              </button>
              <button type="button" className="sv-press" onClick={() => startSurvey(0)} style={{ width: '100%', marginTop: 10, padding: '14px', fontSize: 15, fontWeight: 600, color: C.textSec, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                처음부터 다시 보기
              </button>
            </>
          ) : (
            <button type="button" className="sv-press" onClick={() => startSurvey(0)} style={{ ...btnPrimary(false), width: '100%', padding: '17px', fontSize: 17 }}>
              시작하기
            </button>
          )}
        </div>
      </Screen>
    );
  }

  // 설문
  if (!question) return <Screen accent={ac}><div /></Screen>;

  // 카테고리 인트로: 별도 버튼 없이 잠깐 떴다가 자동으로 사라지며 다음 질문이 나타난다.
  if (intro) {
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 8px' }}>
          <h2 key={intro} className="sv-intro" style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-0.02em', color: C.text, lineHeight: 1.5, margin: 0, wordBreak: 'keep-all' }}>
            {intro}
          </h2>
        </div>
      </Screen>
    );
  }

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

          {question.type === 'address' && (
            <AddressField
              base={typeof currentAnswer === 'string' ? currentAnswer : ''}
              detail={otherText[question.id] ?? ''}
              onBase={(v) => setAns(question.id, v)}
              onDetail={(v) => setOtherText((p) => ({ ...p, [question.id]: v }))}
            />
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
              {orderMultiChoices(getChoices(question)).map((opt) => {
                const arr = Array.isArray(currentAnswer) ? currentAnswer : [];
                const active = arr.includes(opt);
                // 배타 옵션(없음 류)이 선택돼 있으면 나머지 보기는 비활성화한다.
                const disabled = arr.some(isExclusiveOption) && !isExclusiveOption(opt);
                return (
                  <div key={opt}>
                    <button type="button" className="sv-press" disabled={disabled} onClick={() => toggleMulti(question.id, opt, getMaxSelections(question))}
                      style={{ ...cardStyle(active), textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
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

// 카카오(다음) 우편번호 서비스 스크립트를 필요할 때 한 번만 로드.
let daumPostcodePromise: Promise<void> | null = null;
function loadDaumPostcode(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const w = window as unknown as { daum?: { Postcode?: unknown } };
  if (w.daum?.Postcode) return Promise.resolve();
  if (daumPostcodePromise) return daumPostcodePromise;
  daumPostcodePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { daumPostcodePromise = null; reject(new Error('load failed')); };
    document.head.appendChild(s);
  });
  return daumPostcodePromise;
}

// 주소 입력 — "주소 검색"(다음 우편번호) + 상세주소.
function AddressField({ base, detail, onBase, onDetail }: {
  base: string; detail: string;
  onBase: (v: string) => void; onDetail: (v: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const openSearch = async () => {
    setLoading(true);
    try {
      await loadDaumPostcode();
      const w = window as unknown as { daum: { Postcode: new (opts: unknown) => { open: () => void } } };
      new w.daum.Postcode({
        oncomplete: (data: { roadAddress?: string; jibunAddress?: string; zonecode?: string }) => {
          const road = data.roadAddress || data.jibunAddress || '';
          const zip = data.zonecode ? `(${data.zonecode}) ` : '';
          onBase(`${zip}${road}`.trim());
        },
      }).open();
    } catch {
      // 우편번호 스크립트 로드 실패 — 직접 입력으로 폴백
      const manual = typeof window !== 'undefined' ? window.prompt('주소를 직접 입력해 주세요') : '';
      if (manual && manual.trim()) onBase(manual.trim());
    } finally {
      setLoading(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <input value={base} readOnly onClick={openSearch}
          placeholder="주소 검색 버튼을 눌러 주세요"
          style={{ ...inputStyle, flex: 1, minWidth: 0, cursor: 'pointer' }} />
        <button type="button" className="sv-press" onClick={openSearch} disabled={loading}
          style={{ flexShrink: 0, padding: '0 16px', fontSize: 15, fontWeight: 600, color: C.textSec, background: C.subtle, border: `1px solid ${C.borderStrong}`, borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          {loading ? '…' : '주소 검색'}
        </button>
      </div>
      <input value={detail} onChange={(e) => onDetail(e.target.value)}
        placeholder="상세주소 (동/호수 등)" style={inputStyle} />
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
      <style>{`.sv-press{transition:transform .12s ease,opacity .12s ease}.sv-press:not(:disabled):active{transform:scale(.975)}@keyframes sv-spin{to{transform:rotate(360deg)}}@keyframes sv-intro-in{0%{opacity:0;transform:translateY(10px) scale(.98)}100%{opacity:1;transform:none}}.sv-intro{animation:sv-intro-in .45s cubic-bezier(.16,1,.3,1)}`}</style>
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
