import type { CSSProperties } from 'react';
import { CATEGORY_BADGE_BG, CATEGORY_WORD, STAGE_WORD, STAGE_COLOR, type BadgeCategory, type StageKey } from '@/lib/case-status';

// 차트 목록·상세·진료케이스 메뉴 공용 상태 배지.
// 배경 = 카테고리(블로그 노랑 / 검진리포트 파랑), 단계 '단어'에만 색(요청 빨강/작성중 주황/작성완료 초록/저장완료·완료 파랑).
export function StatusBadge({ category, stage, style }: { category: BadgeCategory; stage: StageKey; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
        verticalAlign: 'middle', color: 'var(--text-secondary)', background: CATEGORY_BADGE_BG[category],
        ...style,
      }}
    >
      {CATEGORY_WORD[category]} <span style={{ color: STAGE_COLOR[stage] }}>{STAGE_WORD[stage]}</span>
    </span>
  );
}
