// 초진환자 접수증 — 질문 정의 (단일 소스)
// docs/intake-form-questions.md 스펙을 코드로 인코딩. 위저드 UI/제출 API가 이 정의를 공유한다.

import { DOG_BREEDS, CAT_BREEDS } from '@dashboard/breeds';

export type Species = 'dog' | 'cat' | 'other';

export type Option = { value: string; label: string };

// ── 선택지 ─────────────────────────────────────────────
export const PET_COUNT_OPTIONS: Option[] = [
  { value: '1', label: '한 마리' },
  { value: '2', label: '두 마리' },
  { value: '3', label: '세 마리' },
  { value: '4', label: '네 마리' },
  { value: '5', label: '다섯 마리' },
];

export const SPECIES_OPTIONS: Option[] = [
  { value: 'dog', label: '강아지' },
  { value: 'cat', label: '고양이' },
  { value: 'other', label: '그 외' },
];

// 품종 목록 — @dashboard/breeds 단일 소스에서 재노출(사전문진과 동기화).
// 마지막 '그 외' 선택 시 자유입력은 BREED_FREETEXT_VALUES('그 외' 포함)가 처리한다.
export { DOG_BREEDS, CAT_BREEDS };

export const OTHER_ANIMALS: string[] = [
  '토끼', '햄스터', '기니피그', '페럿', '고슴도치', '앵무새', '거북이', '도마뱀', '그 외',
];

export function breedOptionsFor(species: Species | ''): string[] {
  if (species === 'dog') return DOG_BREEDS;
  if (species === 'cat') return CAT_BREEDS;
  if (species === 'other') return OTHER_ANIMALS;
  return [];
}

// "기타"/"그 외" 처럼 직접입력으로 빠지는 선택지
export const BREED_FREETEXT_VALUES = ['기타', '그 외'];

export const SEX_OPTIONS: Option[] = [
  { value: 'male_neutered', label: '남아 (중성화)' },
  { value: 'female_neutered', label: '여아 (중성화)' },
  { value: 'male_intact', label: '남아 (중성화 X)' },
  { value: 'female_intact', label: '여아 (중성화 X)' },
];

export const REGISTRATION_OPTIONS: Option[] = [
  { value: 'internal', label: '내장형으로 등록했어요' },
  { value: 'external', label: '외장형으로 등록했어요' },
  { value: 'none', label: '등록하지 않았어요' },
];

export const INSURANCE_OPTIONS: Option[] = [
  { value: 'yes', label: '예' },
  { value: 'no', label: '아니오' },
];

// 주된 증상 / 내원 사유 (복수 선택, 아이마다)
export const SYMPTOM_OPTIONS: Option[] = [
  { value: 'skin', label: '피부가 이상해요 (멍 자국, 피부색 변화, 발진, 가려움증, 멍울 등)' },
  { value: 'eye', label: '눈이 아픈 것 같아요 (충혈, 눈꼽, 눈물 등)' },
  { value: 'ear', label: '귀가 아픈 것 같아요 (귀 가려움, 귀 통증, 잘 안 들림 등)' },
  { value: 'nose', label: '코가 아픈 것 같아요 (코피, 콧물, 재채기 등)' },
  { value: 'oral', label: '구강 상태가 이상해요 (이빨 흔들림, 잇몸 출혈, 충치, 입냄새 등)' },
  { value: 'breathing', label: '숨소리가 이상해요 (잦은 기침, 헐떡임, 호흡곤란, 숨소리 변화 등)' },
  { value: 'leg', label: '다리가 이상해요 (절뚝거림, 비정상적인 걸음 등)' },
  { value: 'behavior', label: '행동이 이상해요 (기력 저하, 반복 행동, 균형 감각 저하 등)' },
  { value: 'eating', label: '음식 섭취에 문제가 있어요 (식욕 저하/과다, 물 섭취 이상, 침 분비 과다 등)' },
  { value: 'genital', label: '생식기가 아픈 것 같아요 (생식기 고름 등)' },
  { value: 'urine', label: '소변에 문제가 있어요 (잦은 소변 실수, 소변 양/색 변화 등)' },
  { value: 'digestion', label: '소화에 문제가 있어요 (설사, 변비, 구토, 체중 감소 등)' },
  { value: 'checkup', label: '건강검진 하려고 왔어요' },
  { value: 'vaccine', label: '예방접종 하려고 왔어요' },
  { value: 'registration', label: '동물등록 하려고 왔어요' },
  { value: 'parasite', label: '기생충 약 구매하려고 왔어요 (심장사상충, 진드기 등)' },
  { value: 'other', label: '기타' },
];

// 알게 된 경로
export const REFERRAL_CHANNEL_OPTIONS: Option[] = [
  { value: 'online', label: '온라인 매체' },
  { value: 'outdoor', label: '옥외 간판' },
  { value: 'acquaintance', label: '지인 소개' },
  { value: 'other', label: '기타' },
];

export const ONLINE_MEDIA_OPTIONS: Option[] = [
  { value: 'naver', label: '네이버' },
  { value: 'google', label: '구글' },
  { value: 'daum', label: '다음 (카카오)' },
  { value: 'instagram', label: '인스타그램' },
  { value: 'danggeun', label: '당근마켓' },
];

