/**
 * 신호등 점등 규칙 + 최종 결과 조립. 코드가 판정을 매겨야 프롬프트/화면 전체가 일관된다.
 * 규칙: docs/blog-review-spec.md "신호등 점등 규칙".
 */
import { numericMetricKeys } from './metrics';
import type {
  AggregatorOutput,
  AxisReport,
  BlogReview,
  Finding,
  Light,
  ReviewerBreakdown,
  SeoMetric,
  SeoReport,
  SourceType,
} from './types';

/** 합의도로 findings 분리: 2/3·3/3 = 합의(표시), 1/3 = 저신뢰(참고 접힘). */
export function splitByAgreement(findings: Finding[]): { consensus: Finding[]; lowConfidence: Finding[] } {
  const consensus: Finding[] = [];
  const lowConfidence: Finding[] = [];
  for (const f of findings ?? []) {
    if (f.agreement === '1/3') lowConfidence.push(f);
    else consensus.push(f);
  }
  return { consensus, lowConfidence };
}

const isRedSeverity = (f: Finding) => f.severity === 'high' || f.severity === 'medium';

/**
 * 의학 신호등.
 * 🔴 = 합의(2/3+) high|medium ≥ 1 (틀린 내용: 사실·의학·안전 오류) → 게이트.
 * 🟡 = 위 없음 + (단일모델 high|medium 존재 or low finding ≥ 1).
 * 🟢 = findings 없음.
 */
export function computeMedicalLight(consensus: Finding[], lowConfidence: Finding[]): Light {
  if (consensus.some(isRedSeverity)) return 'red';
  const hasLow = [...consensus, ...lowConfidence].length > 0;
  if (lowConfidence.some(isRedSeverity) || hasLow) return 'yellow';
  return 'green';
}

/**
 * SEO 신호등.
 * 치명 지표(charCount<700·imageCount 0·제목 대표키워드 없음) 1개+, 결정적 poor 2개+, SEO medium+ findings 3개+ → 🔴.
 * poor 1개 / warn 다수 / SEO medium+ 1–2개 → 🟡. 그 외 🟢.
 */
export function computeSeoLight(metrics: SeoMetric[], seoConsensus: Finding[]): Light {
  const numericKeys = new Set(numericMetricKeys());
  const numeric = metrics.filter((m) => numericKeys.has(m.key));
  const poorCount = numeric.filter((m) => m.status === 'poor').length;
  const warnCount = numeric.filter((m) => m.status === 'warn').length;
  const criticalHit = metrics.some((m) => m.critical && m.status === 'poor');
  const mediumPlus = seoConsensus.filter(isRedSeverity).length;

  if (criticalHit || poorCount >= 2 || mediumPlus >= 3) return 'red';
  if (poorCount >= 1 || warnCount >= 3 || mediumPlus >= 1) return 'yellow';
  return 'green';
}

/** 게시 부적합 = 의학 신호등 red. */
export function isGated(medicalLight: Light): boolean {
  return medicalLight === 'red';
}

/** 집계 결과 + 결정적 지표 → 최종 BlogReview 조립. */
export function assembleReview(params: {
  sourceType: SourceType;
  aggregate: AggregatorOutput;
  seoMetrics: SeoMetric[];
  modelsUsed: string[];
  reviewers?: ReviewerBreakdown[];
}): BlogReview {
  const { sourceType, aggregate, seoMetrics, modelsUsed, reviewers } = params;

  const med = splitByAgreement(aggregate.medical ?? []);
  const seoSplit = splitByAgreement(aggregate.seo ?? []);

  const medical: AxisReport = {
    light: computeMedicalLight(med.consensus, med.lowConfidence),
    consensus: med.consensus,
    lowConfidence: med.lowConfidence,
  };
  const seo: SeoReport = {
    light: computeSeoLight(seoMetrics, seoSplit.consensus),
    consensus: seoSplit.consensus,
    lowConfidence: seoSplit.lowConfidence,
    metrics: seoMetrics,
  };

  return {
    sourceType,
    medical,
    seo,
    gated: isGated(medical.light),
    summary: aggregate.summary ?? '',
    modelsUsed,
    reviewers,
  };
}

/** 신호등 한국어 라벨. */
export function lightLabel(light: Light): string {
  return light === 'red' ? '미흡' : light === 'yellow' ? '주의' : '양호';
}
