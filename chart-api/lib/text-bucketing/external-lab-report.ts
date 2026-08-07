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

type HeaderLabel = (typeof HEADER_LABELS)[number];

const DATE_TOKEN_RE = /^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})$/;
/** 나이 토큰 — "11세", "3살", "8개월". */
const AGE_TOKEN_RE = /^\d+\s*(?:세|살|개월|년)$/;
const DATE_LABELS: readonly HeaderLabel[] = ['검사접수일', '검사보고일', '검체채취일'];

function toIsoDate(token: string): string | null {
  const m = DATE_TOKEN_RE.exec(token.trim());
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

type HeaderBlock = { labels: HeaderLabel[]; values: string[] };

/**
 * 머리말을 「라벨 줄 몇 개 → 값 줄 몇 개」 블록으로 자른다(환자 블록, 검사일자 블록…).
 * 문서 전체를 한 줄로 세면 블록 경계가 무너져 엉뚱한 값을 집는다(실측: 생년월일을 채취일로 집었다).
 */
function buildHeaderBlocks(texts: string[]): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  let cur: HeaderBlock | null = null;
  let lastWasLabel = false;

  for (const raw of texts) {
    const t = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    // 머리말은 첫 검사 표 위에만 있다. 여기서 끊지 않으면 문서 전체가 마지막 블록의 값으로 딸려온다.
    if (isExternalLabReportTableHeaderLine(t)) break;
    const tokens = t.split(' ');
    const isLabelLine = tokens.every((tok) => (HEADER_LABELS as readonly string[]).includes(tok));
    if (isLabelLine) {
      if (!cur || lastWasLabel === false) {
        cur = { labels: [], values: [] };
        blocks.push(cur);
      }
      cur.labels.push(...(tokens as HeaderLabel[]));
      lastWasLabel = true;
    } else {
      if (cur) cur.values.push(...tokens);
      lastWasLabel = false;
    }
  }

  return blocks;
}

/**
 * 한 블록의 라벨에 값 토큰을 순서대로 배분한다.
 *
 * 라벨과 값은 **컬럼 순서로 1:1 대응**한다(KVL 실측):
 *   라벨: 차트번호 / 검사접수일 검사보고일 / 검체채취일 성별
 *   값  : 4486 2026.07.30 / 2026.07.31 2026.07.30 / NF
 * 그래서 순번으로 집으면 좌표(OCR) 없이도 복원된다. 다만 **한 칸이 두 토큰인 라벨**이 있다:
 *   동물나이 → "11세 2015.03.28"(나이 + 생년월일). 이걸 한 토큰으로 세면 그 뒤가 전부 한 칸씩
 *   밀려 보호자 자리에 동물종이 들어간다. 그래서 나이 뒤 날짜 토큰은 같은 칸으로 흡수한다.
 *
 * 라벨을 다 채우지 못했거나 날짜 칸에 날짜가 아닌 값이 들어오면 그 블록은 신뢰하지 않는다.
 * 라벨을 다 채우고 남은 토큰은 무시한다 — 머리말 아래 표 제목("Hematology")이 값 줄로 섞여 온다.
 */
function assignHeaderValues(block: HeaderBlock): { map: Partial<Record<HeaderLabel, string>>; exact: boolean } {
  const map: Partial<Record<HeaderLabel, string>> = {};
  let vi = 0;
  for (const label of block.labels) {
    if (vi >= block.values.length) return { map, exact: false };
    const take = [block.values[vi++]!];
    if (label === '동물나이' && AGE_TOKEN_RE.test(take[0]!)) {
      // 나이 뒤에 붙는 생년월일은 같은 칸이다.
      if (vi < block.values.length && DATE_TOKEN_RE.test(block.values[vi]!)) take.push(block.values[vi++]!);
    }
    map[label] = take.join(' ');
  }
  // 날짜 라벨에 날짜가 아닌 값이 배정됐으면 컬럼 정렬이 어긋난 것이다 — 이름 칸도 못 믿는다.
  const dateOk = DATE_LABELS.every((l) => !map[l] || toIsoDate(map[l]!) !== null);
  // 반대로 이름 칸에 날짜가 들어왔어도 어긋난 것이다.
  const nameOk = (['동물이름', '보호자'] as const).every((l) => !map[l] || toIsoDate(map[l]!) === null);
  return { map, exact: dateOk && nameOk };
}

