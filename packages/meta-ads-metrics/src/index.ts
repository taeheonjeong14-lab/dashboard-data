/**
 * Meta(인스타그램) 광고 전환/액션 표시 규칙 — hospital-web · admin-web 공용 단일 소스.
 *
 * 왜 공유하는가: 화면 컴포넌트는 이 repo 관례대로 앱마다 복제하지만, **어느 action_type 을
 * 보여주고 뭐라 부르는지**는 한쪽만 고치면 두 화면이 다른 숫자를 말하게 된다.
 * (chart-api 의 중복 헬퍼가 갈라져 한쪽 수정이 무효가 된 전례가 있다.)
 *
 * Meta 는 같은 행동을 관점만 바꿔 여러 이름으로 센다. 실측(한 계정 30일):
 *   post_engagement 1494 = page_engagement 1494
 *   landing_page_view 1200 = omni_landing_page_view 1200
 *   view_content = omni_view_content = onsite_web_view_content
 *     = onsite_web_app_view_content = offsite_conversion.fb_pixel_view_content = 22
 * 22종을 그냥 더하면 7,239 가 되는데 실제 행동은 그보다 훨씬 적다 → **대표 하나만 표시**한다.
 * DB(analytics_meta_ads_conversions_daily)에는 원본 22종을 그대로 두므로,
 * 나중에 다른 걸 보고 싶으면 재수집 없이 이 표에 한 줄 추가하면 된다.
 */

/** 광고 안에서 일어난 일(ad) vs 광고를 눌러 사이트로 넘어간 뒤 픽셀이 본 일(web). */
export type MetaMetricGroup = 'ad' | 'web';

export type MetaActionSpec = {
  /** 대표로 쓸 action_type */
  actionType: string;
  label: string;
  group: MetaMetricGroup;
  /** 같은 행동을 다르게 센 별칭 — 화면에서 숨긴다(값이 대표와 동일). */
  aliases?: string[];
  /** 늘어나면 나쁜 신호(감시용) — 화면에서 다르게 표시한다. */
  negative?: boolean;
};

/**
 * 표시 순서 = 배열 순서. 실측에 없던 항목(예약·문의 등)도 미리 넣어 뒀다 —
 * 병원이 픽셀 이벤트를 제대로 심으면 코드 수정 없이 바로 이름이 붙어 나온다.
 */
export const META_ACTION_SPECS: readonly MetaActionSpec[] = [
  // ── 광고 반응 ────────────────────────────────────────────────
  { actionType: 'link_click', label: '링크 클릭', group: 'ad' },
  {
    actionType: 'post_engagement',
    label: '게시물 참여',
    group: 'ad',
    // page_engagement 는 값이 동일. 참여는 링크 클릭까지 포함하는 상위 개념이라
    // 화면에서 링크 클릭과 나란히 둬서 "소셜 반응이 많다"는 오해를 막는다.
    aliases: ['page_engagement'],
  },
  {
    actionType: 'post_reaction',
    label: '반응(좋아요 등)',
    group: 'ad',
    // post_reaction − post_unlike = post_net_like (실측 45 − 6 = 39). 총량 하나만 쓴다.
    aliases: ['onsite_conversion.post_net_like', 'onsite_conversion.post_unlike'],
  },
  {
    actionType: 'onsite_conversion.post_save',
    label: '게시물 저장',
    group: 'ad',
    aliases: ['onsite_conversion.post_net_save'],
  },
  { actionType: 'video_view', label: '동영상 조회', group: 'ad' },
  {
    actionType: 'onsite_conversion.messaging_conversation_started_7d',
    label: 'DM 문의 시작',
    group: 'ad',
  },
  {
    actionType: 'onsite_conversion.messaging_block',
    label: 'DM 차단',
    group: 'ad',
    negative: true,
  },

  // ── 웹사이트(픽셀) ───────────────────────────────────────────
  {
    actionType: 'landing_page_view',
    label: '랜딩페이지 도달',
    group: 'web',
    aliases: ['omni_landing_page_view'],
  },
  {
    actionType: 'offsite_conversion.fb_pixel_view_content',
    label: '콘텐츠 조회',
    group: 'web',
    aliases: [
      'view_content',
      'omni_view_content',
      'onsite_web_view_content',
      'onsite_web_app_view_content',
    ],
  },
  { actionType: 'offsite_conversion.fb_pixel_lead', label: '문의(리드)', group: 'web' },
  { actionType: 'offsite_conversion.fb_pixel_schedule', label: '예약', group: 'web' },
  { actionType: 'offsite_conversion.fb_pixel_contact', label: '연락', group: 'web' },
  {
    actionType: 'offsite_conversion.fb_pixel_complete_registration',
    label: '가입 완료',
    group: 'web',
  },
];

