'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  emptyAnswers, emptyPet,
  type IntakeAnswers, type PetAnswer, type Species,
  PET_COUNT_OPTIONS, SPECIES_OPTIONS, breedOptionsFor, BREED_FREETEXT_VALUES,
  SEX_OPTIONS, REGISTRATION_OPTIONS, INSURANCE_OPTIONS, SYMPTOM_OPTIONS,
  REFERRAL_CHANNEL_OPTIONS, ONLINE_MEDIA_OPTIONS,
  COMPLETE_TITLE, COMPLETE_BODY,
  consentRequiredText, consentMarketingText, CONSENT_REQUIRED_LABEL, CONSENT_MARKETING_LABEL,
  PRIVACY_POLICY_URL,
  speciesFromSurvey, sexFromSurvey,
} from '@/lib/intake/form-spec';

/** /api/intake/survey-match 응답의 매칭 항목(ddx-api → BFF → 클라).
 *  초진 접수증의 PetAnswer 와 동일한 모양으로 생일/나이를 전달 — birthDate 가 비고 ageUnknown=true 면 ageText 사용. */
type SurveyMatch = {
  id: string;
  patientName: string;
  scheduledDate: string | null;
  species: string;
  breed: string;
  sex: string;
  birthDate: string;
  ageUnknown: boolean;
  ageText: string;
};

// 라이트 고정 팔레트 (테마 변수 대신 — 다크모드 영향 없이 항상 밝게)
const C = {
  bg: '#ffffff',
  subtle: '#f7f7f8',
  border: '#e8e8eb',
  borderStrong: '#d8d9dd',
  text: '#18181b',
  textSec: '#71717a',
  muted: '#a1a1aa',
  ink: '#18181b',      // primary action / active (brandColor 없을 때 폴백)
  inkFill: '#f4f4f5',  // selected fill
  danger: '#dc2626',
};

// 병원 BI 컬러(core.hospitals.brandColor)를 강조색으로. 없으면 무채색 폴백.
type Accent = { base: string; on: string; tint: string };
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#18181b' : '#ffffff';
}
function buildAccent(hex: string | null | undefined): Accent {
  const base = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : C.ink;
  return { base, on: readableOn(base), tint: base + '1a' }; // tint ≈ 10% 알파
}

type PetField = 'name' | 'species' | 'breed' | 'age' | 'sex' | 'registration' | 'insurance' | 'symptoms';
type Step =
  | { kind: 'intro' }
  | { kind: 'owner_name' }
  | { kind: 'owner_phone' }
  | { kind: 'owner_address' }
  | { kind: 'survey_match' }
  | { kind: 'pet_count' }
  | { kind: 'pet'; petIndex: number; field: PetField }
  | { kind: 'referral_channel' }
  | { kind: 'referral_online' }
  | { kind: 'referral_acq' }
  | { kind: 'referral_other' }
  | { kind: 'consent' };

/** 사전문진에서 받은 정보는 접수증에서 다시 묻지 않는다(form-spec 의 surveyLinked 주석 참고).
 *  매칭으로 채워지지 않는 필드(동물등록·펫보험)만 보호자에게 추가로 묻는다. */
const PET_FIELDS_FULL: PetField[] = ['name', 'species', 'breed', 'age', 'sex', 'registration', 'insurance', 'symptoms'];
const PET_FIELDS_FROM_SURVEY: PetField[] = ['registration', 'insurance'];

function petFieldsFor(pet: PetAnswer | undefined): PetField[] {
  return pet?.surveyLinked ? PET_FIELDS_FROM_SURVEY : PET_FIELDS_FULL;
}

function buildSteps(a: IntakeAnswers, matchesAvailable: boolean): Step[] {
  const steps: Step[] = [
    { kind: 'intro' },
    { kind: 'owner_name' },
    { kind: 'owner_phone' },
    { kind: 'owner_address' },
  ];
  if (matchesAvailable) steps.push({ kind: 'survey_match' });
  steps.push({ kind: 'pet_count' });
  for (let i = 0; i < a.pets.length; i++) {
    petFieldsFor(a.pets[i]).forEach((field) => steps.push({ kind: 'pet', petIndex: i, field }));
  }
  steps.push({ kind: 'referral_channel' });
  if (a.referral.channel === 'online') steps.push({ kind: 'referral_online' });
  else if (a.referral.channel === 'acquaintance') steps.push({ kind: 'referral_acq' });
  else if (a.referral.channel === 'other') steps.push({ kind: 'referral_other' });
  steps.push({ kind: 'consent' });
  return steps;
}