export type ExternalLabReportHeader = {
  patientName: string | null;
  ownerName: string | null;
  species: string | null;
  breed: string | null;
  sex: string | null;
  birth: string | null;
  collectionDate: string | null;
};

/** 값 같지 않은 칸(라벨이 밀려 들어온 경우 등)을 걸러낸다. */
function headerValueOrNull(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  if ((HEADER_LABELS as readonly string[]).includes(t)) return null;
  if (t.length > 30) return null;
  return t;
}

/**
 * 결과지 머리말에서 환자·보호자·검체채취일을 뽑는다.
 *
 * 이름·보호자는 **차트가 없을 때만** 쓸 값이다(차트가 있으면 차트가 이긴다 — route 참고).
 * 배분이 어긋난 블록의 이름 칸은 버린다: 틀린 이름은 빈칸보다 나쁘다. 날짜만은 폴백을 둔다
 * (가장 이른 날짜 — 채취 ≤ 접수 ≤ 보고 순이라 대체로 맞고, 틀려도 담당자가 고칠 수 있다).
 */
export function parseExternalLabReportHeader(texts: string[]): ExternalLabReportHeader {
  const blocks = buildHeaderBlocks(texts);
  const out: ExternalLabReportHeader = {
    patientName: null,
    ownerName: null,
    species: null,
    breed: null,
    sex: null,
    birth: null,
    collectionDate: null,
  };

  for (const block of blocks) {
    const { map, exact } = assignHeaderValues(block);
    if (!exact) continue;
    out.patientName ??= headerValueOrNull(map['동물이름']);
    out.ownerName ??= headerValueOrNull(map['보호자']);
    out.species ??= headerValueOrNull(map['동물종']);
    out.breed ??= headerValueOrNull(map['동물품종']);
    out.sex ??= headerValueOrNull(map['성별']);
    // 동물나이 = "11세 2015.03.28" — 우리가 쓰는 건 생년월일 쪽이다.
    const ageCell = map['동물나이'];
    if (ageCell && !out.birth) {
      const birthToken = ageCell.split(' ').map(toIsoDate).find((d): d is string => d !== null);
      out.birth ??= birthToken ?? null;
    }
    out.collectionDate ??= map['검체채취일'] ? toIsoDate(map['검체채취일']!) : null;
  }

  if (!out.collectionDate) {
    // 배분이 어긋났다 — 검체채취일이 있는 블록에서 가장 이른 날짜로 물러선다.
    const block = blocks.find((b) => b.labels.includes('검체채취일'));
    const pool = block ? block.values : blocks.flatMap((b) => b.values);
    const dates = pool.map(toIsoDate).filter((d): d is string => d !== null).sort();
    out.collectionDate = dates[0] ?? null;
  }

  return out;
}

/** 검체채취일(= 이 검사의 날짜)만 필요할 때. */
export function extractExternalLabReportCollectionDate(texts: string[]): string | null {
  return parseExternalLabReportHeader(texts).collectionDate;
}

export type PagedLine = { page: number; text: string };

/**
 * 합쳐 올린 PDF 안에서 **결과지가 차지하는 페이지 범위**를 찾는다.
 *
 * 병원에 "차트 먼저, 결과지 나중" 같은 순서를 요구할 수 없다. 그래서 정리·날짜앵커를 문서 전체가
 * 아니라 이 페이지들에만 건다 — 그러면 순서와 무관하게 결과지는 결과지대로, 차트는 차트대로 처리된다.
 * (문서 전체에 걸면 차트 검사줄이 결과지 해설문 규칙에 걸려 사라지고, 결과지 검사행은 차트의
 *  마지막 방문일에 붙는다.)
 *
 * 합쳐 올린 PDF 는 문서 단위로 이어 붙으므로 결과지는 **연속된 페이지 구간**이다. 표 헤더가 있는
 * 페이지를 씨앗으로 잡고 그 사이를 채운다. 표가 2쪽부터 시작하는 결과지를 위해, 앞 페이지가
 * 머리말 라벨로 채워져 있으면 한 장씩 앞으로 넓힌다.
 *
 * 한계: 마지막 표 이후 해설문만 있는 페이지는 포함되지 않는다(그 페이지에 씨앗이 없다).
 * KVL 은 섹션마다 표가 있어 해당 없음.
 */
