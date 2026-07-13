/**
 * 루브릭 단일 소스 — 10항목(의학5 + SEO5) + 심각도 정의 + 결정적 목표값 + 의도된 예외 + few-shot.
 * 이 정의를 리뷰어 프롬프트(코드 렌더)·결정적 지표 계산·admin 결과화면·"평가 기준 보기"가 함께 소비한다.
 * → 유저가 보는 기준 = 실제 채점 기준. 설계: docs/blog-review-spec.md
 */
import type { Axis, MetricStatus } from './types';

/** 루브릭 항목 1개. */
export interface RubricItem {
  id: string;
  axis: Axis;
  /** 화면·프롬프트 공통 라벨. */
  label: string;
  /** 화면(평가 기준 보기)용 짧은 설명. */
  shortDesc: string;
  /** 리뷰어 프롬프트에 렌더되는 판정 지시문. */
  promptLine: string;
  /** LLM(리뷰어)이 판정하는 항목인지. false면 코드가 결정적으로 계산(프롬프트에서 제외). */
  llmReviewed: boolean;
  /** 결정적 지표를 함께 쓰는 항목인지(화면에서 지표 스트립과 연결). */
  hasDeterministic: boolean;
}

/** 축 1 — 의학적 정확성(게이트 축). 전부 LLM 판정. */
export const MEDICAL_ITEMS: RubricItem[] = [
  {
    id: 'M1',
    axis: 'medical',
    label: '사실 정합성',
    shortDesc: '원본 대조(수치·진단·약물·시술·날짜) + 환각/창작 금지',
    promptLine:
      '(내부) 수치·진단·약물·시술·날짜가 GROUND_TRUTH 와 다르거나, 원본에 없는 구체 사실(수치·소견)을 창작. 대부분 high.',
    llmReviewed: true,
    hasDeterministic: false,
  },
  {
    id: 'M2',
    axis: 'medical',
    label: '의학적 정확성',
    shortDesc: '기전·정상범위·약리·순서 오류',
    promptLine: '질병 기전·정상범위·약리·검사 순서 등 수의학 지식상 틀린 서술. medium.',
    llmReviewed: true,
    hasDeterministic: false,
  },
  {
    id: 'M3',
    axis: 'medical',
    label: '안전성',
    shortDesc: '자가처치 유도·독성/약물 오정보·응급 경시',
    promptLine:
      '보호자가 따라하면 위험한 자가처치 유도, 독성·약물 오정보(예: 고양이 아세트아미노펜), 응급 상황 경시. 심각도는 정의대로(원본 사실과 모순=high, 일반 상식 위반=medium).',
    llmReviewed: true,
    hasDeterministic: false,
  },
  {
    id: 'M4',
    axis: 'medical',
    label: '과장·오해 소지',
    shortDesc: '완치보장·부작용 없음·부당한 일반화·마취위험 은폐',
    promptLine:
      '완치 보장·부작용 없음·100% 안전 등 과장, 효과 과장, 마취 위험 은폐, 한 케이스를 보편 사실로 단정하는 부당한 일반화. low.',
    llmReviewed: true,
    hasDeterministic: false,
  },
  {
    id: 'M5',
    axis: 'medical',
    label: '용어·맥락',
    shortDesc: '비표준/오역 용어·필수 고지 누락',
    promptLine:
      '비표준/오역 의학용어, 필수 맥락 누락(개체차·"정확한 진단은 진료 필요" 같은 상담 권고 부재). low.',
    llmReviewed: true,
    hasDeterministic: false,
  },
];

/** 축 2 — 네이버 최적화(권고 축). S3는 코드 결정적 계산이라 프롬프트 제외. */
export const SEO_ITEMS: RubricItem[] = [
  {
    id: 'S1',
    axis: 'seo',
    label: '제목',
    shortDesc: '대표키워드·지역키워드·길이·낚시/떡칠',
    promptLine:
      '대표키워드·지역키워드가 자연스럽게 들어갔는지, 낚시성·키워드 떡칠은 없는지. (길이·포함 여부 수치는 시스템이 계산하니 세지 말 것)',
    llmReviewed: true,
    hasDeterministic: true,
  },
  {
    id: 'S2',
    axis: 'seo',
    label: '키워드',
    shortDesc: '본문 대표키워드 밀도 + 연관/롱테일 커버',
    promptLine:
      '대표키워드가 본문에 자연스럽게 녹았는지(부자연스러운 반복=어뷰징), 연관·롱테일 키워드(증상·품종군·치료법 등) 커버 여부. (밀도 수치는 시스템 계산)',
    llmReviewed: true,
    hasDeterministic: true,
  },
  {
    id: 'S3',
    axis: 'seo',
    label: '형식 요건',
    shortDesc: '분량·이미지 수·태그 수',
    promptLine: '', // 코드가 결정적으로 계산(리뷰어 프롬프트에는 넣지 않음)
    llmReviewed: false,
    hasDeterministic: true,
  },
  {
    id: 'S4',
    axis: 'seo',
    label: '구성·가독성',
    shortDesc: '도입부 검색의도·섹션 구분·문단 길이·마무리 CTA',
    promptLine:
      '도입부가 검색의도(무엇을 다루는 글인지)를 충족하는지, 문단이 지나치게 길어 모바일에서 읽기 힘든지, 마무리에 병원 안내(CTA)가 있는지.',
    llmReviewed: true,
    hasDeterministic: true,
  },
  {
    id: 'S5',
    axis: 'seo',
    label: '독창성·품질',
    shortDesc: '실제 경험 vs 일반론·유사문서/어뷰징 위험',
    promptLine:
      '실제 진료 경험(1차 정보)이 드러나는지 vs 일반론 나열인지, 다른 글과 유사한 복붙 톤·과도한 병원명 반복 같은 어뷰징 위험.',
    llmReviewed: true,
    hasDeterministic: true,
  },
];

