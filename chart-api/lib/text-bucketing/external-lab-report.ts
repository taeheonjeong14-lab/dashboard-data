/**
 * 외부 랩(수탁 검사기관) 결과지 지원.
 *
 * 병원 차트가 아니라 KVL(코리아벳랩)·IDEXX 같은 외부 랩이 보내온 **검사 결과 보고서**다.
 * 차트와 달리 문서 전체가 사실상 검사 표 하나라, 차트사별 앵커가 없어 버킷팅이 전부
 * basicInfo 로 빨아들이고 검사 파서는 호출조차 되지 않았다(실측: KVL 6쪽 문서 전체가 basicInfo).
 *
 * 여기 규칙은 **특정 랩 전용이 아니다.** 결과지는 랩이 달라도 「항목 · 값 · 참고범위 · 단위」
 * 표라는 공통 골격을 갖고, 다른 건 로고와 헤더 문구뿐이다.
 */

/** 검사 표 헤더 — "검사항목 검사결과 참고치 [단위]" / 영문 "Test Result Reference [Unit]". */
export function isExternalLabReportTableHeaderLine(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // 한국어: 검사항목 + 검사결과 + 참고치(참고범위) 가 한 줄에. 단위는 다음 줄로 밀리는 경우가 많아 선택.
  if (/검사\s*항목/.test(t) && /검사\s*결과/.test(t) && /(참고\s*치|참고\s*범위)/.test(t)) return true;
  // 영문: Test/Item + Result + Reference.
  if (/\b(test|item)\b/i.test(t) && /\bresult\b/i.test(t) && /\breference\b/i.test(t)) return true;
  return false;
}

/** 결과지의 해설 문단 시작("코멘트" / "Comment") — 이 아래는 검사행이 아니라 설명이다. */
export function isExternalLabReportCommentHeaderLine(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return /^(코멘트|comment[s]?)\s*[:：]?$/i.test(t);
}

/** 단위 토큰 — 결과지에서 실제로 쓰이는 형태(10^6/μL, 10^6 /μL, g/dL, U/L, %, fL, pg, mmol/L …). */
const UNIT_RE =
  /(?:10\^?\d+\s*\/\s*[a-zμµ]+|[a-zμµ]+\s*\/\s*[a-zμµ]+|%|fL|pg|U\/L|IU\/L|ng\/mL|pmol\/L|mmol\/L|μg\/dL|µg\/dL|mg\/dL|g\/dL|mEq\/L|sec|℃)/i;

/** "값" 또는 "값 참고범위" 뒤에 단위로 끝나는 줄(항목명이 다음 줄로 밀린 형태). */
const VALUE_ONLY_LINE_RE = new RegExp(
  `^(-?\\d[\\d.,]*)\\s*(?:(-?\\d[\\d.,]*\\s*[~-]\\s*-?\\d[\\d.,]*)\\s*)?(${UNIT_RE.source})\\s*$`,
  'i',
);

/**
 * 문장(해설문)인가. 결과지 코멘트에는 "14~19 μg/dL", "900~1800 pmol/L" 같은 범위가 잔뜩 있어
 * 그대로 두면 가짜 검사항목이 만들어진다. 표의 행은 짧고 명사형이라 길이·문장부호로 갈린다.
 */
export function isExternalLabReportProseLine(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (t.length > 60) return true;
  // 한국어 종결어미/조사로 끝나는 서술문.
  if (/(습니다|됩니다|한다|된다|이다|있다|없다|권장|추천|필요|가능성|경우)[.,]?$/.test(t)) return true;
  return false;
}

/** 항목명만 있는 줄인가(값·참고범위·단위가 없는 짧은 이름). */
function isBareItemNameLine(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 30) return false;
  if (isExternalLabReportProseLine(t)) return false;
  if (/[~]/.test(t)) return false;
  if (VALUE_ONLY_LINE_RE.test(t)) return false;
  // 숫자로 시작하면 값 줄이다. 이름 안의 숫자(T4, RDW-SD, 10^3 아님)는 허용.
  if (/^-?\d/.test(t)) return false;
  // 최소한 글자가 있어야 한다(범례의 "-" 같은 줄 제외).
  return /[A-Za-z가-힣]/.test(t);
}

/** 결과지 머리말의 라벨 토큰(값이 뒤따라 나오는 컬럼 라벨). */
const HEADER_LABELS = [
  '차트번호',
  '검사접수일',
  '검사보고일',
  '검체채취일',
  '성별',
  '동물이름',
  '동물나이',
  '보호자',
  '동물종',
  '동물품종',
] as const;

const DATE_TOKEN_RE = /^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})$/;

