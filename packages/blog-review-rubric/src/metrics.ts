/**
 * 결정적 SEO 지표 계산 — LLM 없이 코드로 산출(싸고 안정적).
 * 대표키워드 도출·본문 텍스트 지표·제목 포함 판정. 설계: docs/blog-review-spec.md
 */
import { METRIC_SPECS, metricSpec } from './rubric';
import type { Keyword, MetricStatus, ReviewInput, SeoMetric } from './types';

/** 종 원문(개/견/강아지, 고양이/묘/냥 등) → 보호자 검색어 표현. 미상은 빈 문자열. */
export function speciesWord(raw: string | null | undefined): string {
  const s = String(raw ?? '').toLowerCase();
  if (/고양이|feline|cat|묘|냥/.test(s)) return '고양이';
  if (/개|dog|canine|견|강아지/.test(s)) return '강아지';
  return '';
}

/**
 * 내부 글 대표키워드 자동 도출 = 종 + 주질환명.
 * 예: species '개' + mainDisease '슬개골 탈구' → { full:'강아지 슬개골 탈구', core:'슬개골 탈구', species:'강아지' }.
 * 주질환명이 없으면 null(외부처럼 밀도는 LLM 판단으로 넘긴다).
 */
export function deriveInternalKeyword(
  species: string | null | undefined,
  mainDisease: string | null | undefined,
): Keyword | null {
  const core = String(mainDisease ?? '').trim();
  if (!core) return null;
  const sp = speciesWord(species);
  const full = sp ? `${sp} ${core}` : core;
  return { full, core, species: sp };
}

/** 마크다운/HTML 태그·이미지 표기를 걷어낸 "보이는 본문" 글자 수(공백 포함). */
export function visibleCharCount(bodyText: string): number {
  const stripped = String(bodyText ?? '')
    .replace(/\[사진:[^\]]*\]/g, '') // [사진: 설명] 표기 제거
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // ![alt](url)
    .replace(/<[^>]+>/g, '') // HTML 태그
    .replace(/^#{1,6}\s+/gm, '') // 헤딩 마커
    .replace(/[*_`>~-]/g, ''); // 기타 마크다운 기호
  return stripped.replace(/\s+/g, ' ').trim().length;
}

/** 소제목(마크다운 ## 또는 "섹션명:" 헤딩) 개수. */
export function countHeadings(bodyText: string): number {
  const md = (String(bodyText ?? '').match(/^#{2,6}\s+\S/gm) ?? []).length;
  return md;
}

/** 문자열에서 부분문자열 등장 횟수(겹침 없음). */
export function countOccurrences(haystack: string, needle: string): number {
  const n = String(needle ?? '').trim();
  if (!n) return 0;
  let count = 0;
  let i = 0;
  const h = String(haystack ?? '');
  while (true) {
    const idx = h.indexOf(n, i);
    if (idx === -1) break;
    count += 1;
    i = idx + n.length;
  }
  return count;
}

/**
 * 대표키워드 밀도(%) = 핵심 term 이 본문에서 차지하는 글자 비율.
 * = (등장횟수 × core 길이) / 보이는 글자수 × 100.
 */
export function keywordDensity(bodyText: string, keyword: Keyword | null | undefined): number {
  if (!keyword?.core) return 0;
  const chars = visibleCharCount(bodyText);
  if (chars <= 0) return 0;
  const occ = countOccurrences(bodyText, keyword.core);
  return (occ * keyword.core.length) / chars * 100;
}

/** 문자열이 주어진 term 을 포함하는지(공백 무시 완화 비교). */
function includesLoose(text: string, term: string): boolean {
  const t = String(term ?? '').replace(/\s+/g, '');
  if (!t) return false;
  return String(text ?? '').replace(/\s+/g, '').includes(t);
}

function statusMetric(key: string, value: number): SeoMetric {
  const spec = metricSpec(key)!;
  return {
    key,
    label: spec.label,
    value,
    status: spec.classify(value),
    target: spec.target,
    critical: spec.isCriticalHit?.(value) ?? false,
  };
}

/**
 * 결정적 SEO 지표 스트립 계산.
 * keyword 가 있으면(내부) 밀도·제목 대표키워드 포함까지, 없으면(외부) 밀도 계열은 생략(LLM 판단).
 */
export function computeSeoMetrics(input: ReviewInput): SeoMetric[] {
  const { title, bodyText, tags, imageCount, keyword, hospitalRegion, headingCount } = input;
  const sections = typeof headingCount === 'number' ? headingCount : countHeadings(bodyText);
  const metrics: SeoMetric[] = [
    statusMetric('charCount', visibleCharCount(bodyText)),
    statusMetric('imageCount', Math.max(0, imageCount ?? 0)),
    statusMetric('titleLength', String(title ?? '').trim().length),
    statusMetric('headingCount', sections),
    statusMetric('tagCount', (tags ?? []).filter((t) => String(t).trim()).length),
  ];

  if (keyword?.core) {
    metrics.push(statusMetric('keywordDensity', round1(keywordDensity(bodyText, keyword))));
    // 제목 대표키워드 포함 = 치명 지표(없으면 검색 노출 크게 불리).
    const has = includesLoose(title, keyword.core);
    metrics.push({
      key: 'titleHasKeyword',
      label: '제목 대표키워드',
      value: has ? '포함' : '없음',
      status: has ? 'good' : 'poor',
      target: '제목에 포함',
      critical: !has,
    });
  }

  // 지역키워드(제목 또는 본문) — 병원 지역이 주어질 때만. 동물병원 지역 SEO.
  const regionCore = firstRegionToken(hospitalRegion);
  if (regionCore) {
    const inTitle = includesLoose(title, regionCore);
    const inBody = includesLoose(bodyText, regionCore);
    const has = inTitle || inBody;
    metrics.push({
      key: 'regionKeyword',
      label: '지역키워드',
      value: has ? (inTitle ? '제목 포함' : '본문 포함') : '없음',
      status: has ? 'good' : 'warn',
      target: '제목/본문 포함',
    });
  }

  return metrics;
}

/** 병원 지역(주소 앞부분)에서 검색에 쓰일 시군구/동 토큰 하나. 예: "서울특별시 강남구" → "강남". */
export function firstRegionToken(region: string | null | undefined): string {
  const r = String(region ?? '').trim();
  if (!r) return '';
  // 시군구 우선(…구/시/군), 없으면 마지막 토큰.
  const parts = r.split(/\s+/);
  const gu = parts.find((p) => /(구|군)$/.test(p));
  const base = gu ?? parts[parts.length - 1] ?? '';
  return base.replace(/(특별시|광역시|특별자치시|특별자치도|시|군|구|동)$/u, '') || base;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** METRIC_SPECS 순서대로 "숫자 지표"만(신호등 계산용). */
export function numericMetricKeys(): string[] {
  return METRIC_SPECS.map((m) => m.key);
}