/** 매칭된 사전문진 한 건을 PetAnswer 로 변환(접수증에서 묻지 않을 종/품종/성별/생일 프리필). */
function petFromSurveyMatch(m: SurveyMatch): PetAnswer {
  const sp = speciesFromSurvey(m.species);
  const opts = breedOptionsFor(sp);
  const matchedBreed = opts.find((b) => b === (m.breed ?? '').trim());
  return {
    name: (m.patientName ?? '').trim(),
    species: sp,
    breed: matchedBreed ?? (m.breed ? '기타' : ''),
    breedOther: matchedBreed || !m.breed ? '' : m.breed.trim(),
    birthDate: (m.birthDate ?? '').trim(),
    ageUnknown: m.ageUnknown === true,
    ageText: (m.ageText ?? '').trim(),
    sex: sexFromSurvey(m.sex),
    registration: '',
    insurance: '',
    symptoms: [],
    symptomDetail: '',
    surveyLinked: true,
    surveySessionId: m.id,
  };
}

function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length < 11) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

type DaumPostcodeInstance = { open: () => void; embed: (el: HTMLElement) => void };
type DaumNamespace = { Postcode: new (options: Record<string, unknown>) => DaumPostcodeInstance };

function loadDaumPostcode(): Promise<DaumNamespace> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { daum?: DaumNamespace };
    if (w.daum?.Postcode) return resolve(w.daum);
    const s = document.createElement('script');
    s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    s.onload = () => (w.daum ? resolve(w.daum) : reject(new Error('load fail')));
    s.onerror = () => reject(new Error('load fail'));
    document.head.appendChild(s);
  });
}