// ── 답변 타입 ──────────────────────────────────────────
export type PetAnswer = {
  name: string;
  species: Species | '';
  breed: string;          // 선택지 값(라벨) 또는 빈값
  breedOther: string;     // 품종이 기타/그 외일 때 직접입력
  birthDate: string;      // YYYY-MM-DD ('' 이면 미입력)
  ageUnknown: boolean;    // "생일을 모르겠어요"
  ageText: string;        // 모를 때 대략 나이(숫자) → 표시 시 "n세"
  sex: string;
  registration: string;
  insurance: string;
  symptoms: string[];     // 복수
  symptomDetail: string;  // 선택한 증상 상세 설명(선택). '기타' 증상 설명도 여기로.
  surveyLinked?: boolean;   // 사전문진에서 프리필됨 (증상은 사전문진에서 상세 수집 → 접수증선 생략)
  surveySessionId?: string; // 연결된 사전문진 세션 id
};

export type ReferralAnswer = {
  channel: string;            // online / outdoor / acquaintance / other
  onlineMedia: string[];      // channel=online 일 때
  acquaintanceDetail: string; // channel=acquaintance 일 때
  otherDetail: string;        // channel=other 일 때
};

export type IntakeAnswers = {
  ownerName: string;
  ownerPhone: string;
  ownerAddress: string;
  petCount: number;
  pets: PetAnswer[];
  referral: ReferralAnswer;
  consentRequired: boolean;
  consentMarketing: boolean;
  linkedSurveySessionIds?: string[]; // 이번 접수에 연결된 사전문진 세션 id (중복 매칭 방지용)
};

export function emptyPet(): PetAnswer {
  return {
    name: '', species: '', breed: '', breedOther: '',
    birthDate: '', ageUnknown: false, ageText: '',
    sex: '', registration: '', insurance: '',
    symptoms: [], symptomDetail: '',
  };
}

export function emptyAnswers(): IntakeAnswers {
  return {
    ownerName: '', ownerPhone: '', ownerAddress: '',
    petCount: 0, pets: [],
    referral: { channel: '', onlineMedia: [], acquaintanceDetail: '', otherDetail: '' },
    consentRequired: false, consentMarketing: false,
  };
}

// ── 라벨 조회(직원 열람·요약용) ──────────────────────────
export function labelOf(options: Option[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

// ── 사전문진 답변 → 초진 접수 값 매핑 ────────────────────
export function speciesFromSurvey(v: string): Species | '' {
  if (!v) return '';
  if (v.includes('강아지') || v.includes('개')) return 'dog';
  if (v.includes('고양이') || v.includes('묘')) return 'cat';
  return 'other';
}
export function sexFromSurvey(v: string): string {
  if (!v) return '';
  const neutered = v.includes('중성화');
  if (v.includes('수') || v.includes('남')) return neutered ? 'male_neutered' : 'male_intact';
  if (v.includes('암') || v.includes('여')) return neutered ? 'female_neutered' : 'female_intact';
  return '';
}

// ── 안내 문구 ──────────────────────────────────────────
export function introText(hospitalName: string): string {
  return `${hospitalName}을(를) 방문해 주셔서 감사합니다.\n저희 병원을 처음 방문하시는 반려동물의 보호자분께서는 접수증을 작성해 주시기 바랍니다.`;
}

export const COMPLETE_TITLE = '접수 완료되었습니다';
export const COMPLETE_BODY = '잠시 대기해 주시면 병원 담당자가 안내해 드리겠습니다.';

// 개인정보처리방침 URL — 추후 제공받아 채움
export const PRIVACY_POLICY_URL = '';
const PROCESSOR = '주식회사 바른반려연구소';

export function consentRequiredText(hospitalName: string): string {
  return [
    `진료 예약 등 서비스 제공을 위한 개인정보 수집 및 이용 동의서`,
    `${hospitalName}의 개인정보 수집 및 이용 목적은 다음과 같습니다. 내용을 자세히 읽어보신 후 동의 여부를 결정해 주시기 바랍니다.`,
    `■ 수집·이용 목적: 진단, 치료 및 입원, 진료 및 검사 예약, 예약 조회 및 일정 고지, 원무 서비스, 제품 및 서비스 개선을 위한 연구·분석·개발 활동`,
    `■ 보유·이용 기간: 서비스 제공 종료 혹은 동의 철회 시까지`,
    `■ 처리 위탁 — 수탁업체: ${PROCESSOR} / 업무: 제품 및 서비스 개선을 위한 연구·분석·개발 활동`,
    `※ 동의를 거부할 권리가 있으며, 거부 시 진료 예약 등 서비스 제공이 불가합니다.`,
  ].join('\n');
}

export function consentMarketingText(hospitalName: string): string {
  return [
    `이벤트 안내 등 마케팅 메시지 발송을 위한 개인정보 수집 및 이용 동의`,
    `${hospitalName}의 개인정보 수집 및 이용 목적은 다음과 같습니다.`,
    `■ 수집·이용 목적: 이벤트 안내 등 마케팅 메시지 발송`,
    `■ 필수 항목: 휴대전화번호`,
    `■ 보유·이용 기간: 동의 철회 시까지`,
    `■ 처리 위탁 — 수탁업체: ${PROCESSOR} / 업무: 이벤트 안내 등 마케팅 메시지 발송`,
    `※ 동의를 거부할 권리가 있으며, 거부 시 마케팅 메시지 수신이 불가합니다.`,
  ].join('\n');
}

export const CONSENT_REQUIRED_LABEL = '(필수) 진료 예약 등 서비스 제공을 위한 개인정보 수집 및 이용에 동의합니다.';
export const CONSENT_MARKETING_LABEL = '(선택) 이벤트 안내 등 마케팅 메시지 발송을 위한 개인정보 수집 및 이용에 동의합니다.';