/** 전체 10항목. */
export const RUBRIC: RubricItem[] = [...MEDICAL_ITEMS, ...SEO_ITEMS];

/** id로 항목 조회. */
export function rubricItem(id: string): RubricItem | undefined {
  return RUBRIC.find((r) => r.id === id);
}

/** 심각도 3단계 정의(화면·프롬프트 공통 문구). */
export const SEVERITY_DEFS: Record<'high' | 'medium' | 'low', string> = {
  high: '실제 있는 사실과 틀림 (내부: 원본 차트와 모순).',
  medium: '사실은 맞지만 의학적으로 잘못·순서 뒤바뀜·일반 의학 상식에 안 맞음.',
  low: '틀린 건 아닌데 오해·과장·불명확.',
};

/**
 * 글 작성 시 규칙상 "의도적으로" 제외·변형하는 것 → 지적하더라도 최대 low(참고).
 * 검수가 이를 모르면 정상 문장을 오탐하므로 리뷰어 프롬프트에 주입한다. (출처: SYS_BLOGPOST)
 */
export const INTENTIONAL_EXCEPTIONS: string[] = [
  '품종명(견종·묘종) 생략 → 소형견/단두종 등 일반 분류로만 표현한 것.',
  '정확한 날짜·요일 대신 상대 시점("며칠 뒤")으로 쓴 것.',
  '약 용량·용법·제품명·브랜드명(사료·영양제·기기·검사키트 포함)을 생략한 것.',
  '증상 호전의 자연스러운 서술 — 차트에 기록이 없어도 허용된 표현이라 창작(M1)이 아님.',
  '주제와 무관한 정상 혈액지표를 다 나열하지 않고 선별한 것 → "검사 누락"으로 오판하지 말 것.',
];

/** 검수 범위 밖(지적하지 않음). */
export const OUT_OF_SCOPE: string[] =
  ['개인정보·식별 노출(환자 실명·품종·정확한 날짜) — 내부는 의도된 것, 외부는 우리 기준을 강요하지 않음.'];

/** few-shot 대비 예시(SYS_BLOGPOST 강조점 기반). 리뷰어 프롬프트 하단에 삽입. */
export const FEWSHOT_FLAG: string[] = [
  '"ALT는 520 U/L (정상 18–214)로 정상이었습니다" → M1/high: 520은 정상범위를 크게 초과하는데 \'정상\'이라 서술(수치-해석 모순).',
  '"간 수치(빌리루빈, AST)와 췌장 수치(cPL)는 154.7 U/L로 상승했습니다" → M1/high: 154.7은 cPL 한 값인데 값 없는 빌리루빈·AST에 잘못 공유.',
  '"이 수술로 재발 걱정 없이 100% 완치됩니다" → M4/low: 치료 결과 보장·과장.',
  '제목 "OO동물병원 슬개골 케이스" → S1/medium: 보호자가 검색할 주요 증상·대표키워드가 제목에 없음.',
];
export const FEWSHOT_NOFLAG: string[] = [
  '"수술 약 1주일 뒤 다리를 저는 모습이 사라졌습니다"(원본에 호전 기록 없음) → findings 없음: 증상 호전의 자연스러운 서술은 허용된 표현.',
  '"어느 날 증상을 발견해 며칠 뒤 내원한 소형견" → findings 없음: 정확한 날짜·품종명 생략은 규칙상 의도된 것.',
];

/** 결정적 지표 스펙 1개. */
export interface MetricSpec {
  key: string;
  label: string;
  /** 사람이 읽는 목표. */
  target: string;
  /** 값 → 상태. */
  classify: (value: number) => MetricStatus;
  /** 치명 지표(하나만 poor여도 SEO 신호등 크게 하락)인지 + 조건. */
  isCriticalHit?: (value: number) => boolean;
}

/**
 * 결정적 목표값(docs/blog-review-spec.md 표와 일치).
 * keywordDensity 는 % 값(핵심 keyword 가 본문에서 차지하는 비율).
 */
export const METRIC_SPECS: MetricSpec[] = [
  {
    key: 'charCount',
    label: '분량',
    target: '1200+ (권장 1500+)',
    classify: (v) => (v < 700 ? 'poor' : v < 1200 ? 'warn' : 'good'),
    isCriticalHit: (v) => v < 700,
  },
  {
    key: 'imageCount',
    label: '이미지',
    target: '3+',
    classify: (v) => (v <= 0 ? 'poor' : v <= 2 ? 'warn' : 'good'),
    isCriticalHit: (v) => v <= 0,
  },
  {
    key: 'titleLength',
    label: '제목 길이',
    target: '15–40자',
    classify: (v) => (v < 12 || v > 45 ? 'poor' : v < 15 || v > 40 ? 'warn' : 'good'),
  },
  {
    key: 'headingCount',
    label: '섹션 구분',
    target: '3+',
    classify: (v) => (v <= 0 ? 'poor' : v <= 2 ? 'warn' : 'good'),
  },
  {
    key: 'tagCount',
    label: '태그',
    target: '8–15',
    classify: (v) => (v < 3 || v > 30 ? 'poor' : v < 8 || v > 15 ? 'warn' : 'good'),
  },
  {
    key: 'keywordDensity',
    label: '대표키워드 밀도',
    target: '0.5–2%',
    // 0% 또는 2% 초과(어뷰징) = poor, 0.1–0.5% = warn, 0.5–2% = good.
    classify: (v) => (v <= 0 || v > 2 ? 'poor' : v < 0.5 ? 'warn' : 'good'),
  },
];

export function metricSpec(key: string): MetricSpec | undefined {
  return METRIC_SPECS.find((m) => m.key === key);
}