export function findExternalLabReportPages(lines: PagedLine[]): number[] {
  const seeds: number[] = [];
  const labelHitsByPage = new Map<number, number>();
  for (const l of lines) {
    if (isExternalLabReportTableHeaderLine(l.text)) seeds.push(l.page);
    const tokens = (l.text ?? '').replace(/\s+/g, ' ').trim().split(' ');
    const hits = tokens.filter((t) => (HEADER_LABELS as readonly string[]).includes(t)).length;
    if (hits > 0) labelHitsByPage.set(l.page, (labelHitsByPage.get(l.page) ?? 0) + hits);
  }
  if (seeds.length === 0) return [];

  let min = Math.min(...seeds);
  const max = Math.max(...seeds);
  while ((labelHitsByPage.get(min - 1) ?? 0) >= 3) min -= 1;

  const pages: number[] = [];
  for (let p = min; p <= max; p += 1) pages.push(p);
  return pages;
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
 * 「이름 값 참고범위 [단위]」 완전한 표 행. 코멘트 문단이 끝났다는 **내용 기반** 신호로 쓴다.
 * 참고범위까지 갖춘 행만 인정해 해설문("…SDMA가 15-19μg/dL")에는 걸리지 않는다.
 */
const TABLE_ROW_RE = new RegExp(
  `^[A-Za-z가-힣][^~]{0,28}?\\s+-?\\d[\\d.,]*\\s+-?\\d[\\d.,]*\\s*~\\s*-?\\d[\\d.,]*(?:\\s+${UNIT_RE.source})?\\s*$`,
  'i',
);

/**
 * 섹션 제목 줄인가("Chemistry", "proBNP (Canine)", "T4, Total").
 * 결과지는 「… 코멘트 문단 → **다음 섹션 제목** → 표 헤더」 순이라, 표 헤더 직전 1~2줄은
 * 앞 코멘트의 일부가 아니라 뒤 표의 제목이다. 그 줄로 코멘트에 출처를 붙인다.
 */
function isSectionTitleCandidate(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 30) return false;
  if (isExternalLabReportProseLine(t)) return false;
  if (/[:：.]$/.test(t)) return false; // "1. SDMA와 Creatinine이 모두 정상:" 같은 해설 항목 제외
  if (/^\d/.test(t)) return false;
  if (/~/.test(t) || TABLE_ROW_RE.test(t)) return false; // 참고범위가 있으면 검사행이다
  return /[A-Za-z가-힣]/.test(t);
}

/**
 * 결과지 꼬리의 랩 회사 정보·면책 문구. 판독 소견이 아니라 인쇄물 푸터다.
 * 마지막 섹션의 코멘트는 뒤에 표 헤더가 없어 문서 끝까지 이어지므로, 이 줄들이 그대로 코멘트로
 * 새어 들어간다. 랩마다 문구는 달라도 성격(주소·연락처·자문·면책)은 같다.
 */
function isExternalLabReportFooterLine(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/^자문\s*[:：]/.test(t)) return true;
  if (/(사업자|대표전화|고객센터|Tel|Fax|문의)\s*[:：]?/i.test(t)) return true;
  if (/의뢰된\s*검체에\s*한정된/.test(t)) return true;
  // "경기도 성남시 분당구 …", "… B동 501호" 같은 주소 줄.
  if (/(특별시|광역시|[가-힣]{2,}(시|도))\s+[가-힣]+(시|군|구)\s/.test(t)) return true;
  if (/\d+\s*(호|층)\s*$/.test(t)) return true;
  return false;
}

export type ExternalLabReportSplit<T> = {
  /** 검사 표 줄 — 기존 표 파서로 넘어간다. */
  lab: T[];
  /** 코멘트 해설문 — 검사값이 아니라 판독 소견이라 차트 본문으로 간다. */
  comments: T[];
};

