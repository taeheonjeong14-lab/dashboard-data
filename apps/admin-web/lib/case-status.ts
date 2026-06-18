// 진료케이스(블로그)·건강검진 진행 상태 — 차트 목록/상세 배지 + 필터 공용.
// 블로그: 요청(작성 전) → 작성중(작성 시작~확정 전) → 완료(확정)
// 검진: 요청(리포트 생성 전) → 완료(생성 후)
export type BlogStage = 'none' | 'requested' | 'writing' | 'done';
export type HealthStage = 'none' | 'requested' | 'done';

const BLOG_GEN_TYPES = ['blog_causal', 'blog_detail', 'blog_outline', 'blog_post'];

/** types = 그 run 의 generated_run_content content_type 집합, blogConfirmed = blog_post.payload.confirmed */
export function computeBlogStage(types: Set<string>, blogConfirmed: boolean): BlogStage {
  if (!types.has('blog_case')) return 'none';
  if (blogConfirmed) return 'done';
  if (BLOG_GEN_TYPES.some((t) => types.has(t))) return 'writing';
  return 'requested';
}
export function computeHealthStage(types: Set<string>): HealthStage {
  if (types.has('health_checkup')) return 'done';
  if (types.has('hospital_notes')) return 'requested';
  return 'none';
}

export const BLOG_STAGE_LABEL: Record<Exclude<BlogStage, 'none'>, string> = {
  requested: '블로그 요청',
  writing: '블로그 작성중',
  done: '블로그 완료',
};
export const HEALTH_STAGE_LABEL: Record<Exclude<HealthStage, 'none'>, string> = {
  requested: '검진리포트 요청',
  done: '검진리포트 완료',
};

// 배지 색 규칙 (모든 화면 공통):
//  배경 = 카테고리 (블로그 초록 / 검진리포트 파랑), 글자 = 단계 (요청 빨강 / 작성중 주황 / 완료 파랑)
export type BadgeCategory = 'blog' | 'health';
type StageKey = 'requested' | 'writing' | 'done';
const CATEGORY_BG: Record<BadgeCategory, string> = {
  blog: 'rgba(16,185,129,0.16)',   // 초록 배경
  health: 'rgba(59,130,246,0.16)', // 파랑 배경
};
const STAGE_COLOR: Record<StageKey, string> = {
  requested: '#dc2626', // 빨강
  writing: '#ea580c',   // 주황
  done: '#2563eb',      // 파랑
};
export function badgeStyle(category: BadgeCategory, stage: StageKey): { background: string; color: string } {
  return { background: CATEGORY_BG[category], color: STAGE_COLOR[stage] };
}

// 필터용 — 타입(블로그/검진리포트), 단계(요청/작성중/완료)
export const TYPE_FILTERS = ['블로그', '검진리포트'] as const;
export const STAGE_FILTERS = ['요청', '작성중', '완료'] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];
export type StageFilter = (typeof STAGE_FILTERS)[number];

const BLOG_STAGE_TO_FILTER: Record<Exclude<BlogStage, 'none'>, StageFilter> = {
  requested: '요청', writing: '작성중', done: '완료',
};
const HEALTH_STAGE_TO_FILTER: Record<Exclude<HealthStage, 'none'>, StageFilter> = {
  requested: '요청', done: '완료',
};

/** run 이 가진 타입 facet */
export function runTypes(blog: BlogStage, health: HealthStage): TypeFilter[] {
  const out: TypeFilter[] = [];
  if (blog !== 'none') out.push('블로그');
  if (health !== 'none') out.push('검진리포트');
  return out;
}
/** run 이 가진 단계 facet */
export function runStages(blog: BlogStage, health: HealthStage): StageFilter[] {
  const out = new Set<StageFilter>();
  if (blog !== 'none') out.add(BLOG_STAGE_TO_FILTER[blog]);
  if (health !== 'none') out.add(HEALTH_STAGE_TO_FILTER[health]);
  return [...out];
}
