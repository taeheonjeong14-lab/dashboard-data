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
    const nameParts: string[] = [];
    while (i < n && !isPureNumberToken(tokens[i]) && !isRouteToken(tokens[i])) {
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

    // 4) 단위: qty 직후의 비숫자 토큰 1개 (회/mg/kg/ml…). qty가 없으면 단위도 없음.
    let unit = '';
    if (qty && i < n && !isPureNumberToken(tokens[i]) && !isRouteToken(tokens[i])) {
      unit = tokens[i];
      i += 1;
    }

    // 5) 일투/일수/사용량: 연속 숫자
    const nums: string[] = [];
    while (i < n && isPureNumberToken(tokens[i])) {
      nums.push(tokens[i]);
      i += 1;
    }

    // 6) 담당의(signId): 숫자열 뒤 첫 비숫자 토큰. (다음 레코드 항목명과의 경계 = 매 행의 담당의)
    let signId = '';
    if (qty && i < n && !isPureNumberToken(tokens[i]) && !isRouteToken(tokens[i])) {
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

  return rows;
}
