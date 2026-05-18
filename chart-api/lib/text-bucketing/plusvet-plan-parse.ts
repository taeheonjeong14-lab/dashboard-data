/**
 * PlusVet Plan 표: 항목·용법은 treatment_prescription 하나로 합침.
 * code·route 없음. Qty→qty, 단위→unit, 일투→day, 일수/사용량→total(둘 다 있으면 "일수/사용량"), 담당의→sign_id.
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

function normalizeLine(s: string) {
  return s.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 토큰 전체가 숫자(정수·소수)만인 경우 (Qty 등). 0.3% 같은 건 제외 */
function isPureNumberToken(t: string): boolean {
  return /^[0-9]+(?:[.,][0-9]+)?$/.test(t);
}

function shouldSkipPlusVetPlanLine(t: string): boolean {
  if (!t) return true;
  if (/^plan$/i.test(t)) return true;
  if (/^\d+\s*\/\s*\d+번\s*그룹/.test(t)) return true;
  if (/^새\s*그룹$/.test(t)) return true;
  // 한 줄 통합 헤더 (용법 or 경로 column)
  if (/항목/.test(t) && (/용법/.test(t) || /경로/.test(t)) && /qty/i.test(t)) return true;
  // PDF에서 컬럼 헤더가 한 줄씩 분리되어 있는 경우
  if (/^(항목|경로|qty|단위|일투|일수|사용량|담당의)$/i.test(t)) return true;
  return false;
}

/** 숫자만인 토큰이 하나도 없으면 윗줄 항목명 이어쓰기 */
function lineHasPureNumberToken(t: string): boolean {
  return t.split(/\s+/).filter(Boolean).some(isPureNumberToken);
}

function mergePlusVetPlanContinuations(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = normalizeLine(line);
    if (!t) continue;
    if (shouldSkipPlusVetPlanLine(t)) continue;
    const hasNum = lineHasPureNumberToken(t);
    if (!hasNum) {
      // 숫자 없는 줄: 이름(또는 이름 이어쓰기)
      if (out.length > 0 && !lineHasPureNumberToken(out[out.length - 1] ?? '')) {
        // 직전 줄도 숫자 없으면 이어쓰기
        out[out.length - 1] = normalizeLine(`${out[out.length - 1]} ${t}`);
      } else {
        out.push(t);
      }
    } else {
      // 숫자 있는 줄: 직전 줄에 숫자가 없으면(=아직 qty 안 붙은 이름 줄) 합체
      const lastHasNum = out.length > 0 && lineHasPureNumberToken(out[out.length - 1] ?? '');
      if (!lastHasNum && out.length > 0) {
        out[out.length - 1] = normalizeLine(`${out[out.length - 1]} ${t}`);
      } else {
        out.push(t);
      }
    }
  }
  return out;
}

function parseOnePlusVetPlanRow(raw: string): PlusVetParsedPlanRow | null {
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const qtyIdx = tokens.findIndex(isPureNumberToken);
  if (qtyIdx < 0) return null;

  const treatmentPrescription = tokens.slice(0, qtyIdx).join(' ').trim();
  if (!treatmentPrescription) return null;

  const qty = tokens[qtyIdx];
  const rest = tokens.slice(qtyIdx + 1);
  if (rest.length === 0) {
    return {
      code: '',
      treatmentPrescription,
      qty,
      unit: '',
      day: '',
      total: '',
      route: '',
      signId: '',
      raw,
    };
  }

  let unit = '';
  let r = rest.slice();
  if (!isPureNumberToken(r[0])) {
    unit = r[0];
    r = r.slice(1);
  }

  const nums: string[] = [];
  while (r.length > 0 && isPureNumberToken(r[0])) {
    nums.push(r.shift()!);
  }

  const signId = r.join(' ').trim();

  let day = '';
  let total = '';
  if (nums.length >= 1) day = nums[0];
  if (nums.length === 2) total = nums[1];
  if (nums.length >= 3) total = `${nums[1]}/${nums[2]}`;

  return {
    code: '',
    treatmentPrescription,
    qty,
    unit,
    day,
    total,
    route: '',
    signId,
    raw,
  };
}

export function parsePlusVetPlanRows(planText: string): PlusVetParsedPlanRow[] {
  const lines = planText.split(/\r?\n/).map((l) => normalizeLine(l));
  const merged = mergePlusVetPlanContinuations(lines);
  const rows: PlusVetParsedPlanRow[] = [];
  for (const raw of merged) {
    const row = parseOnePlusVetPlanRow(raw);
    if (row) rows.push(row);
  }
  return rows;
}
