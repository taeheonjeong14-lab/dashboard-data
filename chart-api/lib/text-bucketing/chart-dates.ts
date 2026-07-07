import type { ChartKind } from '@/lib/text-bucketing/chart-kind';

/** IntoVet 방문 앵커(대괄호 날짜 등) + 일반적인 OCR 변형 */
export function isVisitContextLine(text: string) {
  const canonicalBracketed =
    /\[\s*20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s*\]/;
  if (canonicalBracketed.test(text)) {
    return true;
  }

  const broadVariants =
    /\[?\s*(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?)\s+[0-2]?\d:[0-5]\d(?::[0-5]\d)?\s*\]?/;
  return broadVariants.test(text);
}

export function extractIntoVetDateTime(text: string) {
  const match = text.match(/\[\s*(20\d{2}-\d{1,2}-\d{1,2}\s+[0-2]?\d:[0-5]\d:[0-5]\d)\s*\]/);
  if (match?.[1]) return match[1];
  const broad = text.match(/(20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+[0-2]?\d:[0-5]\d(?::[0-5]\d)?)/);
  return broad?.[1] ?? null;
}

function normalizeYmdParts(y: string, mo: string, d: string) {
  const m = String(Number.parseInt(mo, 10)).padStart(2, '0');
  const day = String(Number.parseInt(d, 10)).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Lab 묶음 날짜 키 (인투벳·플러스벳·이프렌즈 공통).
 * - 시간 있음: `yyyy-mm-dd` + (오전|오후)? + `hh:mm` 등 — 원문 구분자 유지
 * - **날짜만** (줄 전체): `YYYY-MM-DD`로 정규화 (이프렌즈 Laboratory date 앵커 등)
 */
export function extractLabDateTime(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = normalized.match(
    /\[?\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s*(?:(오전|오후|am|pm)\s*)?([0-2]?\d:[0-5]\d(?::[0-5]\d)?)\s*\]?/i,
  );
  if (match) {
    return `${match[1]} ${match[2] ? `${match[2]} ` : ''}${match[3]}`.trim();
  }
  const dateOnly = normalized.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s*$/);
  if (dateOnly) {
    return normalizeYmdParts(dateOnly[1] ?? '', dateOnly[2] ?? '', dateOnly[3] ?? '');
  }
  // 우리엔 lab 앵커: "2025-05-22 Sign : 김진욱" (시각 없이 날짜 + 서명) → 날짜만 인정.
  const dateSign = normalized.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s+.*?\bSign\b\s*[:：]/i);
  if (dateSign) {
    return normalizeYmdParts(dateSign[1] ?? '', dateSign[2] ?? '', dateSign[3] ?? '');
  }
  return null;
}

/**
 * 플러스벳 "진단 검사 결과" 구간에서 검사 시각 줄만 인정 (줄 **시작**이 날짜+시각).
 * 제목 직후 반복되는 기본정보 줄이 lab으로 들어가지 않게 한다.
 */