export function IntakeWizard({ hospitalId, hospitalName, accent }: { hospitalId: string; hospitalName: string; accent?: string | null }) {
  const ac = useMemo(() => buildAccent(accent), [accent]);
  const [answers, setAnswers] = useState<IntakeAnswers>(() => emptyAnswers());
  const [addrBase, setAddrBase] = useState('');
  const [addrDetail, setAddrDetail] = useState('');
  const [idx, setIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /** 연락처 입력 후 백그라운드로 받아오는 사전문진 매칭. 빈 배열이면 매칭 step 자체를 건너뛴다. */
  const [matches, setMatches] = useState<SurveyMatch[]>([]);
  const [matchLookupPhone, setMatchLookupPhone] = useState<string>(''); // 어떤 번호로 조회했는지(번호 바뀌면 새 조회)
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([]);
  /** "사전문진을 하지 않았어요" 옵션을 명시적으로 선택했는지(시각적 라디오 동작용). */
  const [noneSelected, setNoneSelected] = useState(false);

  const matchesAvailable = matches.length > 0;
  const matchedPetsCount = answers.pets.filter((p) => p.surveyLinked).length;

  const steps = useMemo(() => buildSteps(answers, matchesAvailable), [answers, matchesAvailable]);
  const clampedIdx = Math.min(idx, steps.length - 1);
  const step = steps[clampedIdx];

  function patch(p: Partial<IntakeAnswers>) { setAnswers((a) => ({ ...a, ...p })); }
  function patchPet(i: number, p: Partial<IntakeAnswers['pets'][number]>) {
    setAnswers((a) => ({ ...a, pets: a.pets.map((pet, j) => (j === i ? { ...pet, ...p } : pet)) }));
  }
  function patchReferral(p: Partial<IntakeAnswers['referral']>) {
    setAnswers((a) => ({ ...a, referral: { ...a.referral, ...p } }));
  }
  /** "추가" 마리 수(=매칭으로 자동 추가된 환자 제외)를 받아 pets[] 를 재구성. */
  function setAdditionalPetCount(additional: number) {
    setAnswers((a) => {
      const matchedPets = a.pets.filter((p) => p.surveyLinked);
      const extras: PetAnswer[] = [];
      const existingExtras = a.pets.filter((p) => !p.surveyLinked);
      for (let i = 0; i < additional; i += 1) extras.push(existingExtras[i] ?? emptyPet());
      const pets = [...matchedPets, ...extras];
      return { ...a, petCount: pets.length, pets };
    });
  }
  function setAddress(base: string, detail: string) {
    setAddrBase(base); setAddrDetail(detail);
    patch({ ownerAddress: `${base} ${detail}`.trim() });
  }

  /** 매칭 step 에서 다음으로 넘어갈 때: 선택한 매칭들을 prefilled pets 로 합치고 petCount 도 그만큼 늘린다. */
  function commitSelectedMatches() {
    setAnswers((a) => {
      const additionalPets = a.pets.filter((p) => !p.surveyLinked); // 보호자가 이미 추가로 입력했던 펫 보존
      const matchedPets = selectedMatchIds
        .map((id) => matches.find((m) => m.id === id))
        .filter((m): m is SurveyMatch => Boolean(m))
        .map(petFromSurveyMatch);
      const pets = [...matchedPets, ...additionalPets];
      return { ...a, petCount: pets.length, pets };
    });
  }

  /** owner_phone next() 직후 호출. 같은 번호 재조회 방지, 실패는 조용히 무시(매칭 step 도 안 보임). */
  async function lookupMatchesForCurrentPhone() {
    const digits = answers.ownerPhone.replace(/\D/g, '');
    if (digits.length < 10) return;
    if (matchLookupPhone === digits) return;
    setMatchLookupPhone(digits);
    try {
      const url = `/api/intake/survey-match?hospitalId=${encodeURIComponent(hospitalId)}&contact=${encodeURIComponent(digits)}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = (await res.json()) as { enabled?: boolean; matches?: SurveyMatch[] };
      const list = data.enabled && Array.isArray(data.matches) ? data.matches : [];
      setMatches(list);
      // 새 번호 → 이전 선택·None 옵션은 폐기
      setSelectedMatchIds([]);
      setNoneSelected(false);
    } catch {
      setMatches([]);
      setSelectedMatchIds([]);
      setNoneSelected(false);
    }
  }

  function canProceed(): boolean {
    switch (step.kind) {
      case 'intro': return true;
      case 'owner_name': return answers.ownerName.trim().length > 0;
      case 'owner_phone': return answers.ownerPhone.replace(/\D/g, '').length >= 10;
      case 'owner_address': return addrBase.trim().length > 0;
      // 매칭 step 은 선택 0건도 허용("내 환자 아님") — 단순히 다음으로
      case 'survey_match': return true;
      // 매칭으로 추가된 환자만 있어도 진행 가능. 매칭 없으면 직접 입력해야 진행.
      case 'pet_count': return answers.petCount > 0;
      case 'pet': {
        const pet = answers.pets[step.petIndex];
        if (!pet) return false;
        switch (step.field) {
          case 'name': return pet.name.trim().length > 0;
          case 'species': return !!pet.species;
          case 'breed':
            if (!pet.breed) return false;
            return BREED_FREETEXT_VALUES.includes(pet.breed) ? pet.breedOther.trim().length > 0 : true;
          case 'age': return pet.ageUnknown ? pet.ageText.trim().length > 0 : pet.birthDate.length > 0;
          case 'sex': return !!pet.sex;
          case 'registration': return !!pet.registration;
          case 'insurance': return !!pet.insurance;
          case 'symptoms': return true;
        }
        return false;
      }
      case 'referral_channel': return !!answers.referral.channel;
      case 'referral_online': return answers.referral.onlineMedia.length > 0;
      case 'referral_acq': return answers.referral.acquaintanceDetail.trim().length > 0;
      case 'referral_other': return answers.referral.otherDetail.trim().length > 0;
      case 'consent': return answers.consentRequired;
    }
  }

  function next() {
    if (!canProceed()) return;
    setError(null);
    // owner_phone 통과 시점에 매칭 백그라운드 조회(병원이 토글 OFF 거나 매칭 0건이면 step 자체가 안 생긴다).
    if (step.kind === 'owner_phone') void lookupMatchesForCurrentPhone();
    // 매칭 step 통과 시점에 선택된 매칭들을 pets[] 에 반영.
    if (step.kind === 'survey_match') commitSelectedMatches();
    setIdx((i) => Math.min(i + 1, steps.length - 1));
  }
  function back() { setError(null); setIdx((i) => Math.max(i - 1, 0)); }

  async function submit() {
    if (!answers.consentRequired) return;
    setSubmitting(true); setError(null);
    try {
      // pets[].surveySessionId 를 모아 전체 레벨 linkedSurveySessionIds 로도 동봉(중복 매칭 방지·직원 화면 연결).
      const linkedIds = answers.pets.map((p) => p.surveySessionId).filter((v): v is string => Boolean(v));
      const payload: IntakeAnswers = linkedIds.length > 0 ? { ...answers, linkedSurveySessionIds: linkedIds } : answers;
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospitalId, answers: payload }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '제출에 실패했습니다.');
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '제출에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Screen accent={ac}>
        <div style={{ textAlign: 'center', margin: 'auto', maxWidth: 420 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: ac.base, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: ac.on }}><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 10px', color: C.text }}>{COMPLETE_TITLE}</h1>
          <p style={{ fontSize: 16, color: C.textSec, lineHeight: 1.7, margin: 0 }}>{COMPLETE_BODY}</p>
        </div>
      </Screen>
    );
  }

  // 첫 화면(인사말) — 진행바/카운터 없이 전용 웰컴 레이아웃
  if (step.kind === 'intro') {
    return (
      <Screen accent={ac}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ac)', marginBottom: 14, letterSpacing: '-0.01em' }}>초진 접수</div>
          <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.32, color: C.text, margin: 0 }}>
            {hospitalName}에<br />오신 것을 환영합니다
          </h1>
          <p style={{ fontSize: 18, fontWeight: 500, color: C.textSec, letterSpacing: '-0.01em', lineHeight: 1.6, margin: '20px 0 0' }}>
            진료 접수를 위해<br />다음 접수증을 작성해주세요.
          </p>
        </div>
        <div style={{ flexShrink: 0 }}>
          <button type="button" className="intake-press" onClick={next} style={{ ...btnPrimary(false), width: '100%', padding: '17px', fontSize: 17 }}>
            시작하기
          </button>
          <QrToSelf />
        </div>
      </Screen>
    );
  }

  const progress = steps.length > 1 ? clampedIdx / (steps.length - 1) : 0;
  const isLast = step.kind === 'consent';

  return (
    <Screen accent={ac}>
      <div style={{ height: 3, background: C.border, borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--ac)', transition: 'width .25s' }} />
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 10, flexShrink: 0, letterSpacing: '0.01em' }}>
        {hospitalName} · {clampedIdx + 1} / {steps.length}
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
        onKeyDown={(e) => {
          // 모바일에서 키보드가 '다음' 버튼을 가리는 문제 — 텍스트 입력 후 엔터(이동/확인)로 바로 넘어가게 한다.
          if (e.key !== 'Enter') return;
          const el = e.target as HTMLElement;
          if (el.tagName !== 'INPUT') return;
          const t = (el as HTMLInputElement).type;
          if (t === 'checkbox' || t === 'radio' || t === 'button' || t === 'date') return;
          if (!canProceed()) return;
          e.preventDefault();
          if (isLast) void submit();
          else next();
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: '20px 2px 24px' }}>
          <StepBody
            step={step} hospitalName={hospitalName} answers={answers}
            addrBase={addrBase} addrDetail={addrDetail}
            patch={patch} patchPet={patchPet} patchReferral={patchReferral}
            setAdditionalPetCount={setAdditionalPetCount} setAddress={setAddress}
            matches={matches} selectedMatchIds={selectedMatchIds} setSelectedMatchIds={setSelectedMatchIds}
            noneSelected={noneSelected} setNoneSelected={setNoneSelected}
            matchedPetsCount={matchedPetsCount}
          />

          {error && <p style={{ color: C.danger, fontSize: 14, margin: '14px 0 0' }}>{error}</p>}

          {/* 이전/다음을 입력칸 바로 아래에 — 키보드가 올라와도 입력칸 근처라 함께 보인다. */}
          <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
            {clampedIdx > 0 && <button type="button" className="intake-press" onClick={back} style={btnSecondary}>이전</button>}
            {isLast ? (
              <button type="button" className="intake-press" onClick={() => void submit()} disabled={!canProceed() || submitting} style={btnPrimary(!canProceed() || submitting)}>
                {submitting ? '제출 중…' : '제출하기'}
              </button>
            ) : (
              <button type="button" className="intake-press" onClick={next} disabled={!canProceed()} style={btnPrimary(!canProceed())}>
                다음
              </button>
            )}
          </div>
        </div>
      </div>
    </Screen>
  );
}

function StepBody(props: {
  step: Step; hospitalName: string; answers: IntakeAnswers; addrBase: string; addrDetail: string;
  patch: (p: Partial<IntakeAnswers>) => void;
  patchPet: (i: number, p: Partial<IntakeAnswers['pets'][number]>) => void;
  patchReferral: (p: Partial<IntakeAnswers['referral']>) => void;
  setAdditionalPetCount: (additional: number) => void;
  setAddress: (base: string, detail: string) => void;
  matches: SurveyMatch[];
  selectedMatchIds: string[];
  setSelectedMatchIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  noneSelected: boolean;
  setNoneSelected: (b: boolean) => void;
  matchedPetsCount: number;
}) {
  const { step, hospitalName, answers, addrBase, addrDetail, matches, selectedMatchIds, setSelectedMatchIds, noneSelected, setNoneSelected, matchedPetsCount } = props;

  const Q = ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', color: C.text, margin: '0 0 20px', lineHeight: 1.45 }}>{children}</h2>
  );
  const hint = (t: string) => <span style={{ fontSize: 14, fontWeight: 400, color: C.muted }}> {t}</span>;

  switch (step.kind) {
    case 'intro':
      return null; // 인트로는 IntakeWizard에서 전용 웰컴 화면으로 렌더

    case 'owner_name':
      return (<div><Q>보호자님의 이름을 입력해 주세요</Q>
        <input autoFocus value={answers.ownerName} onChange={(e) => props.patch({ ownerName: e.target.value })} placeholder="성함" style={inputStyle} /></div>);

    case 'owner_phone':
      return (<div><Q>연락처를 입력해 주세요</Q>
        <input autoFocus type="tel" inputMode="numeric" value={answers.ownerPhone}
          onChange={(e) => props.patch({ ownerPhone: formatPhone(e.target.value) })} placeholder="010-0000-0000" style={inputStyle} /></div>);

    case 'owner_address':
      return (<div><Q>주소를 입력해 주세요</Q>
        <AddressField base={addrBase} detail={addrDetail} onChange={props.setAddress} /></div>);

    case 'survey_match': {
      // 매칭 카드 클릭 ↔ None 옵션은 서로 배타(라디오처럼) — 한쪽 선택 시 다른 쪽 해제.
      const toggleMatch = (id: string) => {
        if (noneSelected) setNoneSelected(false);
        setSelectedMatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      };
      const pickNone = () => {
        setSelectedMatchIds([]);
        setNoneSelected(true);
      };
      const checkBox = (active: boolean) => (
        <span style={{
          width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: active ? 'var(--ac)' : '#e4e4e7', color: 'var(--ac-on)', fontSize: 12,
        }}>{active ? '✓' : ''}</span>
      );
      return (
        <div>
          <Q>이미 사전문진을 완료해주셨네요!</Q>
          <p style={{ fontSize: 14, color: C.textSec, margin: '0 0 16px', lineHeight: 1.6 }}>
            아래 사전문진 목록 중 금일 진료에 해당되는 건은 모두 선택해주세요.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {matches.map((m) => {
              const active = selectedMatchIds.includes(m.id);
              const sub: string[] = [];
              if (m.species) sub.push(m.species);
              if (m.breed) sub.push(m.breed);
              if (m.sex) sub.push(m.sex);
              if (m.birthDate) sub.push(`생일 ${m.birthDate}`);
              else if (m.ageUnknown && m.ageText) sub.push(`약 ${m.ageText}세`);
              if (m.scheduledDate) sub.push(`내원예정 ${m.scheduledDate.slice(0, 10)}`);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMatch(m.id)}
                  style={{ ...cardStyle(active), textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  {checkBox(active)}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{m.patientName || '(이름 미입력)'}</span>
                    {sub.length > 0 && (
                      <span style={{ fontSize: 13, color: C.textSec, fontWeight: 400 }}>{sub.join(' · ')}</span>
                    )}
                  </span>
                </button>
              );
            })}
            <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
            <button
              type="button"
              onClick={pickNone}
              style={{ ...cardStyle(noneSelected), textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
            >
              {checkBox(noneSelected)}
              <span style={{ fontWeight: 600 }}>사전문진을 하지 않았어요</span>
            </button>
          </div>
        </div>
      );
    }

    case 'pet_count': {
      // 매칭으로 이미 추가된 환자가 있으면 "추가 마리 수" 만 묻는다(0도 허용).
      const hasMatched = matchedPetsCount > 0;
      const additional = Math.max(0, answers.pets.length - matchedPetsCount);
      const additionalOptions: { value: string; label: string }[] = hasMatched
        ? [{ value: '0', label: '없어요' }, ...PET_COUNT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]
        : PET_COUNT_OPTIONS;
      const question = hasMatched
        ? `사전문진을 작성한 ${matchedPetsCount}마리 외에 추가로 접수할 아이가 더 있나요?`
        : '오늘 접수가 필요한 아이는 총 몇 마리인가요?';
      const currentValue = hasMatched ? String(additional) : String(answers.petCount || '');
      return (
        <div>
          <Q>{question}</Q>
          <CardChoices
            options={additionalOptions}
            value={currentValue}
            onPick={(v) => props.setAdditionalPetCount(Number(v))}
            columns={2}
          />
        </div>
      );
    }

    case 'pet': {
      const i = step.petIndex;
      const pet = answers.pets[i];
      if (!pet) return null;
      const petTag = (
        <div style={{ fontSize: 14, fontWeight: 600, color: C.textSec, marginBottom: 12, letterSpacing: '0.01em' }}>
          {answers.pets.length > 1 ? `${i + 1}번째 아이` : '우리 아이'}{pet.name ? ` · ${pet.name}` : ''}
        </div>
      );
      switch (step.field) {
        case 'name':
          return (<div>{petTag}<Q>아이의 이름은 무엇인가요?</Q>
            <input autoFocus value={pet.name} onChange={(e) => props.patchPet(i, { name: e.target.value })} placeholder="이름" style={inputStyle} /></div>);
        case 'species':
          return (<div>{petTag}<Q>무슨 동물인가요?</Q>
            <CardChoices options={SPECIES_OPTIONS} value={pet.species}
              onPick={(v) => { props.patchPet(i, { species: v as Species, breed: '', breedOther: '' }); }} /></div>);
        case 'breed': {
          const opts = breedOptionsFor(pet.species).map((b) => ({ value: b, label: b }));
          const isFree = BREED_FREETEXT_VALUES.includes(pet.breed);
          return (<div>{petTag}<Q>품종은 무엇인가요?</Q>
            <CardChoices options={opts} value={pet.breed} columns={2} onPick={(v) => props.patchPet(i, { breed: v })} />
            {isFree && <input autoFocus value={pet.breedOther} onChange={(e) => props.patchPet(i, { breedOther: e.target.value })}
              placeholder="품종을 직접 입력해 주세요" style={{ ...inputStyle, marginTop: 12 }} />}</div>);
        }
        case 'age':
          return (<div>{petTag}<Q>아이의 생일 또는 나이가 어떻게 되나요?</Q>
            {!pet.ageUnknown && <input type="date" value={pet.birthDate} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => props.patchPet(i, { birthDate: e.target.value })} style={inputStyle} />}
            <label style={checkRow}>
              <input type="checkbox" checked={pet.ageUnknown}
                onChange={(e) => props.patchPet(i, { ageUnknown: e.target.checked, birthDate: '', ageText: '' })} style={checkbox} />
              생일을 모르겠어요
            </label>
            {pet.ageUnknown && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <input autoFocus inputMode="numeric" value={pet.ageText}
                  onChange={(e) => props.patchPet(i, { ageText: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                  placeholder="대략적인 나이" style={{ ...inputStyle, flex: 1 }} />
                <span style={{ fontSize: 17, color: C.textSec }}>세</span>
              </div>)}
          </div>);
        case 'sex':
          return (<div>{petTag}<Q>아이의 성별은 무엇인가요?</Q>
            <CardChoices options={SEX_OPTIONS} value={pet.sex} columns={2} onPick={(v) => { props.patchPet(i, { sex: v }); }} /></div>);
        case 'registration':
          return (<div>{petTag}<Q>동물등록은 되어 있나요?</Q>
            <CardChoices options={REGISTRATION_OPTIONS} value={pet.registration} onPick={(v) => { props.patchPet(i, { registration: v }); }} /></div>);
        case 'insurance':
          return (<div>{petTag}<Q>아이가 펫보험에 가입되어 있나요?</Q>
            <CardChoices options={INSURANCE_OPTIONS} value={pet.insurance} columns={2} onPick={(v) => { props.patchPet(i, { insurance: v }); }} /></div>);
        case 'symptoms': {
          const toggle = (v: string) => {
            const has = pet.symptoms.includes(v);
            props.patchPet(i, { symptoms: has ? pet.symptoms.filter((s) => s !== v) : [...pet.symptoms, v] });
          };
          return (<div>{petTag}<Q>주된 증상 및 내원 사유를 선택해 주세요{hint('(여러 개 선택 가능)')}</Q>
            <MultiChoices options={SYMPTOM_OPTIONS} values={pet.symptoms} onToggle={toggle} />
            <input value={pet.symptomDetail} onChange={(e) => props.patchPet(i, { symptomDetail: e.target.value })}
              placeholder="상세 증상을 적어주세요 (선택)" style={{ ...inputStyle, marginTop: 12 }} /></div>);
        }
      }
      return null;
    }

    case 'referral_channel':
      return (<div><Q>저희 병원을 알게 된 경로는 어떻게 되시나요?</Q>
        <CardChoices options={REFERRAL_CHANNEL_OPTIONS} value={answers.referral.channel}
          onPick={(v) => { props.patchReferral({ channel: v }); }} columns={2} /></div>);

    case 'referral_online': {
      const toggle = (v: string) => {
        const has = answers.referral.onlineMedia.includes(v);
        props.patchReferral({ onlineMedia: has ? answers.referral.onlineMedia.filter((m) => m !== v) : [...answers.referral.onlineMedia, v] });
      };
      return (<div><Q>어떤 매체를 통해 알게 되셨나요?{hint('(여러 개 선택 가능)')}</Q>
        <MultiChoices options={ONLINE_MEDIA_OPTIONS} values={answers.referral.onlineMedia} onToggle={toggle} /></div>);
    }

    case 'referral_acq':
      return (<div><Q>소개해 주신 분은 누구신가요?</Q>
        <input autoFocus value={answers.referral.acquaintanceDetail} onChange={(e) => props.patchReferral({ acquaintanceDetail: e.target.value })}
          placeholder="예: 지인, 기존 보호자 성함 등" style={inputStyle} /></div>);

    case 'referral_other':
      return (<div><Q>어떻게 알게 되셨나요?</Q>
        <input autoFocus value={answers.referral.otherDetail} onChange={(e) => props.patchReferral({ otherDetail: e.target.value })}
          placeholder="직접 입력해 주세요" style={inputStyle} /></div>);

    case 'consent':
      return (
        <div>
          <Q>개인정보 수집·이용 동의</Q>
          <ConsentBlock text={consentRequiredText(hospitalName)} />
          <label style={consentCheckRow}>
            <input type="checkbox" checked={answers.consentRequired} onChange={(e) => props.patch({ consentRequired: e.target.checked })} style={checkbox} />
            <span>{CONSENT_REQUIRED_LABEL}</span>
          </label>
          <ConsentBlock text={consentMarketingText(hospitalName)} />
          <label style={consentCheckRow}>
            <input type="checkbox" checked={answers.consentMarketing} onChange={(e) => props.patch({ consentMarketing: e.target.checked })} style={checkbox} />
            <span>{CONSENT_MARKETING_LABEL}</span>
          </label>
          {PRIVACY_POLICY_URL && (
            <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: C.text, textDecoration: 'underline' }}>
              개인정보처리방침 전문 보기
            </a>
          )}
        </div>
      );
  }
}

// 주소 입력 — Daum 우편번호를 우리 모달에 임베드
function AddressField({ base, detail, onChange }: { base: string; detail: string; onChange: (base: string, detail: string) => void }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadDaumPostcode()
      .then((daum) => {
        if (cancelled || !boxRef.current) return;
        boxRef.current.innerHTML = '';
        new daum.Postcode({
          width: '100%', height: '100%',
          theme: { searchBgColor: '#ffffff', queryTextColor: '#222222' },
          oncomplete: (data: { roadAddress?: string; address?: string }) => {
            onChange(data.roadAddress || data.address || '', detail);
            setOpen(false);
          },
        }).embed(boxRef.current);
      })
      .catch(() => setOpen(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input value={base} onChange={(e) => onChange(e.target.value, detail)} placeholder="도로명/지번 주소" style={{ ...inputStyle, flex: 1 }} />
        <button type="button" style={btnSecondary} onClick={() => setOpen(true)}>주소 검색</button>
      </div>
      <input value={detail} onChange={(e) => onChange(base, e.target.value)} placeholder="상세 주소 (동/호 등)" style={inputStyle} />

      {open && (
        <div onClick={() => setOpen(false)} style={addrOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={addrPanel}>
            <div style={addrHeader}>
              <span style={{ fontWeight: 600, fontSize: 16, color: C.text }}>주소 검색</span>
              <button type="button" onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: C.muted }}>✕</button>
            </div>
            <div ref={boxRef} style={{ flex: 1, minHeight: 0 }} />
          </div>
        </div>
      )}
    </div>
  );
}

function QrToSelf() {
  const [url, setUrl] = useState('');
  useEffect(() => { setUrl(window.location.href); }, []);
  if (!url) return null;
  return (
    <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', background: C.subtle, borderRadius: 12 }}>
      <QRCodeSVG value={url} size={104} />
      <span style={{ fontSize: 14.5, color: C.textSec, lineHeight: 1.6 }}>
        직접 휴대폰으로 작성하시려면<br />QR 코드를 스캔해 주세요.
      </span>
    </div>
  );
}

// ── 공통 UI ─────────────────────────────────────────────
function Screen({ children, accent }: { children: React.ReactNode; accent: Accent }) {
  return (
    <div style={{
      // 키보드가 올라와도 페이지(body)가 위로 밀리지 않게 뷰포트 높이로 고정. 내부 콘텐츠만 필요 시 스크롤.
      height: '100dvh', overflow: 'hidden', background: C.bg, color: C.text, display: 'flex', justifyContent: 'center',
      fontFamily: '"Pretendard", "Pretendard Variable", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      ['--ac' as string]: accent.base, ['--ac-on' as string]: accent.on, ['--ac-tint' as string]: accent.tint,
    } as CSSProperties}>
      <style>{`.intake-press{transition:transform .12s ease,opacity .12s ease}.intake-press:not(:disabled):active{transform:scale(.975)}.intake-press:disabled{opacity:1}`}</style>
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', padding: '22px 20px 24px' }}>
        {children}
      </div>
    </div>
  );
}

function CardChoices({ options, value, onPick, columns = 1 }: { options: { value: string; label: string }[]; value: string; onPick: (v: string) => void; columns?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 7 }}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onPick(o.value)} style={cardStyle(value === o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function MultiChoices({ options, values, onToggle }: { options: { value: string; label: string }[]; values: string[]; onToggle: (v: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button key={o.value} type="button" onClick={() => onToggle(o.value)} style={{ ...cardStyle(active), textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: active ? 'var(--ac)' : '#e4e4e7', color: 'var(--ac-on)', fontSize: 12,
            }}>{active ? '✓' : ''}</span>
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ConsentBlock({ text }: { text: string }) {
  return (
    <div style={{ background: C.subtle, borderRadius: 10, padding: '13px 15px', fontSize: 13.5, color: C.textSec, lineHeight: 1.7, whiteSpace: 'pre-line', maxHeight: 180, overflowY: 'auto', marginBottom: 12 }}>{text}</div>
  );
}

// ── 스타일 ──────────────────────────────────────────────
const inputStyle: CSSProperties = {
  width: '100%', padding: '12px 2px', fontSize: 17, color: C.text, background: 'transparent',
  border: 'none', borderBottom: `1.5px solid ${C.border}`, borderRadius: 0, outline: 'none',
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
const checkbox: CSSProperties = { width: 18, height: 18, accentColor: 'var(--ac)', flexShrink: 0 };
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, fontSize: 15, color: C.textSec, cursor: 'pointer' };
const consentCheckRow: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, margin: '0 0 18px', fontSize: 15, color: C.text, lineHeight: 1.5, cursor: 'pointer' };
const addrOverlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const addrPanel: CSSProperties = { width: 'min(96vw, 420px)', height: 'min(82vh, 560px)', background: C.bg, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' };
const addrHeader: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 };
