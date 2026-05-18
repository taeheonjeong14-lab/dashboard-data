import {
  HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS,
  HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS,
  HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_DX_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_IMP_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_IMAGING_INTERP_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_LAB_INTERP_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_MAX_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_PROMPT_MAX_OVERALL_CHARS,
  HEALTH_CHECKUP_PROMPT_MIN_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_PROMPT_MIN_OVERALL_CHARS,
  HEALTH_CHECKUP_PROMPT_SYSTEMS_DX_MAX_CHARS,
  HEALTH_CHECKUP_PROMPT_SYSTEMS_IMP_MAX_CHARS,
} from '@/lib/chart-app/health-checkup-limits';
import { HEALTH_CHECKUP_SYSTEMS_LLM_FIELD_KEYS } from '@/lib/chart-app/health-checkup-systems-llm-merge';

export function buildHealthCheckupInstructionBody(opts: {
  programPrefixForPhrase: string;
  excludedAreaExactPhrase: string;
  checkupDate?: string;
  mustInclude?: string;
  /** 1 = 종합소견·사후관리·재검진만 (2단계 생성 1단계용). 미지정 시 전체 섹션. */
  outputStage?: 1;
}): string {
  const maxOverall = HEALTH_CHECKUP_PROMPT_MAX_OVERALL_CHARS;
  const maxFollow = HEALTH_CHECKUP_PROMPT_MAX_FOLLOW_UP_CHARS;
  const minOverall = HEALTH_CHECKUP_PROMPT_MIN_OVERALL_CHARS;
  const minFollow = HEALTH_CHECKUP_PROMPT_MIN_FOLLOW_UP_CHARS;
  const pDx = HEALTH_CHECKUP_PROMPT_SYSTEMS_DX_MAX_CHARS;
  const pImp = HEALTH_CHECKUP_PROMPT_SYSTEMS_IMP_MAX_CHARS;
  const pDxDentalSkin = HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_DX_MAX_CHARS;
  const pImpDentalSkin = HEALTH_CHECKUP_PROMPT_DENTAL_SKIN_IMP_MAX_CHARS;
  const pImg = HEALTH_CHECKUP_PROMPT_IMAGING_INTERP_MAX_CHARS;
  const pLab = HEALTH_CHECKUP_PROMPT_LAB_INTERP_MAX_CHARS;
  const { programPrefixForPhrase, excludedAreaExactPhrase, outputStage } = opts;
  const systemsKeyLines = HEALTH_CHECKUP_SYSTEMS_LLM_FIELD_KEYS.map((k) => `- ${k}`).join('\n');
  const { checkupDate, mustInclude } = opts;
  return [
    ...(checkupDate
      ? [
          '========== 검진일자 데이터 필터링 (매우 중요) ==========',
          `이번 보고서의 검진일자는 **${checkupDate}** 이다.`,
          '가능하면 해당 날짜 데이터만 근거로 작성하고, 다른 날짜 데이터는 참고 우선순위를 낮춰라.',
          '',
        ]
      : []),
    ...(mustInclude
      ? [
          '========== 반드시 포함·강조해야 하는 내용 (매우 중요) ==========',
          '아래 요구는 적절한 JSON 필드 전반에 빠짐없이 반영한다.',
          '',
          mustInclude,
          '',
        ]
      : []),
    '========== 전체 배경 설명 ==========',
    '너는 세계에서 가장 뛰어난 수의사야.',
    '그리고 이번에 우리가 할 일은 강아지 또는 고양이의 건강검진 보고서를 쓰는 일이야.',
    '실제로 차트에서 추출한 데이터를 확인보면 어떤 검사를 진행했는지 알 수가 있고,',
    '또 중간중간에 참고할만한 내용들도 적혀있을거야.',
    '',
    '**[매우 중요] 아래 「참고 데이터」에 제공된 차트 본문·처방/플랜·검사 수치·신체검사·이미지 내용을 빠짐없이 검토하고, 임상적으로 의미 있는 소견은 모두 보고서에 반영해야 한다. 데이터가 있는데 보고서에 언급되지 않는 내용이 생기지 않도록 한다.**',
    '',
    '========== 전반적인 톤앤매너 ==========',
    '모든 문장은 **인쇄되어 보호자에게 전달되는 공식 건강검진 보고서**에 바로 실릴 글이다. 카톡·블로그·구어체가 아닌 **병원 문서 톤**을 유지한다.',
    '',
    '**전문성·정확성**',
    '- 문장은 **간결하되 피상적이지 않게** 쓴다. 가능하면 임상에서 쓰는 **정확한 용어**를 사용하고, 보호자가 처음 듣는 용어는 **같은 문장 또는 바로 다음 문장에서 한 번 짧게 풀어** 쓴다(장황한 교과서식 설명은 피한다).',
    '- 검사·영상·차트에 근거할 때는 **팩트와 해석을 구분**한다. 확인된 소견은 단정적으로 과장하지 않고, 추정·의심·추적 관찰이 필요한 경우에는 「~소견이 있습니다」「~가 의심되어」「~여부를 함께 보겠습니다」처럼 **임상적으로 타당한 완곡 표현**을 쓴다.',
    '- **검사 근거가 아주 명확한 경우가 아니면**, 질환 표현은 기본적으로 「의심됩니다」「추정됩니다」「가능성이 있습니다」 톤으로 작성하고 확정적 단정 표현은 피한다.',
    '- **단정적 병명 확정·예후 단정**은 피한다. 대신 관찰 소견, 해석 가능한 범위, 재평가·재검의 필요성을 **전문가다운 균형**으로 전달한다.',
    '',
    '**근거 제시**',
    '- 수치·검사명을 인용할 때는 **항목명 + 측정값 + 단위**를 함께 적어 신뢰도를 높인다. 불필요한 수치 나열·전 항목 나열은 하지 않고, **임상적으로 의미 있는 핵심 근거**만 골라 쓴다.',
    '- 여러 근거가 있을 때는 **가장 보호자가 알아야 할 순서**(위험도·시급성)에 맞게 배치한다.',
    '',
    '**보호자 대상 문체**',
    '- 기본은 **정중한 설명체**: 존댓말을 바탕으로 `~입니다`, `~하였습니다`, `~해 주시면 좋겠습니다`, `~살펴봐 주시기 바랍니다` 등을 **자연스럽게 섞어** 쓴다. 반말·명령조·과한 유행어는 쓰지 않는다.',
    '- **대화체·구어체로 쓰지 않는다.** 입력 데이터에 메모·SOAP 형식의 구어체가 포함되어 있더라도 출력은 반드시 **공식 보고서 문체**를 유지한다.',
    '- **완전한 문장**으로만 쓴다. 문장을 중간에 끊거나, 키워드만 나열하거나, 기호·줄임에만 의존하는 메모체는 금지한다.',
    '- 읽는 사람이 수의학 비전공자임을 전제로 하되, **유아화·과장된 감정 표현**으로 전문성을 희석하지 않는다.',
    '- 약물 관련 서술이 필요할 때는 **특정 제품명·성분명 같은 정확한 약명은 가능한 한 직접 쓰지 말고**, `항생제`, `진통제`, `소염제`, `간보조제`처럼 **약물군(치료 카테고리) 중심**으로 표현한다.',
    '',
    '**문단·줄바꿈 (모든 텍스트 필드 공통)**',
    '- **어느 필드이든**(`overallSummary`, `followUpCare`, 각 `hp*_dx`·`hp*_imp`·`hp*_interp` 등), **그 필드 문자열 안에서** 새 문단을 시작할 때는 **반드시 빈 줄 한 줄**을 둔다.',
    '- 한 문단 **안**에서는 불필요한 빈 줄을 넣지 않는다.',
    '- **예외**: 권장 재검진 네 필드는 「제목 한 줄 → `\\n` → 본문 한 줄」 형식만 사용한다.',
    '',
    `마지막으로 내가 섹션별로 글자 수 제한을 줄건데 공백 포함해서 글자수 상한·하한을 항상 철저히 지켜줘야해.`,
    '그래야 보고서에 딱 맞게 들어갈거야.',
    '',
    '========== 종합 소견 ==========',    
    '- 이번 검진을 통해 진단 또는 의심할 수 있는 내용을 적어줘',
    '- 여러 질병을 진단 또는 의심할 수 있다면 각 질병별로 문단을 나누어서 설명해줘',
    `- 글자 수: 공백 포함 **최소 ${minOverall}자 이상, 최대 ${maxOverall}자 이하**`,
    '',
    '========== 사후 관리 ==========',
    '- 종합 소견에서 설명된 내용별 향후 조치와 병원 계획을 작성해줘',
    `- 글자 수: 공백 포함 **최소 ${minFollow}자 이상, 최대 ${maxFollow}자 이하**`,
    '',
    '========== 권장 재검진 ==========',
    '- JSON 필드 recheckWithin1to2Weeks, recheckWithin1Month, recheckWithin3Months, recheckWithin6Months 각각 한 문자열',
    `- 형식: 제목 한 줄(최대 ${HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS}자) + 줄바꿈 + 본문 한 줄(최대 ${HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS}자)`,
    '',
    ...(outputStage === 1 ? [] : [
      '========== 장기/검사 섹션 공통 ==========',
      `- 주요 진단 내용 최대 ${pDx}자, 시사점 최대 ${pImp}자`,
      `- 치과/피부 주요 진단 최대 ${pDxDentalSkin}자, 시사점 최대 ${pImpDentalSkin}자`,
      `- 영상 해석 필드 최대 ${pImg}자`,
      '',
      '========== 미포함 고정 문구 규칙 ==========',
      `- 프로그램명: ${programPrefixForPhrase}`,
      `- 근거가 전혀 없는 계통/검사 칸에는 고정 문구만 그대로 사용: ${excludedAreaExactPhrase}`,
      '',
    ]),
    '========== JSON 키 ↔ 인쇄 시트 (영문 키 이름을 정확히 지킬 것) ==========',
    '- overallSummary, followUpCare',
    '- recheckWithin1to2Weeks, recheckWithin1Month, recheckWithin3Months, recheckWithin6Months',
    ...(outputStage === 1 ? [] : [
      '- hp3_circ_dx, hp3_circ_imp, hp3_digest_dx, hp3_digest_imp, hp3_endo_dx, hp3_endo_imp',
      '- hp3_renal_uro_dx, hp3_renal_uro_imp, hp3_hepatobiliary_dx, hp3_hepatobiliary_imp, hp3_msk_dx, hp3_msk_imp',
      '- hp4_dental_dx, hp4_dental_imp, hp4_skin_dx, hp4_skin_imp',
      '- hp5_rad_interp, hp5_us_interp',
      '- labInterpretation',
      '',
      '========== 혈액검사 해석 (labInterpretation) ==========',
      '- 혈액검사 결과 페이지 상단에 들어가는 전체 해석 요약',
      `- 글자 수 제한: 공백 포함 최대 ${pLab}자`,
      '',
      '응답 스키마에 포함할 시스템 시트 문자열 키(전부 필수):',
      systemsKeyLines,
    ]),
  ].join('\n');
}

