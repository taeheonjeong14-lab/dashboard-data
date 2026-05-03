export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'phone'
  | 'single_choice'
  | 'multi_choice'
  | 'scale'
  | 'conditional_select'
  | 'pet_birthday';

export type QuestionDef = {
  text: string;
  type: QuestionType;
  choices?: string[];
  maxSelections?: number;
  inlineWithPrev?: boolean;
  choiceLayout?: 'auto' | 'two_col' | 'one_col';
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  conditionalOn?: number;
  conditionalValue?: string;
  conditionalAnswered?: boolean;
  conditionalChoices?: Record<string, string[] | null>;
};

/** QuestionDef → DB SurveyQuestionInstance.options (Json) */
export function buildOptionsJson(q: QuestionDef): unknown {
  const cond: Record<string, unknown> = {};
  if (q.conditionalOn !== undefined) cond.conditionalOn = q.conditionalOn;
  if (q.conditionalValue !== undefined) cond.conditionalValue = q.conditionalValue;
  if (q.conditionalAnswered === true) cond.conditionalAnswered = true;
  if (q.inlineWithPrev === true) cond.inlineWithPrev = true;
  if (q.choiceLayout && q.choiceLayout !== 'auto') cond.choiceLayout = q.choiceLayout;
  const hasCond = Object.keys(cond).length > 0;

  switch (q.type) {
    case 'single_choice':
    case 'multi_choice':
      // Keep legacy shape (array) when possible; otherwise use object form.
      if (!hasCond && q.maxSelections === undefined) return (q.choices ?? null);
      return {
        ...cond,
        ...(q.maxSelections !== undefined ? { maxSelections: q.maxSelections } : {}),
        choices: q.choices ?? [],
      };
    case 'scale':
      return { ...cond, min: q.scaleMin ?? 0, max: q.scaleMax ?? 10, minLabel: q.scaleMinLabel ?? '', maxLabel: q.scaleMaxLabel ?? '' };
    case 'conditional_select':
      return { conditionalOn: q.conditionalOn, choices: q.conditionalChoices };
    case 'phone':
    case 'short_text':
    case 'long_text':
      return hasCond ? cond : null;
    case 'pet_birthday':
      return { kind: 'pet_birthday' };
    default:
      return hasCond ? cond : null;
  }
}

// ─── 초진(사전 문진표) 질문 정의 ───────────────────────────

type DraftCondition =
  | { onKey: string; answered: true }
  | { onKey: string; value: string }
  | { onKey: string; anyOf: string[] };

type DraftQuestion = Omit<QuestionDef, 'conditionalOn'> & {
  key: string;
  condition?: DraftCondition;
};

function compileDraftQuestions(drafts: DraftQuestion[]): QuestionDef[] {
  const orderByKey = new Map<string, number>();
  for (let i = 0; i < drafts.length; i++) orderByKey.set(drafts[i].key, i + 1);

  return drafts.map((d) => {
    if (!d.condition) return { ...d };
    const onOrder = orderByKey.get(d.condition.onKey);
    if (!onOrder) return { ...d }; // best effort

    if ('answered' in d.condition) {
      // conditional_select is special: it needs conditionalOn(number) to choose the right bucket.
      if (d.type === 'conditional_select') return { ...d, conditionalOn: onOrder };
      return { ...d, conditionalOn: onOrder, conditionalAnswered: true };
    }
    if ('value' in d.condition) {
      return { ...d, conditionalOn: onOrder, conditionalValue: d.condition.value };
    }
    return { ...d, conditionalOn: onOrder, conditionalValue: d.condition.anyOf.join('||') };
  });
}

// Q9 내원 이유 (보기 텍스트가 분기 키이기도 함)
export const FIRST_VISIT_REASONS = [
  '피부/귀 이상',
  '구토/설사/혈변',
  '식욕 및 체중 변화',
  '복통/복부 팽만',
  '변비',
  '기침/콧물/재채기',
  '호흡곤란/숨소리 변화',
  '눈 이상',
  '구강 문제/스케일링',
  '파행/절뚝거림/관절통증의심',
  '기력저하/활동성감소',
  '소변 이상(혈뇨, 배뇨곤란)',
  '생식기 분비물',
  '물 섭취 증가',
  '외상',
  '이물/독성 물질 섭취 의심',
  '발작/경련',
  '건강검진',
  '예방접종/상상충예방',
  '행동문제(공격석, 분리불안 등)',
  '동물등록/출국문의',
  '그 외',
] as const;

// Q10~Q12는 "증상 문진" 성격의 후속 문항이므로
// 건강검진/예방접종(정기 방문) 사유에는 노출하지 않는다.
const SYMPTOM_FOLLOWUP_REASONS = FIRST_VISIT_REASONS.filter(
  (reason) => reason !== '건강검진' && reason !== '예방접종/상상충예방'
);

// 품종 보기
const DOG_BREEDS = [
  '말티즈', '푸들', '말티푸', '포메라니안', '치와와', '요크셔테리어', '시츄', '비숑프리제', '페키니즈', '파피용',
  '미니어처 핀셔', '슈나우저', '닥스훈트', '퍼그', '코카 스파니엘', '비글', '웰시 코기', '프렌치 불독', '불독', '보더 콜리',
  '셰틀랜드 쉽독', '시바 이누', '진돗개', '골든 리트리버', '래브라도 리트리버', '저먼 셰퍼드', '로트와일러', '도베르만',
  '시베리안 허스키', '사모예드', '믹스견', '그 외',
];
const CAT_BREEDS = [
  '코리안 숏헤어', '믹스묘', '브리티시 숏헤어', '스코티시 폴드', '러시안 블루', '페르시안', '히말라얀', '벵갈', '아비시니안',
  '샴', '버만', '랙돌', '노르웨이 숲', '메인쿤', '터키시 앙고라', '스핑크스', '데본 렉스', '코니시 렉스', '그 외',
];