function toIsoDate(token: string): string | null {
  const m = DATE_TOKEN_RE.exec(token.trim());
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

/**
 * 검체채취일(= 이 검사의 날짜)을 머리말에서 뽑는다.
 *
 * 결과지 머리말은 라벨 묶음이 먼저, 값 묶음이 뒤에 오고 **순서가 1:1로 대응**한다(KVL 실측):
 *   라벨: 차트번호 / 검사접수일 검사보고일 / 검체채취일 성별
 *   값  : 4486 2026.07.30 / 2026.07.31 2026.07.30 / NF
 * 그래서 라벨 순번으로 값을 집으면 된다 — 좌표(OCR) 없이도 복원된다.
 *
 * 순번 매칭이 날짜가 아닌 값을 집으면(레이아웃이 다른 랩) **가장 이른 날짜**로 물러선다.
 * 보통 채취 ≤ 접수 ≤ 보고 순이라 대체로 맞고, 틀려도 담당자가 고칠 수 있는 값이다.
 */
export function extractExternalLabReportCollectionDate(texts: string[]): string | null {
  // 머리말은 「라벨 줄 몇 개 → 값 줄 몇 개」 블록이 반복된다(환자 블록, 검사일자 블록…).
  // 문서 전체를 한 줄로 세면 블록 경계가 무너져 엉뚱한 값을 집는다(실측: 생년월일을 채취일로 집었다).
  type Block = { labels: string[]; values: string[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let lastWasLabel = false;

  for (const raw of texts) {
    const t = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const tokens = t.split(' ');
    const isLabelLine = tokens.every((tok) => (HEADER_LABELS as readonly string[]).includes(tok));
    if (isLabelLine) {
      if (!cur || lastWasLabel === false) {
        cur = { labels: [], values: [] };
        blocks.push(cur);
      }
      cur.labels.push(...tokens);
      lastWasLabel = true;
    } else {
      if (cur) cur.values.push(...tokens);
      lastWasLabel = false;
    }
  }

  const block = blocks.find((b) => b.labels.includes('검체채취일'));
  if (block) {
    const idx = block.labels.indexOf('검체채취일');
    // 토큰 수가 맞을 때만 순번을 믿는다(값 하나가 두 토큰인 칸이 있으면 어긋난다).
    if (block.labels.length === block.values.length) {
      const iso = toIsoDate(block.values[idx] ?? '');
      if (iso) return iso;
    }
    // 어긋나면 그 블록 안에서 가장 이른 날짜 — 채취 ≤ 접수 ≤ 보고 순이라 대체로 맞는다.
    const inBlock = block.values.map(toIsoDate).filter((d): d is string => d !== null).sort();
    if (inBlock.length > 0) return inBlock[0]!;
  }

  const dates = blocks.flatMap((b) => b.values).map(toIsoDate).filter((d): d is string => d !== null).sort();
  return dates[0] ?? null;
}

export type SplitPairInput = { page: number; text: string };

/**
 * PDF 가 컬럼 순서로 뽑히면서 한 행이 두 줄로 갈린 것을 되붙인다.
 *
 *   "7.40 5.65 ~ 8.87 10^6/μL"   ← 값 · 참고범위 · 단위
 *   "RBC"                          ← 항목명
 *     → "RBC 7.40 5.65 ~ 8.87 10^6/μL"
 *
 * 값 줄이 먼저, 이름 줄이 뒤. 이 순서는 KVL 실측에서 일관됐고, 참고범위가 없는 항목
 * ("38.9 fL" → "RDW-SD")도 같은 모양이다. 되붙인 뒤에는 기존 표 파서가 그대로 처리한다.
 *
 * 조건을 좁게 잡아(값 줄은 반드시 단위로 끝나고, 이름 줄은 숫자로 시작하지 않는 짧은 이름)
 * 산점도 범례("RBC" → "Pink" → "-") 같은 블록에서는 발화하지 않는다.
 */
export function pairSplitLabReportRows<T extends SplitPairInput>(lines: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cur = lines[i]!;
    const next = lines[i + 1];
    const curText = (cur.text ?? '').replace(/\s+/g, ' ').trim();
    if (next && VALUE_ONLY_LINE_RE.test(curText) && isBareItemNameLine(next.text)) {
      const name = (next.text ?? '').replace(/\s+/g, ' ').trim();
      out.push({ ...cur, text: `${name} ${curText}` });
      i += 1; // 이름 줄은 소비
      continue;
    }
    out.push(cur);
  }
  return out;
}

/**
 * 결과지의 검사 버킷 정리: 코멘트 문단과 해설 문장을 걷어내고, 두 줄로 갈린 행을 되붙인다.
 * 코멘트 문단은 다음 표 헤더가 나올 때까지 이어진다(문서가 섹션마다 표 + 코멘트를 반복).
 */
export function cleanExternalLabReportLines<T extends SplitPairInput>(lines: T[]): T[] {
  const kept: T[] = [];
  let inComment = false;
  for (const line of lines) {
    const t = (line.text ?? '').replace(/\s+/g, ' ').trim();
    if (isExternalLabReportTableHeaderLine(t)) {
      inComment = false;
      kept.push(line);
      continue;
    }
    if (isExternalLabReportCommentHeaderLine(t)) {
      inComment = true;
      continue;
    }
    if (inComment) continue;
    if (isExternalLabReportProseLine(t)) continue;
    kept.push(line);
  }
  return pairSplitLabReportRows(kept);
}
