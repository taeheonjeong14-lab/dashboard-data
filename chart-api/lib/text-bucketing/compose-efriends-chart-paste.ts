import { extractLabDateTime } from '@/lib/text-bucketing/chart-dates';

/**
 * 이프렌즈 추출 폼: 날짜(·시간) + 본문 블록들을 `orderedLinesFromPastedChartText`용 단일 문자열로 합칩니다.
 * 각 블록 첫 줄은 `extractLabDateTime`이 인식하는 방문 앵커(날짜만 또는 날짜+시각)입니다.
 */
export type EfriendsChartPasteBlock = {
  date: string;
  time: string;
  body: string;
};

/** `groupChartBodyByDate` 결과와 동일한 필드 (이프렌즈: 사용자 입력만으로 채움, 버킷·LLM 차트 본문 미사용) */
export type EfriendsDirectChartBodyGroup = {
  dateTime: string;
  pages: number[];
  bodyText: string;
  planText: string;
  lineCount: number;
  planDetected: boolean;
};

function lineCountNonEmpty(text: string) {
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

/**
 * 이프렌즈: 폼에서 받은 블록만으로 차트 본문을 날짜별 그룹으로 만든다.
 * OCR/LLM 버킷의 chartBody는 이 결과에 쓰이지 않는다.
 */
export function efriendsChartBodyByDateFromBlocks(blocks: EfriendsChartPasteBlock[]): EfriendsDirectChartBodyGroup[] {
  const groups: EfriendsDirectChartBodyGroup[] = [];
  for (const b of blocks) {
    const body = b.body.replace(/\r\n/g, '\n').trim();
    if (!body) continue;
    const date = b.date.trim();
    if (!date) continue;
    const time = b.time.trim();
    const anchor = time ? `${date} ${time}` : date;
    const dateKey = extractLabDateTime(anchor) ?? anchor.replace(/\s+/g, ' ').trim();
    groups.push({
      dateTime: dateKey,
      pages: [],
      bodyText: body,
      planText: '',
      lineCount: lineCountNonEmpty(body),
      planDetected: false,
    });
  }
  return groups;
}

export function parseEfriendsChartBlocksFromFormJson(raw: FormDataEntryValue | null): EfriendsChartPasteBlock[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x))
      .map((x) => ({
        date: typeof x.date === 'string' ? x.date : '',
        time: typeof x.time === 'string' ? x.time : '',
        body: typeof x.body === 'string' ? x.body : '',
      }));
  } catch {
    return [];
  }
}

export function composeEfriendsChartPasteText(blocks: EfriendsChartPasteBlock[]): string {
  const chunks: string[] = [];
  for (const b of blocks) {
    const body = b.body.replace(/\r\n/g, '\n').trim();
    if (!body) continue;
    const date = b.date.trim();
    if (!date) {
      throw new Error('차트 본문을 넣은 블록에는 날짜를 선택해 주세요.');
    }
    const time = b.time.trim();
    const anchor = time ? `${date} ${time}` : date;
    chunks.push(anchor, body);
  }
  return chunks.join('\n');
}

/**
 * `composeEfriendsChartPasteText` 출력(앵커 한 줄 + 본문 …)을 다시 그룹으로 나눈다.
 * `efriendsChartBlocksJson`이 비어 있거나 파싱 실패해도 `chartPasteText`만 있으면 `result_chart_by_date` 저장을 복구할 수 있다.
 */
function isLikelyEfriendsFormAnchorLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /^20\d{2}-\d{2}-\d{2}(\s+[0-2]?\d:[0-5]\d(?::[0-5]\d)?)?$/.test(t);
}

export function efriendsChartBodyByDateFromComposedPaste(raw: string): EfriendsDirectChartBodyGroup[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const lines = text.split('\n');
  const groups: EfriendsDirectChartBodyGroup[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i].trim()) {
      i += 1;
    }
    if (i >= lines.length) break;
    if (!isLikelyEfriendsFormAnchorLine(lines[i])) {
      i += 1;
      continue;
    }
    const anchor = lines[i].trim();
    i += 1;
    const bodyStart = i;
    while (i < lines.length && !isLikelyEfriendsFormAnchorLine(lines[i])) {
      i += 1;
    }
    const body = lines.slice(bodyStart, i).join('\n').trim();
    if (!body) continue;
    const dateKey = extractLabDateTime(anchor) ?? anchor.replace(/\s+/g, ' ').trim();
    groups.push({
      dateTime: dateKey,
      pages: [],
      bodyText: body,
      planText: '',
      lineCount: lineCountNonEmpty(body),
      planDetected: false,
    });
  }
  return groups;
}