/**
 * 결과지의 검사 버킷을 「표 줄」과 「코멘트 해설문」으로 가른다.
 * 코멘트 문단은 다음 섹션이 시작될 때까지 이어진다(문서가 섹션마다 표 + 코멘트를 반복).
 *
 * 섹션 시작 신호는 둘이다:
 *  (a) 표 헤더 — 버킷팅이 이 줄을 lab 으로 넘겨줘야 보인다(assign-buckets 참고). 신호로만 쓰고
 *      출력에선 뺀다. 검사값이 없는 줄이라 파서에 넘겨봐야 가짜 항목만 만든다.
 *  (b) 완전한 표 행 — (a)가 유실된 결과지를 위한 안전망. 이게 없으면 첫 '코멘트' 이후 문서 끝까지
 *      전부 코멘트로 간주돼 뒷 섹션이 통째로 사라진다(실측: KVL 60행 중 Chemistry 이하 28행 유실).
 *
 * 코멘트는 버리지 않고 돌려준다 — 랩 판독의(SDMA 해석, proBNP 구간별 의미 등)의 소견이라
 * 검사값만큼 진료 맥락이다. 다만 **병원 수의사가 쓴 노트가 아니므로** 출처 표시를 달아 내보낸다.
 */
export function splitExternalLabReportLines<T extends SplitPairInput>(lines: T[]): ExternalLabReportSplit<T> {
  const kept: T[] = [];
  const comments: T[] = [];
  let buffer: T[] = [];
  /** 다음 코멘트 문단이 어느 검사의 소견인지 — 직전 표의 제목. */
  let currentTitle: string | null = null;
  let inComment = false;

  const closeComment = () => {
    inComment = false;
    // 문단 끝에 붙은 다음 섹션 제목(최대 2줄)을 떼어낸다 — 코멘트가 아니라 뒤 표의 제목이다.
    const titles: string[] = [];
    while (buffer.length > 0 && titles.length < 2 && isSectionTitleCandidate(buffer[buffer.length - 1]!.text)) {
      titles.unshift((buffer.pop()!.text ?? '').replace(/\s+/g, ' ').trim());
    }
    if (buffer.length > 0) {
      const label = currentTitle ? `[외부 검사 코멘트 · ${currentTitle}]` : '[외부 검사 코멘트]';
      comments.push({ ...buffer[0]!, text: label }, ...buffer);
    }
    buffer = [];
    if (titles.length > 0) currentTitle = titles.join(' · ');
  };

  for (const line of lines) {
    const t = (line.text ?? '').replace(/\s+/g, ' ').trim();
    if (isExternalLabReportTableHeaderLine(t)) {
      if (inComment) closeComment();
      // 첫 섹션의 제목만 여기서 줍는다. 둘째 섹션부터는 제목이 앞 코멘트 문단 끝에 붙어 오므로
      // closeComment 가 이미 정확히 떼어 놨다 — 여기서 lab 줄(산점도 범례 등)로 덮어쓰면 안 된다.
      if (currentTitle === null) {
        const titles = kept
          .slice(-2)
          .map((l) => (l.text ?? '').replace(/\s+/g, ' ').trim())
          .filter(isSectionTitleCandidate);
        if (titles.length > 0) currentTitle = titles.join(' · ');
      }
      continue;
    }
    if (inComment && TABLE_ROW_RE.test(t)) closeComment();
    if (isExternalLabReportCommentHeaderLine(t)) {
      inComment = true;
      continue;
    }
    if (inComment) {
      if (!isExternalLabReportFooterLine(t)) buffer.push(line);
      continue;
    }
    if (isExternalLabReportProseLine(t)) continue;
    kept.push(line);
  }
  if (inComment) closeComment();

  return { lab: pairSplitLabReportRows(kept), comments };
}

/** 검사 표 줄만 필요할 때. */
export function cleanExternalLabReportLines<T extends SplitPairInput>(lines: T[]): T[] {
  return splitExternalLabReportLines(lines).lab;
}
