import type { OcrRow } from '@/lib/google-vision';

export type OrderedLine = { page: number; text: string };
export type BucketedLine = {
  page: number;
  text: string;
  corrected: boolean;
  originalText?: string;
};

/**
 * 라틴 글자로 착각하기 쉬운 그리스·키릴 글자 → 라틴 치환표.
 *
 * 전사 LLM 에게 "라틴/한글만 쓰라"고 지시(SCRIPT RULES)해도 같은 자리에서 계속 새기 때문에
 * 확정적으로 되돌린다. 실제 피해는 이름 오염보다 **중복 제거 실패**가 크다 — 전사가 같은 줄을
 * 두 번 뱉을 때 한쪽만 그리스 문자면(WBC-MONO% / WBC-MONΟ%) 문자열이 달라 중복이 안 합쳐지고
 * 검사 항목이 두 줄로 남는다.
 *
 * 의학에서 실제로 쓰는 그리스 문자(α2-agonist, β-lactam, μ 마이크로 등)는 넣지 않는다.
 */
const CONFUSABLE_TO_LATIN: Record<string, string> = {
  // 그리스 대문자
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M',
  'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  // 그리스 소문자 중 라틴과 혼동되는 것만
  'ο': 'o',
  // 키릴 대문자
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P',
  'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',
  // 키릴 소문자
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
};

const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE_TO_LATIN).join('')}]`, 'g');

/** 전사 결과에서 라틴 동음이형 글자를 라틴으로 되돌린다. 한글·숫자·진짜 그리스 문자는 건드리지 않는다. */
export function normalizeConfusableScripts(text: string): string {
  return text.replace(CONFUSABLE_RE, (ch) => CONFUSABLE_TO_LATIN[ch] ?? ch);
}

/** 대소문자·기호를 버린 비교용 키. 대시는 사라지므로 "NIT 1 1" 과 "NIT 1 1 -" 이 같은 키가 된다. */
function alnumKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 전사(LLM)가 옮긴 줄을 **PDF 텍스트 레이어 원문**으로 바로잡는다.
 *
 * 전사 모델은 표의 칸 기호를 양쪽으로 틀린다.
 *  · 빠뜨림: 마지막 칸의 단독 대시("-"=음성 결과)를 흘려 검사 결과가 사라진다("NIT 1 1").
 *  · 지어냄: 빈 칸마다 대시를 채워 값을 오염시킨다("LEU Leu/uL - - - +++500" -> 값 "---+++500").
 * 프롬프트로는 어느 쪽도 못 막는다 — 한쪽을 조이면 반대쪽이 터진다. 원문 대조가 답이다.
 *
 * 규칙은 하나다: **같은 페이지에서 영숫자만 남긴 내용이 완전히 같은 줄**이 텍스트 레이어에 있으면
 * 그 원문으로 갈아끼운다. 글자·숫자가 똑같으니 같은 줄인 게 확실하고, 다른 건 기호·공백뿐이다.
 * 줄을 새로 만들거나 지우지는 않는다 — 키가 안 맞으면(합쳐지거나 쪼개진 줄, 래스터 이미지 박스에서
 * 온 줄) 그대로 둔다. 같은 키에 서로 다른 원문이 여럿이면 애매하므로 건너뛴다.
 */
export function correctLinesWithTextLayer<T extends { page: number; text: string }>(
  lines: T[],
  textLayerLines: OrderedLine[] | null | undefined,
): T[] {
  if (!textLayerLines || textLayerLines.length === 0) return lines;

  const byKey = new Map<string, string | null>(); // null = 같은 키에 다른 원문 여럿(애매) -> 건너뜀
  for (const src of textLayerLines) {
    const text = (src.text ?? '').trim();
    const key = alnumKey(text);
    // 너무 짧은 키("1", "-")는 아무 줄에나 걸린다 — 대조 근거로 삼지 않는다.
    if (key.length < 4) continue;
    const id = `${src.page} ${key}`;
    const prev = byKey.get(id);
    if (prev === undefined) byKey.set(id, text);
    else if (prev !== null && prev !== text) byKey.set(id, null);
  }
  if (byKey.size === 0) return lines;

  return lines.map((line) => {
    const text = (line.text ?? '').trim();
    const key = alnumKey(text);
    if (key.length < 4) return line;
    const original = byKey.get(`${line.page} ${key}`);
    if (!original || original === text) return line;
    return { ...line, text: original };
  });
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((v) => v.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean);
}

function overlapScore(a: string, b: string) {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(aSet.size, bSet.size);
}

function containsNumericSignal(text: string) {
  return /\d/.test(text);
}

function normalizeLoose(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s./%\-~]/gu, '').replace(/\s+/g, ' ').trim();
}

export function minimalOcrCorrection(line: OrderedLine, rows: OcrRow[]): BucketedLine {
  const candidates = rows.filter((row) => row.page === line.page);
  if (candidates.length === 0 || !containsNumericSignal(line.text)) {
    return { page: line.page, text: line.text, corrected: false };
  }

  let best = line.text;
  let bestScore = 0;
  for (const row of candidates) {
    const score = overlapScore(line.text, row.text);
    if (score > bestScore) {
      bestScore = score;
      best = row.text;
    }
  }

  // 글자·숫자가 완전히 같으면 OCR 이 고쳐 줄 내용이 없다 — 차이는 기호·공백뿐이다.
  // 이때 갈아끼우면 오히려 **의미 있는 기호를 잃는다**: Vision 이 표 마지막 칸의 단독 대시
  // ("-"=음성 결과)를 자주 못 읽어서, 텍스트 레이어로 복원해 둔 "NIT 1 1 -" 가 OCR 의
  // "NIT 1 1" 로 되돌아갔다(그 항목이 리포트에서 통째로 사라진다).
  // OCR 보정의 목적은 오독한 글자·숫자를 바로잡는 것이고, 그건 키가 달라진다.
  if (alnumKey(best) === alnumKey(line.text)) {
    return { page: line.page, text: line.text, corrected: false };
  }

  if (bestScore >= 0.9 && normalizeLoose(best) !== normalizeLoose(line.text)) {
    return {
      page: line.page,
      text: best,
      corrected: true,
      originalText: line.text,
    };
  }

  return { page: line.page, text: line.text, corrected: false };
}