export function extractPlusVetLabSectionAnchorDateTime(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const m = normalized.match(
    /^(?:\[)?\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s+(?:(오전|오후|am|pm)\s*)?([0-2]?\d:[0-5]\d(?::[0-5]\d)?)\b/i,
  );
  if (!m) return null;
  const mer = m[2] ? `${m[2]} ` : '';
  return `${m[1]} ${mer}${m[3]}`.trim();
}

function matchPlusVetDatetimePipeRest(text: string): { line: string; dateTime: string; afterFirstPipe: string } | null {
  const line = text.replace(/\s+/g, ' ').trim();
  const m = line.match(
    /^(?:\[)?\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*\|\s*(.+)$/i,
  );
  if (!m) return null;
  return { line, dateTime: m[1].trim(), afterFirstPipe: m[2].trim() };
}

/**
 * `2026.01.30 14:54 | Serum Analysis (Serum Analysis) | V200` 처럼
 * 진단 검사 결과 블록 없이 기계검사만 이어지는 PlusVet 출력용 lab 헤더.
 * 차트 방문 줄(`… | 재진 | …`)은 제외.
 */
export function isPlusVetLabMachinePanelHeaderLine(text: string): boolean {
  const hit = matchPlusVetDatetimePipeRest(text);
  if (!hit) return false;
  if (/^(재진|초진|예진|응급|검진|당일|복진|외래)(?![가-힣])/.test(hit.afterFirstPipe)) return false;
  if (/\bAnalysis\b/i.test(hit.line)) return true;
  if (/\bCBC\b/i.test(hit.line)) return true;
  if (/Biochemical/i.test(hit.line)) return true;
  if (/Blood\s+Gas/i.test(hit.line)) return true;
  if (/\bKit\b/i.test(hit.line)) return true;
  return false;
}

/**
 * PlusVet lab 패널 헤더 3번째 형태: `검사유형(한글명) | 장비명`.
 *  예) `Serum Analysis(혈청 분석) | V200`, `Biochemical Analysis(생화학 분석) | Catalyst One`, `CBC(전혈구 검사) | ProCyte One`
 * 날짜시각도 '진단 검사 결과' 제목도 없이 곧장 패널이 시작되는(본문 없는 혈검-only) 차트용.
 * 파이프 "앞"(검사유형명)에 패널 키워드가 있어야 하고, 뒤가 방문유형이면 제외한다.
 * (데이터 행 `MPV … (fL) | 11.5` 는 파이프 앞에 패널 키워드가 없어 자연 제외)
 */
export function isPlusVetLabPanelTitleLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  const pipe = t.indexOf('|');
  if (pipe < 0) return false;
  const before = t.slice(0, pipe);
  const after = t.slice(pipe + 1).trim();
  if (!after) return false;
  if (/^(재진|초진|예진|응급|검진|당일|복진|외래)(?![가-힣])/.test(after)) return false;
  return /\bCBC\b|\bAnalysis\b|Biochemical|Blood\s*Gas|\bKit\b|Electrolyte|Urine|전혈구|혈청\s*분석|생화학\s*분석|요\s*검사|전해질/i.test(before);
}

/** PlusVet 차트 본문 방문 헤더 — lab 구간을 끊고 chartBody로 복귀 */
export function isPlusVetChartVisitHeaderLine(text: string): boolean {
  const hit = matchPlusVetDatetimePipeRest(text);
  if (!hit) return false;
  return /^(재진|초진|예진|응급|검진|당일|복진|외래)(?![가-힣])/.test(hit.afterFirstPipe);
}

/**
 * PlusVet 차트 본문을 진료(visit)별로 나눌 때의 그룹 키.
 * **진료 헤더(`DATE TIME | 재진 | 담당의`) 줄에서만** 날짜를 추출한다.
 * 본문 안에 섞인 랩/영상 시각·노트 속 날짜로 한 진료가 여러 그룹으로 쪼개지는 것을 막는다.
 */
export function extractPlusVetVisitDateKey(text: string): string | null {
  const hit = matchPlusVetDatetimePipeRest(text);
  if (!hit) return null;
  if (!/^(재진|초진|예진|응급|검진|당일|복진|외래)(?![가-힣])/.test(hit.afterFirstPipe)) return null;
  return hit.dateTime;
}

/**
 * 우리엔PMS: 날짜+시각 단독 줄을 **형식 무관**으로 잡아 24시간 `YYYY-MM-DD HH:MM`로 정규화.
 * 대응 형식:
 *  - `2024-10-26 10:07` (구분자 ./-, 초 없음)
 *  - `2026-03-31 오전 10:41:53 [일반]` (오전/오후·초·`[유형]` 태그)
 *  - EXIF 영상시각 `2004.10.25 10:23:48` 등도 매칭됨 → 방문 키 여부는 호출부의 "다음 줄 Subjective" 로 판별.
 */
// 엄격: 꼬리는 줄끝 / [유형] 태그 / "부서 Sign : 담당자"(Sign 앞 토큰 필요). 기본정보 종료 판정에 사용.
const WOORIEN_VISIT_DATE_STRICT =
  /^(?:\[)?\s*(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s+(?:(오전|오후|am|pm)\s*)?([0-2]?\d):([0-5]\d)(?::[0-5]\d)?\s*(?:\]|\[[^\]]*\])?\s*(?:\S.*?\bSign\b\s*[:：].*)?\s*$/i;
// 느슨: 시각 바로 뒤 "Sign : 담당자"(부서 없이 서명만)도 허용. 차트본문 날짜 그룹핑 전용.
const WOORIEN_VISIT_DATE_LOOSE =
  /^(?:\[)?\s*(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\s+(?:(오전|오후|am|pm)\s*)?([0-2]?\d):([0-5]\d)(?::[0-5]\d)?\s*(?:\]|\[[^\]]*\])?\s*(?:.*?\bSign\b\s*[:：].*)?\s*$/i;

function normalizeWoorienVisitMatch(m: RegExpMatchArray): string {
  let hour = Number.parseInt(m[5] ?? '0', 10);
  const mer = (m[4] ?? '').toLowerCase();
  if ((mer === '오후' || mer === 'pm') && hour < 12) hour += 12;
  if ((mer === '오전' || mer === 'am') && hour === 12) hour = 0;
  const date = normalizeYmdParts(m[1] ?? '', m[2] ?? '', m[3] ?? '');
  return `${date} ${String(hour).padStart(2, '0')}:${m[6]}`;
}

export function extractWoorienLooseVisitDateTime(text: string): string | null {
  const m = text.replace(/\s+/g, ' ').trim().match(WOORIEN_VISIT_DATE_STRICT);
  return m ? normalizeWoorienVisitMatch(m) : null;
}

/**
 * 차트 본문 날짜 그룹핑 전용 우리엔 방문 시각 추출.
 * `extractWoorienLooseVisitDateTime`(기본정보 종료 판정용, 엄격)과 달리
 * "2026-05-01 14:07 Sign : 이주원"처럼 **시각 바로 뒤 서명만** 있는 줄도 방문으로 인식한다.
 * (기본정보 판정에는 영향 없음 — 그쪽은 계속 엄격 버전 사용)
 */
export function extractWoorienChartBodyVisitDate(text: string): string | null {
  const m = text.replace(/\s+/g, ' ').trim().match(WOORIEN_VISIT_DATE_LOOSE);
  return m ? normalizeWoorienVisitMatch(m) : null;
}

/** 차트 본문을 날짜별로 나눌 때 사용하는 앵커 */
export function extractChartBodyDateKey(text: string, kind: ChartKind): string | null {
  if (kind === 'woorien_pms') return extractWoorienLooseVisitDateTime(text);
  const iv = extractIntoVetDateTime(text);
  if (kind === 'intovet') return iv;
  return iv ?? extractLabDateTime(text);
}

function normalizeYmdDateOnly(text: string): string | null {
  const m = text.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (!m) return null;
  return normalizeYmdParts(m[1] ?? '', m[2] ?? '', m[3] ?? '');
}

export function extractEfriendsVisitDateKey(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const labeled = t.match(/^date\s*:\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\b/i);
  if (labeled?.[1]) {
    return normalizeYmdDateOnly(labeled[1]);
  }
  const soap = t.match(/^(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s*[SOP]\)/i);
  if (soap?.[1]) {
    return normalizeYmdDateOnly(soap[1]);
  }
  return null;
}
