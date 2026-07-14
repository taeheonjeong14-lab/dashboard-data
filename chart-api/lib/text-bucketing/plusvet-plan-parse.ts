/**
 * PlusVet Plan 표 파서.
 * 항목·용법은 treatment_prescription 하나로 합치고, 경로(PO/IV…)·용량(qty)·단위·일투/일수/사용량·담당의를 분리한다.
 *
 * 입력 포맷이 두 가지다:
 *  - 가로(텍스트레이어): 한 줄에 "항목 ... qty 단위 일수 담당의" 가 전부 들어 있음.
 *  - 세로(스캔 OCR):     칸마다 한 줄씩("진료/진찰비-초진" / "1" / "회" / "1" / "최경식").
 * 두 포맷을 동일하게 처리하기 위해 모든 줄을 토큰 스트림으로 펼친 뒤 레코드 경계를 재구성한다.
 */

export type PlusVetParsedPlanRow = {
  code: string;
  treatmentPrescription: string;
  qty: string;
  unit: string;
  day: string;
  total: string;
  route: string;
  signId: string;
  raw: string;
};

/** 투여 경로(담당의·항목명과 구분하기 위한 화이트리스트). 단독 토큰일 때만 경로로 본다. */
const ROUTE_TOKEN = /^(PO|IV|IM|SC|SQ|IH|IO|ID|IN|IP|PR|SL|TOP|OU|OD|OS|AU|AD|AS|CRI|NEB)$/i;

/** 단위(회/EA/ml…). 용량(qty) 칸이 비어 있는 표에서 레코드 경계를 잡는 유일한 단서다. */
const UNIT_TOKEN = /^(회|EA|ea|개|매|포|정|캡슐|팩|앰플|amp|vial|바이알|T|ml|mL|cc|L|mg|g|kg|ug|mcg|IU|unit|units|일|병|set|SET)$/;

/** 담당의 — 짧은 한글 사람 이름. */
function isSignIdToken(t: string): boolean {
  return /^[가-힣]{2,4}$/.test(t);
}
function isUnitToken(t: string): boolean {
  return UNIT_TOKEN.test(t);
}