/** 초진 사전 문진표(고정) 질문: Q1~ + 분기 문항 */
export const FIRST_VISIT_FIXED_QUESTIONS: QuestionDef[] = compileDraftQuestions([
  // ── 공통: Q1~Q19 ────────────────────────────────────────
  { key: 'Q1', text: '보호자 성명', type: 'short_text' },
  { key: 'Q2', text: '보호자 연락처', type: 'phone' },
  { key: 'Q3', text: '반려동물 이름', type: 'short_text' },
  { key: 'Q4', text: '반려동물 종류', type: 'single_choice', choices: ['강아지', '고양이', '그 외'] },
  { key: 'Q5', text: '품종', type: 'conditional_select', conditionalChoices: { '강아지': DOG_BREEDS, '고양이': CAT_BREEDS, '그 외': null }, condition: { onKey: 'Q4', answered: true } },
  { key: 'Q6', text: '성별', type: 'single_choice', choices: ['암컷(중성화)', '수컷(중성화)', '암컷', '수컷'] },
  { key: 'Q125', text: '반려동물의 생일은 언제인가요?', type: 'pet_birthday' },
  { key: 'Q7', text: '출산이력이 있나요?', type: 'single_choice', choices: ['예', '아니오'], condition: { onKey: 'Q6', value: '암컷' } },
  { key: 'Q8', text: '마지막 생리는 언제인가요?', type: 'single_choice', choices: ['1개월 이내', '3개월 이내', '6개월 이내', '6개월 이상', '잘 모르겠음'], condition: { onKey: 'Q7', answered: true } },
  { key: 'Q9', text: '오늘 병원에 오신 이유는 무엇인가요?', type: 'multi_choice', maxSelections: 3, choiceLayout: 'two_col', choices: [...FIRST_VISIT_REASONS] as unknown as string[] },

  // Q10/Q11: 선택된 각 이유별로 반복(“XXX” 치환) — 이유별 1세트씩 생성
  ...SYMPTOM_FOLLOWUP_REASONS.map((reason, idx) => ([
    { key: `Q10_${idx + 1}`, text: `"${reason}" 증상이 언제부터 시작되었나요 혹은 언제 최초 발생하였나요?`, type: 'single_choice', choices: ['오늘', '1주일 이내', '1개월 이내', '1개월 이상', '정확히 모르겠음'], condition: { onKey: 'Q9', value: reason } as DraftCondition },
    { key: `Q11_${idx + 1}`, text: `"${reason}" 증상이 점점 심해지고 있나요?`, type: 'single_choice', choices: ['점점 심해지는 중', '비슷하게 유지', '조금 나아짐', '잘 모르겠음'], condition: { onKey: 'Q9', value: reason } as DraftCondition },
  ] as DraftQuestion[])).flat(),

  {
    key: 'Q12',
    text: '최근 환경 변화가 있었나요?',
    type: 'multi_choice',
    choices: ['사료 변경', '간식 변경', '이사 또는 환경 변화', '새로운 동물과 접촉', '특별한 변화 없음'],
    condition: { onKey: 'Q9', anyOf: [...SYMPTOM_FOLLOWUP_REASONS] },
  },
  { key: 'Q13', text: '알레르기가 있나요?', type: 'single_choice', choices: ['있음', '없음', '잘 모르겠음'] },

  // Q14: 2-step
  { key: 'Q14_gate', text: '중성화수술 외 수술이력이나 만성질환 진단 이력이 있나요?', type: 'single_choice', choices: ['없음', '있음'] },
  { key: 'Q14_detail', text: '수술/만성질환 이력을 모두 선택해주세요.', type: 'multi_choice', choices: [
    '관절수술(슬개골탈구 등)', '결석', '종양', '안과수술',
    '심장병', '만성신부전', '갑상선질환', '쿠싱 증후군', '당뇨병', '아토피',
    '그 외',
  ], inlineWithPrev: true, condition: { onKey: 'Q14_gate', value: '있음' } },

  // Q15: 2-step
  { key: 'Q15_gate', text: '현재 복용 중인 약이 있나요?', type: 'single_choice', choices: ['없음', '있음'] },
  { key: 'Q15_detail', text: '복용 중인 약이 있다면 적어주세요.', type: 'long_text', inlineWithPrev: true, condition: { onKey: 'Q15_gate', value: '있음' } },

  { key: 'Q16', text: '최근 2년 내에 진행한 예방 접종을 모두 선택해주세요', type: 'multi_choice', choices: ['접종 안함', '종합 백신', '광견병', '코로나', '기관지염', '인플루엔자', '고양이백혈병', '항체검사', '그 외'] },
  { key: 'Q17', text: '최근 3개월 이내 기생충 예방을 한 경우 모두 선택해주세요', type: 'multi_choice', choices: ['예방 안함', '심장사상충', '진드기', '내부기생충'] },
  { key: 'Q18', text: '거주환경이나 산책, 유치원 방문 등의 외부활동의 빈도가 어느정도인가요?', type: 'single_choice', choices: ['매일 외출하거나 실외에 거주', '주 3~5회', '주 1~2회', '거의 나가지 않음'] },
  { key: 'Q19', text: '같이 동거하는 동물이 있나요?', type: 'multi_choice', choices: ['없음', '강아지', '고양이', '그 외'] },

  // ── Q9=1 피부/귀 이상: Q20~Q29 ─────────────────────────
  { key: 'Q20', text: '[피부/귀 이상] 증상이 있는 부위는 어디인가요?', type: 'multi_choice', choices: ['귀', '얼굴, 머리', '입주면, 목', '눈 주변', '발/다리', '배/사타구니', '등/몸통', '꼬리/항문주변', '전신'], condition: { onKey: 'Q9', value: '피부/귀 이상' } },
  { key: 'Q21', text: '[피부/귀 이상] 귀에 어떤 증상이 있나요?', type: 'multi_choice', choices: ['냄새가 남', '분비물', '귀를 자주 긁음', '머리를 자주 텀'], condition: { onKey: 'Q20', value: '귀' } },
  { key: 'Q22', text: '[피부/귀 이상] 어느 쪽 귀에 증상이 있나요?', type: 'single_choice', choices: ['왼쪽', '오른쪽', '양쪽', '잘 모르겠음'], condition: { onKey: 'Q21', answered: true } },
  { key: 'Q23', text: '[피부/귀 이상] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['가려움 (긁거나 핥음)', '발진/붉어짐', '탈모', '딱지/각질', '진물/고름', '혹/멍울'], condition: { onKey: 'Q20', anyOf: ['얼굴, 머리', '입주면, 목', '눈 주변', '발/다리', '배/사타구니', '등/몸통', '꼬리/항문주변', '전신'] } },
  { key: 'Q24', text: '[피부/귀 이상] 가려움 정도는 어느정도인가요?', type: 'scale', scaleMin: 0, scaleMax: 10, scaleMinLabel: '전혀 없음', scaleMaxLabel: '매우 심함', condition: { onKey: 'Q23', anyOf: ['가려움 (긁거나 핥음)', '발진/붉어짐', '탈모', '딱지/각질', '진물/고름'] } },
  { key: 'Q25', text: '[피부/귀 이상] 증상은 언제부터 시작되었나요?', type: 'single_choice', choices: ['최근 (며칠 이내): 갑자기 피부가 안 좋아짐', '1주~한달 이내: 최근 들어 증상이 지속되고 있음', '오래전부터 (만성적): 몇 달 이상 꾸준히 증상이 있음', '매년 특정 시기마다 반복됨'], condition: { onKey: 'Q24', answered: true } },
  { key: 'Q26', text: '[피부/귀 이상] 혹/멍울은 언제 발견하셨나요?', type: 'single_choice', choices: ['오늘', '주일 이내', '한달 이내', '한달 이상', '잘 모르겠음'], condition: { onKey: 'Q23', value: '혹/멍울' } },
  { key: 'Q27', text: '[피부/귀 이상] 크기 변화가 있나요?', type: 'single_choice', choices: ['점점 커짐', '비슷하게 유지', '작아짐', '잘 모르겠음'], condition: { onKey: 'Q26', answered: true } },
  { key: 'Q28', text: '[피부/귀 이상] 혹/멍울은 몇개인가요?', type: 'single_choice', choices: ['1개', '2~3개', '여러개', '잘 모르겠음'], condition: { onKey: 'Q27', answered: true } },
  { key: 'Q29', text: '[피부/귀 이상] 만졌을 때 어떤가요?', type: 'multi_choice', choices: ['단단함', '말랑말랑함', '움직임', '아파함', '잘 모르겠음'], condition: { onKey: 'Q28', answered: true } },

  // ── Q9=2 구토/설사/혈변: Q30~Q39 ───────────────────────
  { key: 'Q30', text: '[구토/설사/혈변] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['구토', '설사', '혈변'], condition: { onKey: 'Q9', value: '구토/설사/혈변' } },
  { key: 'Q31', text: '[구토/설사/혈변] 식욕은 어떤 변화가 있나요?', type: 'single_choice', choices: ['평소와 비슷', '평소보다 감소', '거의 먹지 않음', '평소보다 증가'], condition: { onKey: 'Q30', answered: true } },
  { key: 'Q32', text: '[구토/설사/혈변] 활동성 변화가 있나요?', type: 'single_choice', choices: ['평소와 비슷', '평소보다 감소'], condition: { onKey: 'Q31', answered: true } },
  { key: 'Q33', text: '[구토/설사/혈변] 북부를 만졌을 때 불편해하나요?', type: 'single_choice', choices: ['예', '아니오', '잘 모르겠음'], condition: { onKey: 'Q32', answered: true } },
  { key: 'Q34', text: '[구토/설사/혈변] 구토는 하루에 몇 번 정도 하나요?', type: 'single_choice', choices: ['1~2회', '3회 이상', '거의 계속'], condition: { onKey: 'Q30', value: '구토' } },
  { key: 'Q35', text: '[구토/설사/혈변] 구토 내용물은 어떤가요?', type: 'multi_choice', choices: ['음식', '노란 액체', '거품', '피', '잘 모르겠음'], condition: { onKey: 'Q34', answered: true } },
  { key: 'Q36', text: '[구토/설사/혈변] 구토 전 행동은 어떤가요?', type: 'single_choice', choices: ['배에 힘을 주지 않고 주르륵 흘리듯 나옴', "배가 심하게 꿀렁거리고 '욱욱' 헛구역질 후 구토", '직접 보지 못했거나 잘 모르겠음'], condition: { onKey: 'Q35', answered: true } },
  { key: 'Q37', text: '[구토/설사/혈변] 변 상태는 어떤가요?', type: 'single_choice', choices: ['정상적인 변', '모양은 있지만 무른 변', '모양이 거의 없는 설사', '완전한 물설사', '콧물 같은 점액이 섞인 설사', '잘 모르겠음'], condition: { onKey: 'Q30', value: '설사' } },
  { key: 'Q38', text: '[구토/설사/혈변] 설사는 하루에 몇 번정도 하나요?', type: 'single_choice', choices: ['1~2회', '3회 이상', '계속'], condition: { onKey: 'Q37', answered: true } },
  { key: 'Q39', text: '[구토/설사/혈변] 혈변의 색은 어떤가요?', type: 'single_choice', choices: ['선홍색', '초콜렛색/갈색', '검은색', '잘 모르겠음'], condition: { onKey: 'Q30', value: '혈변' } },

  // ── Q9=3 식욕 및 체중 변화: Q40~Q42 ─────────────────────
  { key: 'Q40', text: '[식욕 및 체중변화] 식욕은 어떤 변화가 있나요?', type: 'single_choice', choices: ['평소와 비슷', '평소보다 감소', '음식에 관심은 있으나 잘 먹지 못함', '거의 먹지 않음', '평소보다 증가'], condition: { onKey: 'Q9', value: '식욕 및 체중 변화' } },
  { key: 'Q41', text: '[식욕 및 체중변화] 체중은 어떤 변화가 있나요?', type: 'single_choice', choices: ['평소와 비슷', '평소보다 감소', '평소보다 증가', '잘 모르겠음'], condition: { onKey: 'Q40', answered: true } },
  { key: 'Q42', text: '[식욕 및 체중변화] 함께 나타나는 증상이 있나요?', type: 'multi_choice', choices: ['구토', '설사', '배변이상', '기력 저하', '물 마시는 양의 변화', '소변 변화', '없음'], condition: { onKey: 'Q41', answered: true } },

  // ── Q9=4 복통/복부 팽만: Q43~Q46 ───────────────────────
  { key: 'Q43', text: '[복통/복부 팽만] 복부에 어던 변화가 있나요?', type: 'single_choice', choices: ['배가 불러 보임', '배를 만지면 아파하거나 싫어함', '위 두가지 모두 해당', '잘 모르겠음'], condition: { onKey: 'Q9', value: '복통/복부 팽만' } },
  { key: 'Q44', text: '[복통/복부 팽만] 복부의 변화는 어떤 양상인가요?', type: 'single_choice', choices: ['오늘 갑자기 배가 불러짐', '며칠 동안 배가 점점 불러짐', '평소와 비슷함', '잘 모르겠음'], condition: { onKey: 'Q43', answered: true } },
  { key: 'Q45', text: '[복통/복부 팽만] 통증 정도는 어느정도인가요?', type: 'scale', scaleMin: 0, scaleMax: 10, scaleMinLabel: '전혀 없음', scaleMaxLabel: '매우 심함', condition: { onKey: 'Q44', answered: true } },
  { key: 'Q46', text: '[복통/복부 팽만] 함께 나타나는 증상이 있나요?', type: 'multi_choice', choices: ['구토/헛구역질', '식욕 감소', '기력 저하', '설사', '물 마시는 양 변화', '헐떡거림', '없음'], condition: { onKey: 'Q45', answered: true } },

  // ── Q9=5 변비: Q47~Q50 ─────────────────────────────────
  { key: 'Q47', text: '[변비] 마지막으로 변을 본 것은 언제인가요?', type: 'single_choice', choices: ['오늘', '1~2일 전', '3일 이상 전', '잘 모르겠음'], condition: { onKey: 'Q9', value: '변비' } },
  { key: 'Q48', text: '[변비] 변을 볼 때 힘을 많이 주나요?', type: 'single_choice', choices: ['힘을 많이 줌', '평소와 비슷', '힘을 주는 모습은 없음', '잘 모르겠음'], condition: { onKey: 'Q47', answered: true } },
  { key: 'Q49', text: '[변비] 변의 상태는 어떤가요?', type: 'multi_choice', choices: ['단단하고 건조', '작은 알갱이', '양이 매우 적음', '평소와 비슷', '잘 모르겠음'], condition: { onKey: 'Q48', answered: true } },
  { key: 'Q50', text: '[변비] 함께 나타나는 증상이 있나요?', type: 'multi_choice', choices: ['구토', '식욕 감소', '기력 저하', '없음'], condition: { onKey: 'Q49', answered: true } },

  // ── Q9=6 기침/콧물/재채기: Q51~Q55 ─────────────────────
  { key: 'Q51', text: '[기침/콧물/재채기] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['기침', '콧물', '재채기', '코막힘', '거위소리'], condition: { onKey: 'Q9', value: '기침/콧물/재채기' } },
  { key: 'Q52', text: '[기침/콧물/재채기] 증상이 언제 심해지나요?', type: 'single_choice', choices: ['흥분할 때', '운동할 때', '밤에', '계속 나타남', '잘 모르겠음'], condition: { onKey: 'Q51', answered: true } },
  { key: 'Q53', text: '[기침/콧물/재채기] 기침 종류는 어떤가요?', type: 'single_choice', choices: ['마른 기침', '가래가 있는 기침', '혈액 섞인 기침', '잘 모르겠음'], condition: { onKey: 'Q51', value: '기침' } },
  { key: 'Q54', text: '[기침/콧물/재채기] 콧물 색은 어떤가요?', type: 'single_choice', choices: ['투명', '노란색/초록색', '피가 섞인 색', '음식물 섞임', '잘 모르겠음'], condition: { onKey: 'Q51', value: '콧물' } },
  { key: 'Q55', text: '[기침/콧물/재채기] 재채기의 빈도는 어떤가요?', type: 'single_choice', choices: ['가끔', '자주', '매우 자주'], condition: { onKey: 'Q51', value: '재채기' } },

  // ── Q9=7 호흡곤란/숨소리 변화: Q56~Q60 ─────────────────
  { key: 'Q56', text: '[호흡곤란/숨소리 변화] 어떤 변화가 있나요?', type: 'multi_choice', choices: ['숨이 평소보다 빠름', '숨쉬기 힘들어 보임', '숨소리가 거칠고 큼', '입을 벌리고 숨을 쉼', '잘 모르겠음'], condition: { onKey: 'Q9', value: '호흡곤란/숨소리 변화' } },
  { key: 'Q57', text: '[호흡곤란/숨소리 변화] 증상은 언제 더 심해지나요?', type: 'single_choice', choices: ['가만히 있을 때도 나타남', '움직이거나 흥분할 때', '잘 모르겠음'], condition: { onKey: 'Q56', answered: true } },
  { key: 'Q58', text: '[호흡곤란/숨소리 변화] 호흡 상태는 어느정도인가요?', type: 'scale', scaleMin: 0, scaleMax: 10, scaleMinLabel: '정상', scaleMaxLabel: '매우 힘들어 보임', condition: { onKey: 'Q57', answered: true } },
  { key: 'Q59', text: '[호흡곤란/숨소리 변화] 혀나 잇몸 색이 변한 것 같나요?', type: 'single_choice', choices: ['분홍색', '창백함', '보라색/푸른색', '잘 모르겠음'], condition: { onKey: 'Q58', answered: true } },
  { key: 'Q60', text: '[호흡곤란/숨소리 변화] 숨소리는 어떤가요?', type: 'single_choice', choices: ['쌕쌕거리는 소리', '거칠고 큰 소리', '잘 모르겠음'], condition: { onKey: 'Q59', answered: true } },

  // ── Q9=8 눈 이상: Q61~Q62 ──────────────────────────────
  { key: 'Q61', text: '[눈 이상] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['충혈/부음', '눈꼽 증가', '눈물 증가', '눈물 감소', '시력 저하', '눈을 비빔', '눈과 눈 주변의 혹/상처', '눈을 잘 뜨지 못함', '양쪽 눈의 비대칭'], condition: { onKey: 'Q9', value: '눈 이상' } },
  { key: 'Q62', text: '[눈 이상] 어느 쪽 눈을 불편해하나요?', type: 'single_choice', choices: ['왼쪽', '오른쪽', '양쪽'], condition: { onKey: 'Q61', answered: true } },

  // ── Q9=9 구강 문제/스케일링: Q63~Q69 ───────────────────
  { key: 'Q63', text: '[구강 질환/스케일링] 양치는 얼마나 자주 하나요?', type: 'single_choice', choices: ['매일', '주에 3회 이내', '주에 1회', '안 함'], condition: { onKey: 'Q9', value: '구강 문제/스케일링' } },
  { key: 'Q64', text: '[구강 질환/스케일링] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['입냄새', '치석이 많이 보임', '잇몸이 붉거나 피가 남', '먹기 불편해보임', '입안에 혹/상처', '증상 없음'], condition: { onKey: 'Q63', answered: true } },
  { key: 'Q65', text: '[구강 질환/스케일링] 치아 상태는 어떤가요?', type: 'single_choice', choices: ['일부 치아에 치석이 있음', '전체적으로 치석이 있음', '치석 거의 없음'], condition: { onKey: 'Q64', anyOf: ['입냄새', '치석이 많이 보임', '증상 없음'] } },
  { key: 'Q66', text: '[구강 질환/스케일링] 최근에 스케일링을 받은 적이 있나요?', type: 'single_choice', choices: ['6개월 이내', '1년 이내', '1~3년 전', '3년 이상', '받은 적 없음'], condition: { onKey: 'Q65', answered: true } },
  { key: 'Q67', text: '[구강 질환/스케일링] 잇몸 또는 식사 상태는 어떤가요?', type: 'multi_choice', choices: ['붉기만 있음', '씹을 때 피가 남', '딱딱한 것을 못 씹음', '한쪽으로만 씹음'], condition: { onKey: 'Q64', anyOf: ['잇몸이 붉거나 피가 남', '먹기 불편해보임'] } },
  { key: 'Q68', text: '[구강 질환/스케일링] 혹이나 상처의 상태는 어떤가요?', type: 'multi_choice', choices: ['점점 커지는 것 같다', '피/진물이 난다', '통증이 있어 보인다'], condition: { onKey: 'Q64', value: '입안에 혹/상처' } },
  { key: 'Q69', text: '[구강 질환/스케일링] 통증 반응은 어떤가요?', type: 'single_choice', choices: ['만져도 괜찮다', '만지면 싫어한다', '통증이 심해보인다', '잘 모르겠음'], condition: { onKey: 'Q67', answered: true } },

  // ── Q9=10 파행/절뚝거림: Q70~Q73 ───────────────────────
  { key: 'Q70', text: '[파행/절뚝거림/관절통] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['절뚝거림', '다리를 딛지 못함', '점프,걷기,계단을 싫어함', '뻣뻣해짐/마비', '붓거나 아파함', '음직일때 소리가남', '특정 자세를 못함', '근육양 감소'], condition: { onKey: 'Q9', value: '파행/절뚝거림/관절통증의심' } },
  { key: 'Q71', text: '[파행/절뚝거림/관절통] 어느 부위가 문제라고 느껴지시나요?', type: 'multi_choice', choices: ['오른쪽 앞다리', '왼쪽 앞다리', '왼쪽 뒷다리', '오른쪽 뒷다리', '목', '허리', '기타', '잘 모르겠음'], condition: { onKey: 'Q70', answered: true } },
  { key: 'Q72', text: '[파행/절뚝거림/관절통] 증상의 경과가 어떤가요?', type: 'single_choice', choices: ['점점 심해짐', '처음과 비슷하게 유지', '점점 나아짐'], condition: { onKey: 'Q71', answered: true } },
  { key: 'Q73', text: '[파행/절뚝거림/관절통] 활동량의 변화가 있나요?', type: 'single_choice', choices: ['아프기 전과 비슷', '아프기 전보다 활동량 감소', '전혀 움직이지 않으려함'], condition: { onKey: 'Q72', answered: true } },

  // ── Q9=11 기력저하: Q74~Q78 ────────────────────────────
  { key: 'Q74', text: '[기력저하/활동량 감소] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['평소보다 많이 누워있음', '산책/놀이를 안 함', '금방 지침', '식욕이 감소함', '숨이 차거나 호흡이 불편해보임'], condition: { onKey: 'Q9', value: '기력저하/활동성감소' } },
  { key: 'Q75', text: '[기력저하/활동량 감소] 식욕감소가 있다면 어느정도인가요?', type: 'single_choice', choices: ['조금 줄었다', '많이 줄었다', '아예 안 먹는다', '간식만 먹는다', '평소와 같게 잘 먹는다'], condition: { onKey: 'Q74', answered: true } },
  { key: 'Q76', text: '[기력저하/활동량 감소] 하루 활동량은 어떤가요?', type: 'single_choice', choices: ['전반적으로 활동이 줄었다', '특정 상황(산책/놀이)에서만 줄었다', '하루의 대부분을 누워만 있는다'], condition: { onKey: 'Q74', anyOf: ['평소보다 많이 누워있음', '산책/놀이를 안 함', '금방 지침'] } },
  { key: 'Q77', text: '[기력저하/활동량 감소] 주로 언제 숨이 가빠 보이나요?', type: 'multi_choice', choices: ['운동하거나 움직일 때', '가만히 있을 때', '잠 잘 때/야간에', '항상 그렇다', '잘 모르겠다'], condition: { onKey: 'Q74', value: '숨이 차거나 호흡이 불편해보임' } },
  { key: 'Q78', text: '[기력저하/활동량 감소] 평소와 다른 행동이 있나요?', type: 'multi_choice', choices: ['숨거나 가만히 있으려 함', '예민해짐', '움직이기 싫어함', '특별한 변화 없음'], condition: { onKey: 'Q74', value: '식욕이 감소함' } },

  // ── Q9=12 소변 이상: Q79~Q85 ───────────────────────────
  { key: 'Q79', text: '[요로계 이상] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['혈뇨', '배뇨를 오래 보거나 힘들어함', '소변을 자주 봄', '소변량이 줄었음'], condition: { onKey: 'Q9', value: '소변 이상(혈뇨, 배뇨곤란)' } },
  { key: 'Q80', text: '[요로계 이상] 혈뇨는 어떤 양상인가요?', type: 'single_choice', choices: ['소변 전체가 붉다', '마지막만 붉다', '혈뇨를 봤다 안봤다 반복한다', '잘 모르겠음'], condition: { onKey: 'Q79', value: '혈뇨' } },
  { key: 'Q81', text: '[요로계 이상] 함께 보이는 증상이 있나요?', type: 'multi_choice', choices: ['소변을 자주 본다', '자세를 오래 취한다', '소변 볼 때 아파한다', '다른 증상 없음'], condition: { onKey: 'Q80', answered: true } },
  { key: 'Q82', text: '[요로계 이상] 소변은 실제로 얼마나 나오나요?', type: 'single_choice', choices: ['나오긴 하지만 양이 적다', '몇 방울만 나온다', '전혀 못 본다', '잘 모르겠음'], condition: { onKey: 'Q79', anyOf: ['배뇨를 오래 보거나 힘들어함', '소변량이 줄었음'] } },
  { key: 'Q83', text: '[요로계 이상] 아래의 증상이 있나요?', type: 'multi_choice', choices: ['불안해하거나 낑낑거린다', '배를 만지면 싫어한다', '구토나 기력저하가 있다', '다른 증상 없음'], condition: { onKey: 'Q82', answered: true } },
  { key: 'Q84', text: '[요로계 이상] 소변을 얼마나 자주 보나요?', type: 'single_choice', choices: ['평소보다 조금 자주 보는 것 같다', '눈에 띄게 늘었다', '패드에서 벗어나지 못한다', '잘 모르겠음'], condition: { onKey: 'Q79', value: '소변을 자주 봄' } },
  { key: 'Q85', text: '[요로계 이상] 함께 해당되는 것이 있나요?', type: 'multi_choice', choices: ['혈뇨', '배뇨 시 힘을 준다', '통증이 있다', '물을 많이 마신다', '다른 증상 없음'], condition: { onKey: 'Q84', answered: true } },

  // ── Q9=13 생식기 분비물: Q86~Q89 ───────────────────────
  { key: 'Q86', text: '[생식기 분비물] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['외음부/생식기에서 분비물이 나옴', '생식기를 핥음', '소변처럼 보이지만 냄새나 색이 다름'], condition: { onKey: 'Q9', value: '생식기 분비물' } },
  { key: 'Q87', text: '[생식기 분비물] 분비물은 어떤 색인가요?', type: 'single_choice', choices: ['투명/맑음', '노란색/초록색', '피가 섞인 색', '갈색/탁한 색', '잘 모르겠음'], condition: { onKey: 'Q86', value: '외음부/생식기에서 분비물이 나옴' } },
  { key: 'Q88', text: '[생식기 분비물] 분비물이 실제로 보이나요?', type: 'single_choice', choices: ['보인다', '거의 안 보이지만 핥는다', '잘 모르겠음'], condition: { onKey: 'Q86', value: '생식기를 핥음' } },
  { key: 'Q89', text: '[생식기 분비물] 분비물의 특징은 어떤가요?', type: 'single_choice', choices: ['소변과 비슷하지만 색이 다름', '끈적거림', '물처럼 묽음', '잘 모르겠음'], condition: { onKey: 'Q86', value: '소변처럼 보이지만 냄새나 색이 다름' } },

  // ── Q9=14 물 섭취 증가: Q90~Q95 ─────────────────────────
  { key: 'Q90', text: '[물 섭취 증가] 어떤 증상이 있나요?', type: 'multi_choice', choices: ['물을 평소보다 많이 마심', '소변량이 많아짐', '소변 실수가 있음', '식욕 변화가 있음', '체중 변화가 있음'], condition: { onKey: 'Q9', value: '물 섭취 증가' } },
  { key: 'Q91', text: '[물 섭취 증가] 물을 얼마나 많이 마시나요?', type: 'scale', scaleMin: 0, scaleMax: 10, scaleMinLabel: '평소와 비슷', scaleMaxLabel: '평소보다 급격히 많이', condition: { onKey: 'Q90', value: '물을 평소보다 많이 마심' } },
  { key: 'Q92', text: '[물 섭취 증가] 소변의 양상은 어떤가요?', type: 'single_choice', choices: ['양만 많아졌다', '횟수도 늘고 양도 많아졌다', '잘 모르겠음'], condition: { onKey: 'Q90', value: '소변량이 많아짐' } },
  { key: 'Q93', text: '[물 섭취 증가] 실수의 양상은 어떤가요?', type: 'single_choice', choices: ['자다가 샌다', '참지 못하고 본다', '잘 모르겠음'], condition: { onKey: 'Q90', value: '소변 실수가 있음' } },
  { key: 'Q94', text: '[물 섭취 증가] 식욕 변화는 어떤가요?', type: 'single_choice', choices: ['식욕이 늘었다', '식욕이 줄었다', '들쑥날쑥하다'], condition: { onKey: 'Q90', anyOf: ['식욕 변화가 있음', '체중 변화가 있음'] } },
  { key: 'Q95', text: '[물 섭취 증가] 체중 변화는 어떤가요?', type: 'single_choice', choices: ['눈에 띄게 감소했다', '조금 줄어든 것 같다', '잘 모르겠다', '증가했다', '눈에 띄게 증가했다'], condition: { onKey: 'Q94', answered: true } },

  // ── Q9=15 외상: Q96~Q101 ───────────────────────────────
  { key: 'Q96', text: '[외상] 어떤 상황이 있었나요?', type: 'multi_choice', choices: ['높은 곳에서 떨어짐', '끼임 또는 깔림', '사람이나 다른 물체와 부딫힘', '교통사고', '다른 동물과 싸우거나 물림', '잘 모르겠음'], condition: { onKey: 'Q9', value: '외상' } },
  { key: 'Q97', text: '[외상] 언제 발생하였나요?', type: 'single_choice', choices: ['방금/1시간 이내', '오늘', '1~2일 이내', '2일 이상', '잘 모르겠음'], condition: { onKey: 'Q96', answered: true } },
  { key: 'Q98', text: '[외상] 내원시점 어떤 증상이 있나요?', type: 'single_choice', choices: ['절뚝거림', '상처가 있고 출혈이 보임', '의식이 없음', '구토 또는 침흘림', '호흡곤란', '특별한 이상 없음'], condition: { onKey: 'Q97', answered: true } },
  { key: 'Q99', text: '[외상] 떨어진 높이는 어느 정도인가요?', type: 'single_choice', choices: ['낮은 높이(쇼파/침대)', '중간 높이(책상/탁자)', '높은 곳(베란다/계단/2층 이상)'], condition: { onKey: 'Q96', value: '높은 곳에서 떨어짐' } },
  { key: 'Q100', text: '[외상] 사고 직후 상태는 어땠나요?', type: 'single_choice', choices: ['바로 일어나서 움직임', '절뚝거리거나 비틀거림', '거의 움직이지 못함', '의식이 흐릿하고 반응이 없음'], condition: { onKey: 'Q96', anyOf: ['사람이나 다른 물체와 부딫힘', '교통사고'] } },
  { key: 'Q101', text: '[외상] 물린 동물의 종류는 무엇인가요?', type: 'single_choice', choices: ['강아지', '고양이', '야생동물(너구리, 쥐 등)', '잘 모르겠음'], condition: { onKey: 'Q96', value: '다른 동물과 싸우거나 물림' } },

  // ── Q9=16 이물/독성 섭취 의심: Q102~Q104 ──────────────
  { key: 'Q102', text: '[이물/독성물질 섭취 의심] 이물 섭취 장면을 직접 목격하셨나요?', type: 'single_choice', choices: ['직접 봤다', '직접 보진 못했으나 의심된다'], condition: { onKey: 'Q9', value: '이물/독성 물질 섭취 의심' } },
  { key: 'Q103', text: '[이물/독성물질 섭취 의심] 무엇을 먹었나요?', type: 'single_choice', choices: ['천 재질의 물건', '금속 재질의 물건', '플라스틱 재질의 물건', '뾰족한 물건', '약/세제/쥐약/초콜릿 등의 위험물질', '잘 모르겠음'], condition: { onKey: 'Q102', answered: true } },
  { key: 'Q104', text: '[이물/독성물질 섭취 의심] 현재 어떤 증상이 있나요?', type: 'multi_choice', choices: ['구토', '식욕/기력저하', '복통/배변 이상', '침흘림', '떨림/발작', '없음'], condition: { onKey: 'Q103', answered: true } },

  // ── Q9=17 발작/경련: Q105~Q108 ─────────────────────────
  { key: 'Q105', text: '[발작/경련] 발작 당시, 어떤 증상이 있었나요?', type: 'multi_choice', choices: ['몸을 떨거나 뻣뻣해짐', '의식이 없는 듯 쓰러짐', '침흘림', '멍하게 있음', '잘 모르겠음'], condition: { onKey: 'Q9', value: '발작/경련' } },
  { key: 'Q106', text: '[발작/경련] 증상이 얼마나 지속되었나요?', type: 'single_choice', choices: ['1분 미만', '1~5분', '5분 이상'], condition: { onKey: 'Q105', answered: true } },
  { key: 'Q107', text: '[발작/경련] 이런 증상이 이전에도 있었나요?', type: 'single_choice', choices: ['오늘이 처음이다', '2번 이상 있었다', '잘 모르겠음'], condition: { onKey: 'Q106', answered: true } },
  { key: 'Q108', text: '[발작/경련] 증상 전후로 아래와 같은 모습이 있었나요?', type: 'multi_choice', choices: ['구토/설사', '비틀거림/못일어남', '멍함/반응 저하', '이물질 섭취가 의심되는 상태', '없다'], condition: { onKey: 'Q107', answered: true } },

  // ── Q9=18 건강검진: Q109~Q111 ──────────────────────────
  { key: 'Q109', text: '[건강검진] 건강검진을 받으려는 이유는 무엇인가요?', type: 'single_choice', choices: ['정기적 검진', '나이가 들어서', '이전 검사에서 이상 소견이 있어서', '건강상의 이상이 의심되어서'], condition: { onKey: 'Q9', value: '건강검진' } },
  { key: 'Q110', text: '[건강검진] 특별히 확인하고 싶거나 걱정되는 부분이 있나요?', type: 'multi_choice', choices: ['심장', '신장/간', '호르몬/당뇨', '암', '전반적인 건강상태', '관절', '행동변화'], condition: { onKey: 'Q109', answered: true } },
  { key: 'Q111', text: '[건강검진] 최근 아래와 같은 변화가 있었나요?', type: 'multi_choice', choices: ['식욕변화', '체중변화', '기력저하', '다음다뇨', '구토설사', '절뚝거림', '없다'], condition: { onKey: 'Q110', answered: true } },

  // ── Q9=19 예방접종/사상충 예방: Q112~Q116 ──────────────
  { key: 'Q112', text: '[예방접종/사상충 예방] 어떤 관리를 위해 내원하셨나요?', type: 'single_choice', choices: ['예방접종', '심장사상충 및 내외부기생충', '둘 다'], condition: { onKey: 'Q9', value: '예방접종/상상충예방' } },
  { key: 'Q113', text: '[예방접종/사상충 예방] 마지막으로 받은 접종은 언제인가요?', type: 'single_choice', choices: ['1년 이내', '3년 이내', '어릴 때/입양 이후 접종 하지 않음', '잘 모르겠음'], condition: { onKey: 'Q112', anyOf: ['예방접종', '둘 다'] } },
  { key: 'Q114', text: '[예방접종/사상충 예방] 예방접종 후 이상반응이 있었나요?', type: 'multi_choice', choices: ['없다', '구토/설사', '피부 반응', '컨디션 저하', '잘 모르겠음'], condition: { onKey: 'Q113', anyOf: ['1년 이내', '3년 이내'] } },
  { key: 'Q115', text: '[예방접종/사상충 예방] 현재 사용 중인 기생충 예방약은 어떤 종류인가요?', type: 'single_choice', choices: ['먹는약 (넥스가드스펙트라, 하트가드 등)', '바르는약 (애드보킷, 레볼루션)', '몇 가지를 혼합해서 사용', '이름은 모르지만 사용 중', '사용하지 않음'], condition: { onKey: 'Q112', anyOf: ['심장사상충 및 내외부기생충', '둘 다'] } },
  { key: 'Q116', text: '[예방접종/사상충 예방] 마지막으로 언제 투약했나요?', type: 'single_choice', choices: ['1개월 전', '3개월 전', '6개월 전', '잘 모르겠음'], condition: { onKey: 'Q115', anyOf: ['먹는약 (넥스가드스펙트라, 하트가드 등)', '바르는약 (애드보킷, 레볼루션)', '몇 가지를 혼합해서 사용', '이름은 모르지만 사용 중'] } },

  // ── Q9=20 행동문제: Q117~Q120 ──────────────────────────
  { key: 'Q117', text: '[행동문제] 현재 가장 고민되는 행동은 무엇인가요?', type: 'single_choice', choices: ['분리불안', '공격성', '짖음', '배변문제(실수,마킹)', '반복행동', '파괴 행동', '기타'], condition: { onKey: 'Q9', value: '행동문제(공격석, 분리불안 등)' } },
  { key: 'Q118', text: '[행동문제] 행동은 주로 언제 나타나나요?', type: 'single_choice', choices: ['혼자 있을 때', '특정상황(낯선사람/소리/외출)', '항상/상황과 관계 없음', '특정 대상에게만(엄마,아빠 등)', '잘 모르겠음'], condition: { onKey: 'Q117', answered: true } },
  { key: 'Q119', text: '[행동문제] 아래 중 해당되는 것이 있나요?', type: 'multi_choice', choices: ['사람이나 동물을 물거나 다치게 한 적이 있음', '물건 파손', '잠을 못 잘 정도로 지속됨', '일상생활이 불가할 정도로 큰 불편이 있음', '해당 없음'], condition: { onKey: 'Q118', answered: true } },
  { key: 'Q120', text: '[행동문제] 이 문제를 해결하기 위하여 시도해본 방법이 있나요?', type: 'multi_choice', choices: ['개인적으로 훈련 시도', '전문 훈련 진행', '환경변화 (케이지,생활공간 분리)', '유치원', '약물 사용', '특별히 해본 것 없음'], condition: { onKey: 'Q119', answered: true } },

  // ── Q9=22 그 외: Q121~Q124 ─────────────────────────────
  { key: 'Q121', text: '[그 외] 가장 걱정되는 증상은 무엇인가요?', type: 'multi_choice', choices: ['통증이 있어 보인다', '움직임이나 자세가 이상해보인다', '몸에서 이상한 냄새가 난다', '전반적으로 평소와 다르다'], condition: { onKey: 'Q9', value: '그 외' } },
  { key: 'Q122', text: '[그 외] 증상은 언제부터 시작되었나요?', type: 'single_choice', choices: ['오늘 갑자기', '2~3일 전부터', '1주일', '오래 전부터', '잘 모르겠음'], condition: { onKey: 'Q121', answered: true } },
  { key: 'Q123', text: '[그 외] 증상은 어떻게 변하고 있나요?', type: 'single_choice', choices: ['비슷함', '점점 심해짐', '좋아졌다 나빠졌다 반복함', '조금 나아짐', '많이 나아짐', '잘 모르겠음'], condition: { onKey: 'Q122', answered: true } },
  { key: 'Q124', text: '[그 외] 함께 보이는 변화가 있나요?', type: 'multi_choice', choices: ['식욕이 없어보인다', '기력이 없다', '예민하다', '멍하다', '없음'], condition: { onKey: 'Q123', answered: true } },
]);

function hasTrimmed(value: string | null | undefined): boolean {
  return !!(value && String(value).trim());
}

/** 신원·연락처는 생성 시 값이 있으면 질문 자체를 넣지 않는다. (conditionalOn 은 아래에서 재매핑) */
function buildFilteredIdentityQuestionDefs(
  guardianName: string | null | undefined,
  patientName: string | null | undefined,
  contact: string | null | undefined,
): QuestionDef[] {
  const full = FIRST_VISIT_FIXED_QUESTIONS;
  const guardianDef = full[0];
  const phoneDef = full[1];
  const petDef = full[2];

  const hasG = hasTrimmed(guardianName);
  const hasP = hasTrimmed(patientName);
  const hasC = hasTrimmed(contact);

  const needG = !hasG;
  const needP = !hasP;
  const needC = !hasC;

  // 둘 다 이름이 비었을 때만: 성명 → 반려 이름 → 연락처 순
  const ordered: Array<{ need: boolean; def: QuestionDef }> =
    !hasG && !hasP
      ? [
          { need: needG, def: guardianDef },
          { need: needP, def: petDef },
          { need: needC, def: phoneDef },
        ]
      : [
          { need: needG, def: guardianDef },
          { need: needC, def: phoneDef },
          { need: needP, def: petDef },
        ];

  return ordered.filter((x) => x.need).map((x) => x.def);
}

function remapTailConditionalOrders(q: QuestionDef, identityCount: number): QuestionDef {
  const co = q.conditionalOn;
  if (co === undefined) return { ...q };
  // 초진 고정본에서 분기는 모두 4번(종류) 이후를 가리킴
  if (co <= 3) return { ...q };
  return { ...q, conditionalOn: identityCount + (co - 3) };
}

/**
 * 초진 문진표 질문 인스턴스 빌더.
 * 생성 시 이미 받은 보호자 성명·연락처·반려 이름은 질문으로 넣지 않는다.
 * 보호자·반려 이름이 둘 다 비었을 때만 맨 앞 순서를 성명 → 반려 이름 → 연락처로 한다.
 */
export function buildFirstVisitQuestionRows(
  guardianName: string | null | undefined,
  patientName: string | null | undefined,
  contact: string | null | undefined,
): QuestionDef[] {
  const full = FIRST_VISIT_FIXED_QUESTIONS;
  const identity = buildFilteredIdentityQuestionDefs(guardianName, patientName, contact);
  const k = identity.length;
  const tail = full.slice(3).map((q) => remapTailConditionalOrders({ ...q }, k));
  return [...identity, ...tail];
}

// ─── 재진 고정 질문 ──────────────────────────────────────

/** 재진 고정 질문 (initial stage) — 보호자가 작성 */
export const FOLLOW_UP_FIXED_QUESTIONS: QuestionDef[] = [
  { text: '활력/컨디션은 어떤가요?', type: 'single_choice', choices: ['평소와 비슷해요', '좀 처져 있어요', '많이 안 좋아요'] },
  { text: '식욕은 어떤가요?', type: 'single_choice', choices: ['정상', '줄었어요', '늘었어요'] },
];