/**
 * 의미가 겹치거나 값이 서로 안 맞아 화면에 올리지 않는 Meta 내부 집계 변형.
 * (실측에서 post_interaction_net 73 > post_interaction_gross 67 로 역전돼 신뢰할 수 없다)
 */
const META_NOISE_ACTIONS: ReadonlySet<string> = new Set([
  'post',
  'post_interaction_gross',
  'post_interaction_net',
]);

const SPEC_BY_TYPE = new Map<string, MetaActionSpec>();
const ALIAS_OF = new Map<string, string>();
for (const spec of META_ACTION_SPECS) {
  SPEC_BY_TYPE.set(spec.actionType, spec);
  for (const a of spec.aliases ?? []) ALIAS_OF.set(a, spec.actionType);
}

/** 대표 action_type 의 표시명. 별칭·노이즈·미등록이면 null. */
export function metaActionLabel(actionType: string): string | null {
  return SPEC_BY_TYPE.get(actionType)?.label ?? null;
}

/** 화면에서 감출 행인지 — 별칭(중복)이거나 노이즈. */
export function isRedundantMetaAction(actionType: string): boolean {
  return ALIAS_OF.has(actionType) || META_NOISE_ACTIONS.has(actionType);
}

/**
 * 표에 등록되지 않은 action_type — 병원별 커스텀 전환이다.
 * 이름을 우리가 모르므로 **원문 그대로** 별도 목록에 보여준다(임의로 번역하면 오해를 만든다).
 */
export function isCustomMetaAction(actionType: string): boolean {
  return !SPEC_BY_TYPE.has(actionType) && !isRedundantMetaAction(actionType);
}

export type MetaActionTotal = {
  actionType: string;
  label: string;
  group: MetaMetricGroup;
  total: number;
  negative: boolean;
  /** 표에 없는 커스텀 전환 — 라벨이 원문이라는 표시 */
  custom: boolean;
};

/**
 * (action_type, count) 목록을 화면용으로 정리한다.
 *  - 별칭·노이즈 제거
 *  - 등록된 것은 META_ACTION_SPECS 순서, 커스텀은 그 뒤에 큰 순서
 *  - 값이 0인 등록 항목은 버린다(픽셀 미설정 병원에서 빈 줄이 깔리는 걸 막음)
 */
export function summarizeMetaActions(
  rows: readonly { action_type: string; action_count: number | string | null }[],
): { ad: MetaActionTotal[]; web: MetaActionTotal[]; custom: MetaActionTotal[] } {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const t = String(r.action_type ?? '').trim();
    if (!t || isRedundantMetaAction(t)) continue;
    totals.set(t, (totals.get(t) ?? 0) + Number(r.action_count ?? 0));
  }

  const known: MetaActionTotal[] = [];
  for (const spec of META_ACTION_SPECS) {
    const total = totals.get(spec.actionType);
    if (total == null || total === 0) continue;
    known.push({
      actionType: spec.actionType,
      label: spec.label,
      group: spec.group,
      total,
      negative: spec.negative === true,
      custom: false,
    });
    totals.delete(spec.actionType);
  }

  const custom: MetaActionTotal[] = [...totals.entries()]
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([actionType, total]) => ({
      actionType,
      label: actionType,
      group: 'web' as MetaMetricGroup,
      total,
      negative: false,
      custom: true,
    }));

  return {
    ad: known.filter((k) => k.group === 'ad'),
    web: known.filter((k) => k.group === 'web'),
    custom,
  };
}

/** 깔때기 단계 — 노출→클릭→랜딩 도달→(대표 웹 전환). 단계별 전환율은 화면에서 계산. */
export const META_FUNNEL_WEB_STEP_PRIORITY: readonly string[] = [
  'offsite_conversion.fb_pixel_schedule',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb_pixel_contact',
  'offsite_conversion.fb_pixel_view_content',
];