function normalizeLine(s: string) {
  return s.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 토큰 전체가 숫자(정수·소수)만인 경우 (Qty 등). 0.3% 같은 건 제외 */
function isPureNumberToken(t: string): boolean {
  return /^[0-9]+(?:[.,][0-9]+)?$/.test(t);
}

function isRouteToken(t: string): boolean {
  return ROUTE_TOKEN.test(t);
}

function shouldSkipPlusVetPlanLine(t: string): boolean {
  if (!t) return true;
  if (/^plan$/i.test(t)) return true;
  if (/^\d+\s*\/\s*\d+번\s*그룹/.test(t)) return true;
  if (/^새\s*그룹$/.test(t)) return true;
  // 한 줄 통합 헤더 (용법 or 경로 column)
  if (/항목/.test(t) && (/용법/.test(t) || /경로/.test(t)) && /qty/i.test(t)) return true;
  // 한국어 컬럼 헤더가 한 줄에 통으로 있는 경우 — 모든 토큰이 헤더 키워드면 헤더로 본다.
  // 예: "항목 경로 용량 단위 일투 일수 사용량 담당의" (qty 가 없어 위 조건엔 안 걸리던 형태)
  {
    const ws = t.split(/\s+/).filter(Boolean);
    if (ws.length >= 3 && ws.every((w) => /^(항목|경로|용량|용법|단위|일투|일수|사용량|담당의|qty)$/i.test(w))) {
      return true;
    }
  }
  // PDF에서 컬럼 헤더가 한 줄씩 분리되어 있는 경우
  if (/^(항목|경로|용량|단위|일투|일수|사용량|담당의|qty)$/i.test(t)) return true;
  return false;
}

function mapNumsToDayTotal(nums: string[]): { day: string; total: string } {
  let day = '';
  let total = '';
  if (nums.length >= 1) day = nums[0];
  if (nums.length === 2) total = nums[1];
  if (nums.length >= 3) total = `${nums[1]}/${nums[2]}`;
  return { day, total };
}

export function parsePlusVetPlanRows(planText: string): PlusVetParsedPlanRow[] {
  const lines = planText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((l) => l && !shouldSkipPlusVetPlanLine(l));

  // 가로/세로 포맷을 통일: 모든 줄을 공백 기준 토큰으로 펼친다.
  const tokens: string[] = [];
  for (const line of lines) {
    for (const tk of line.split(/\s+/).filter(Boolean)) tokens.push(tk);
  }

  const rows: PlusVetParsedPlanRow[] = [];
  let i = 0;
  const n = tokens.length;

  while (i < n) {
    // 1) 항목명: 숫자·경로 토큰이 나오기 전까지 (여러 토큰을 다시 이어붙임)
    //    ★용량(qty) 칸이 비어 있는 표(숫자가 아예 없는 차트)도 있다. 그때는 숫자가 영영 안 나오므로
    //    "단위 + 담당의"(예: "회 김성준")를 레코드 꼬리로 보고 거기서 항목명을 끊는다.
    //    이게 없으면 표 전체가 항목명 하나로 뭉쳐 플랜이 한 줄로 나온다.
    const nameParts: string[] = [];
    while (i < n && !isPureNumberToken(tokens[i]) && !isRouteToken(tokens[i])) {
      if (nameParts.length > 0 && isUnitToken(tokens[i]) && i + 1 < n && isSignIdToken(tokens[i + 1])) break;
      nameParts.push(tokens[i]);
      i += 1;
    }

    // 2) 경로(PO/IV…)
    let route = '';
    if (i < n && isRouteToken(tokens[i])) {
      route = tokens[i].toUpperCase();
      i += 1;
    }

    // 이름·경로 둘 다 없이 숫자만 떠 있으면(스트림 깨짐) 한 토큰 버리고 진행 (무한루프 방지)
    if (nameParts.length === 0 && !route) {
      i += 1;
      continue;
    }

    const treatmentPrescription = nameParts.join(' ').trim();

    // 3) 용량(qty): 숫자
    let qty = '';
    if (i < n && isPureNumberToken(tokens[i])) {
      qty = tokens[i];
      i += 1;
    }

    // 4) 단위: qty 직후의 비숫자 토큰 1개 (회/mg/kg/ml…).
    //    qty 가 없어도 "단위 + 담당의" 꼬리(위 1번에서 끊은 자리)면 단위로 받는다.
    let unit = '';
    if (qty && i < n && !isPureNumberToken(tokens[i]) && !isRouteToken(tokens[i])) {
      unit = tokens[i];
      i += 1;
    } else if (!qty && i < n && isUnitToken(tokens[i]) && i + 1 < n && isSignIdToken(tokens[i + 1])) {
      unit = tokens[i];
      i += 1;
    }

    // 5) 일투/일수/사용량: 연속 숫자
    const nums: string[] = [];
    while (i < n && isPureNumberToken(tokens[i])) {
      nums.push(tokens[i]);
      i += 1;
    }

    // 6) 담당의(signId): 숫자열 뒤 첫 토큰이 "한글 이름(2~4자)"일 때만 담당의로 본다.
    //    담당의가 누락된 표(세로 분리/Gemini 변동)에서 다음 약 이름(영어/숫자/괄호로 시작)을
    //    담당의로 먹어 항목이 잘리는 것을 막는다. (담당의 = 짧은 한글 사람 이름)
    let signId = '';
    if ((qty || unit) && i < n && isSignIdToken(tokens[i])) {
      signId = tokens[i];
      i += 1;
    }

    if (!treatmentPrescription) continue;

    const { day, total } = mapNumsToDayTotal(nums);
    const raw = [treatmentPrescription, route, qty, unit, ...nums, signId].filter(Boolean).join(' ');

    rows.push({
      code: '',
      treatmentPrescription,
      qty,
      unit,
      day,
      total,
      route,
      signId,
      raw,
    });
  }

  return mergeWrappedNames(rows);
}

/**
 * 항목명이 길어 다음 줄로 접힌 경우를 되돌린다.
 * PDF 표에서 "검사-키트-개-췌장염(cPL-Canine Pancreas-" 처럼 괄호가 열린 채 끊기면
 * 이어지는 "specific Lipase)" 가 **다음 레코드의 항목명 앞**에 붙어버린다(표에선 아래 줄에 찍히므로).
 * 괄호가 안 닫힌 행이 있으면, 다음 행 앞부분에서 닫는 괄호까지를 떼어 원래 자리로 돌려준다.
 */
function mergeWrappedNames(rows: PlusVetParsedPlanRow[]): PlusVetParsedPlanRow[] {
  const open = (s: string) => (s.match(/\(/g) ?? []).length > (s.match(/\)/g) ?? []).length;

  for (let i = 0; i < rows.length - 1; i += 1) {
    const cur = rows[i];
    if (!open(cur.treatmentPrescription)) continue;
    const next = rows[i + 1];
    const parts = next.treatmentPrescription.split(/\s+/).filter(Boolean);
    const closeAt = parts.findIndex((p) => p.includes(')'));
    if (closeAt < 0) continue;
    const tail = parts.slice(0, closeAt + 1).join(' ');
    const rest = parts.slice(closeAt + 1).join(' ');
    // 다음 행이 통째로 이어짐(남는 항목명이 없음)이면 병합하지 않는다(진짜 그 행의 이름일 수 있다).
    if (!rest) continue;
    cur.treatmentPrescription = `${cur.treatmentPrescription} ${tail}`.replace(/-\s+/g, '-');
    cur.raw = [cur.treatmentPrescription, cur.route, cur.qty, cur.unit, cur.day, cur.total, cur.signId].filter(Boolean).join(' ');
    next.treatmentPrescription = rest;
    next.raw = [rest, next.route, next.qty, next.unit, next.day, next.total, next.signId].filter(Boolean).join(' ');
  }
  return rows;
}
