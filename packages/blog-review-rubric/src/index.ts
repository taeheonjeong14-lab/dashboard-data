/**
 * @dashboard/blog-review-rubric — 블로그 글 검수의 단일 소스.
 * 루브릭 10항목 · 심각도 정의 · 결정적 목표값 · 신호등 규칙 · 리뷰어/집계 프롬프트.
 * chart-api(검수 엔진)와 admin-web(결과 화면·평가 기준 보기)이 함께 소비한다.
 * 설계 문서: docs/blog-review-spec.md
 */
export * from './types';
export * from './rubric';
export * from './metrics';
export * from './lights';
export * from './prompts';
