import type { OcrRow } from '@/lib/google-vision';

export type LabItem = {
  page: number;
  rowY: number;
  itemName: string;
  value: number | null;
  valueText: string;
  unit: string | null;
  referenceRange: string | null;
  flag: 'low' | 'high' | 'normal' | 'unknown';
  rawRow: string;
  evidencePage?: number | null;
  evidenceRow?: number | null;
  evidenceText?: string | null;
};

export type TableBlock = {
  page: number;
  startRowIndex: number;
  endRowIndex: number;
  rowCount: number;
  score: number;
  preview: string;
};

const LAB_CODE_REGEX =
  /\b(ALT|AST|ALP|ALB|TP|GLOB|BUN|CREA|GLU|WBC|RBC|HGB|HCT|PLT|MCV|MCH|MCHC|EOS|LYM|MONO|NEU|BASO|PDW|MPV|RDW|TCHO|TG|AMYL|LIPA|CK|LDH|PHOS|CA|NA|K|CL|CRP|ALB\/GLOB|BUN\/CREA)\b/i;

const LAB_NAME_REGEX =
  /(백혈구|적혈구|혈소판|헤모글로빈|헤마토크릿|총단백|알부민|글로불린|포도당|크레아티닌|요소질소|콜레스테롤|중성지방|아밀레이스|리파아제|칼슘|인|나트륨|칼륨|염소)/i;

const NOISE_ROW_REGEX =
  /(page\s*\d+|전화|연락처|병원|www\.|http|copyright|주소|주민|년\s*\d+월|\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}|kg|cm|male|female|dog|cat)/i;

function isNumericToken(token: string) {
  return /^[-+]?\d+(?:[.,]\d+)?$/.test(token);
}

function normalizeNumericString(token: string) {
  return token.replace(',', '.');
}

function parseFirstNumeric(tokens: string[]) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isNumericToken(token)) {
      return {
        index,
        valueText: token,
        value: Number.parseFloat(normalizeNumericString(token)),
      };
    }
  }
  return null;
}

function extractRangeText(tokens: string[]) {
  const joined = tokens.join(' ');
  const explicitRange = joined.match(
    /(\d+(?:[.,]\d+)?)\s*(?:-|~)\s*(\d+(?:[.,]\d+)?)/,
  );
  if (!explicitRange) {
    return null;
  }

  return explicitRange[0];
}

function inferFlag(value: number | null, referenceRange: string | null): LabItem['flag'] {
  if (value === null || !referenceRange) {
    return 'unknown';
  }

  const match = referenceRange.match(
    /(\d+(?:[.,]\d+)?)\s*(?:-|~)\s*(\d+(?:[.,]\d+)?)/,
  );
  if (!match) {
    return 'unknown';
  }

  const min = Number.parseFloat(normalizeNumericString(match[1]));
  const max = Number.parseFloat(normalizeNumericString(match[2]));
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return 'unknown';
  }
  if (value < min) {
    return 'low';
  }
  if (value > max) {
    return 'high';
  }
  return 'normal';
}

function isLikelyHeaderRow(rowText: string) {
  const normalized = rowText.toLowerCase();
  return (
    normalized.includes('result') ||
    normalized.includes('reference') ||
    normalized.includes('항목') ||
    normalized.includes('결과') ||
    normalized.includes('참고')
  );
}

function isLikelyLabRow(row: OcrRow) {
  if (!row.text) {
    return false;
  }

  const upper = row.text.toUpperCase();
  const numericCount = row.tokens.filter((token) => isNumericToken(token)).length;
  const hasRange = /(\d+(?:[.,]\d+)?)\s*(?:-|~)\s*(\d+(?:[.,]\d+)?)/.test(row.text);
  const hasLabCode = LAB_CODE_REGEX.test(upper);
  const hasLabName = LAB_NAME_REGEX.test(row.text);
  const hasQualitativeResult = /\b(normal|negative|positive|abnormal|reactive|nonreactive|trace)\b/i.test(
    row.text,
  );

  if (NOISE_ROW_REGEX.test(row.text)) {
    return false;
  }

  return hasLabCode || hasLabName || (hasRange && numericCount >= 2) || hasQualitativeResult;
}

function isLikelyLabHeaderRow(rowText: string) {
  const normalized = rowText.toLowerCase();
  return (
    (normalized.includes('name') &&
      normalized.includes('unit') &&
      normalized.includes('result')) ||
    normalized.includes('검사항목') ||
    normalized.includes('항목') ||
    normalized.includes('결과') ||
    normalized.includes('참고치') ||
    normalized.includes('reference') ||
    normalized.includes('result')
  );
}

function isMetadataGapRow(rowText: string) {
  const normalized = rowText.toLowerCase();
  return (
    normalized.includes('performed by') ||
    normalized.includes('machine') ||
    normalized.includes('instrument') ||
    normalized.includes('[solo]')
  );
}

function rowScore(row: OcrRow) {
  const upper = row.text.toUpperCase();
  const numericCount = row.tokens.filter((token) => isNumericToken(token)).length;
  const hasRange = /(\d+(?:[.,]\d+)?)\s*(?:-|~)\s*(\d+(?:[.,]\d+)?)/.test(row.text);
  const hasLabCode =
    /\b(ALT|AST|ALP|ALB|TP|GLOB|BUN|CREA|GLU|WBC|RBC|HGB|HCT|PLT|MCV|MCH|MCHC|EOS|LYM|MONO|NEU|CRP|ALB\/GLOB|BUN\/CREA)\b/.test(
      upper,
    );
  const hasLabKeyword = /(혈액|검사|CBC|chem|chemistry|panel|reference|결과|항목)/i.test(
    row.text,
  );

  let score = 0;
  if (hasLabCode) score += 4;
  if (hasRange) score += 3;
  if (numericCount >= 2) score += 2;
  if (hasLabKeyword) score += 1;
  return score;
}

export function detectTableBlocks(rows: OcrRow[]): TableBlock[] {
  const blocks: TableBlock[] = [];

  const rowsByPage = new Map<number, Array<{ row: OcrRow; index: number }>>();
  rows.forEach((row, index) => {
    const list = rowsByPage.get(row.page) ?? [];
    list.push({ row, index });
    rowsByPage.set(row.page, list);
  });

  for (const [page, entries] of rowsByPage.entries()) {
    let currentStart = -1;
    let currentEnd = -1;
    let currentScore = 0;
    let strongRows = 0;
    let gapCount = 0;
    const allowedGap = 3;
    let headerChildUntil = -1;

    for (let i = 0; i < entries.length; i += 1) {
      const score = rowScore(entries[i].row);
      const isHeader = isLikelyLabHeaderRow(entries[i].row.text);
      if (isHeader) {
        // Header-child rule: treat following rows as table body candidates.
        headerChildUntil = Math.max(headerChildUntil, i + 20);
      }
      const inHeaderChildRange = i <= headerChildUntil;
      const isCandidate = score >= 2 || isHeader || inHeaderChildRange;

      if (isCandidate) {
        if (currentStart < 0) {
          currentStart = i;
          currentScore = 0;
          strongRows = 0;
        }
        currentEnd = i;
        gapCount = 0;
        currentScore += score;
        if (score >= 4) {
          strongRows += 1;
        }
        if (isHeader) {
          currentScore += 1;
        }
      } else if (currentStart >= 0) {
        // Keep metadata lines (e.g. Performed by) from breaking a table block.
        if (!isMetadataGapRow(entries[i].row.text)) {
          gapCount += 1;
        }
      }

      const isLast = i === entries.length - 1;
      const shouldFinalize =
        currentStart >= 0 && (isLast || gapCount > allowedGap);
      if (!shouldFinalize) {
        continue;
      }

      const end = currentEnd >= currentStart ? currentEnd : i;
      const rowCount = end - currentStart + 1;

      if (rowCount >= 2 && currentScore >= 4 && strongRows >= 1) {
        const preview = entries
          .slice(currentStart, Math.min(currentStart + 2, end + 1))
          .map((entry) => entry.row.text)
          .join(' | ');
        blocks.push({
          page,
          startRowIndex: entries[currentStart].index,
          endRowIndex: entries[end].index,
          rowCount,
          score: currentScore,
          preview,
        });
      }

      currentStart = -1;
      currentEnd = -1;
      currentScore = 0;
      strongRows = 0;
      gapCount = 0;
    }
  }

  return blocks.sort((a, b) => {
    if (a.page !== b.page) {
      return a.page - b.page;
    }
    return a.startRowIndex - b.startRowIndex;
  });
}

export function rowsFromTableBlocks(rows: OcrRow[], blocks: TableBlock[]): OcrRow[] {
  if (blocks.length === 0) {
    return rows;
  }

  const indices = new Set<number>();
  for (const block of blocks) {
    for (let index = block.startRowIndex; index <= block.endRowIndex; index += 1) {
      indices.add(index);
    }
  }

  return rows.filter((_, index) => indices.has(index));
}

function parseLabRowText(rowText: string) {
  const compact = rowText.replace(/\s+/g, ' ').trim();
  const match = compact.match(
    /^(.+?)\s+([-+]?\d+(?:[.,]\d+)?)\s*([^\d]*?)\s*(?:(\d+(?:[.,]\d+)?\s*(?:-|~)\s*\d+(?:[.,]\d+)?))?\s*$/i,
  );

  if (!match) {
    return null;
  }

  const itemName = match[1]?.trim() ?? '';
  const valueText = match[2]?.trim() ?? '';
  const unit = match[3]?.trim() || null;
  const referenceRange = match[4]?.trim() || null;

  if (!itemName || !valueText) {
    return null;
  }
  return { itemName, valueText, unit, referenceRange };
}

type ParsedByLayout = {
  itemName: string;
  valueText: string;
  value: number | null;
  unit: string | null;
  referenceRange: string | null;
  flag: LabItem['flag'];
};

function parseByFixedLayout(row: OcrRow): ParsedByLayout | null {
  const tokens = row.tokens.map((token) => token.trim()).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }

  const resultIndex = tokens.findIndex((token) => /^(normal|high|low)$/i.test(token));
  const explicitFlag: LabItem['flag'] | null =
    resultIndex >= 0
      ? (tokens[resultIndex].toLowerCase() as 'normal' | 'high' | 'low')
      : null;

  const numericPositions: Array<{ index: number; token: string; value: number }> = [];
  tokens.forEach((token, index) => {
    if (!isNumericToken(token)) {
      return;
    }
    const parsed = Number.parseFloat(normalizeNumericString(token));
    if (!Number.isFinite(parsed)) {
      return;
    }
    numericPositions.push({ index, token, value: parsed });
  });

  if (numericPositions.length === 0) {
    return null;
  }

  // Right-to-left parsing:
  // [item ...] [unit?] [min?] [max?] [actual] [Normal/High/Low?]
  const rightBoundary = resultIndex >= 0 ? resultIndex : tokens.length;
  const numericBeforeResult = numericPositions.filter(
    (entry) => entry.index < rightBoundary,
  );
  if (numericBeforeResult.length === 0) {
    return null;
  }

  const actual = numericBeforeResult[numericBeforeResult.length - 1];
  const prevNumeric = numericBeforeResult.slice(0, -1);
  const minCandidate = prevNumeric.length >= 2 ? prevNumeric[prevNumeric.length - 2] : null;
  const maxCandidate = prevNumeric.length >= 1 ? prevNumeric[prevNumeric.length - 1] : null;

  const range =
    minCandidate && maxCandidate ? `${minCandidate.token}-${maxCandidate.token}` : null;

  const leftTokens = tokens.slice(0, actual.index);
  if (leftTokens.length === 0) {
    return null;
  }

  // Unit is usually the right-most non-numeric token in the left segment.
  let unit: string | null = null;
  let unitIndex = -1;
  for (let index = leftTokens.length - 1; index >= 0; index -= 1) {
    const token = leftTokens[index];
    if (isNumericToken(token)) {
      continue;
    }
    if (/^(normal|high|low)$/i.test(token)) {
      continue;
    }
    if (/[a-zA-Z/%]/.test(token)) {
      unit = token;
      unitIndex = index;
      break;
    }
  }

  const itemNameTokens =
    unitIndex >= 0 ? leftTokens.slice(0, unitIndex) : leftTokens;
  const itemName = itemNameTokens.join(' ').trim();
  if (itemName.length < 2) {
    return null;
  }
  if (NOISE_ROW_REGEX.test(itemName)) {
    return null;
  }
  if (!LAB_CODE_REGEX.test(itemName) && !LAB_NAME_REGEX.test(itemName)) {
    return null;
  }

  const safeValue = Number.isFinite(actual.value) ? actual.value : null;
  const inferredFlag = inferFlag(safeValue, range);

  return {
    itemName,
    valueText: actual.token,
    value: safeValue,
    unit,
    referenceRange: range,
    flag: explicitFlag ?? inferredFlag,
  };
}

function inferQualitativeFlag(valueText: string): LabItem['flag'] {
  const normalized = valueText.toLowerCase();
  if (/(normal|negative|nonreactive)/i.test(normalized)) return 'normal';
  if (/(abnormal|positive|reactive)/i.test(normalized)) return 'high';
  return 'unknown';
}

function parseQualitativeLabRow(row: OcrRow): ParsedByLayout | null {
  const tokens = row.tokens.map((token) => token.trim()).filter(Boolean);
  if (tokens.length < 2) return null;

  const qualitativeRegex = /^(normal|negative|positive|abnormal|reactive|nonreactive|trace)$/i;
  const resultIndex = [...tokens]
    .map((token, index) => ({ token, index }))
    .reverse()
    .find((entry) => qualitativeRegex.test(entry.token))?.index;

  if (resultIndex === undefined) {
    return null;
  }

  const valueText = tokens[resultIndex];
  const before = tokens.slice(0, resultIndex);
  if (before.length === 0) {
    return null;
  }

  let tailStart = before.length;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    if (qualitativeRegex.test(before[index])) {
      tailStart = index;
      continue;
    }
    break;
  }

  const itemNameTokens = before.slice(0, tailStart);
  const referenceTokens = before.slice(tailStart);
  const itemName = itemNameTokens.join(' ').trim() || before[0];
  if (itemName.length < 2) {
    return null;
  }
  if (NOISE_ROW_REGEX.test(itemName)) {
    return null;
  }

  return {
    itemName,
    valueText,
    value: null,
    unit: null,
    referenceRange: referenceTokens.length > 0 ? referenceTokens.join(' ') : null,
    flag: inferQualitativeFlag(valueText),
  };
}

export function extractLabItems(rows: OcrRow[]): LabItem[] {
  const items: LabItem[] = [];

  for (const row of rows) {
    if (!row.text || row.tokens.length < 2) {
      continue;
    }
    if (isLikelyHeaderRow(row.text)) {
      continue;
    }
    if (!isLikelyLabRow(row)) {
      continue;
    }

    const byLayout = parseByFixedLayout(row);
    if (byLayout) {
      items.push({
        page: row.page,
        rowY: row.y,
        itemName: byLayout.itemName,
        value: byLayout.value,
        valueText: byLayout.valueText,
        unit: byLayout.unit,
        referenceRange: byLayout.referenceRange,
        flag: byLayout.flag,
        rawRow: row.text,
      });
      continue;
    }

    const parsedRow = parseLabRowText(row.text);
    if (parsedRow) {
      const value = Number.parseFloat(normalizeNumericString(parsedRow.valueText));
      const safeValue = Number.isFinite(value) ? value : null;
      const flag = inferFlag(safeValue, parsedRow.referenceRange);
      items.push({
        page: row.page,
        rowY: row.y,
        itemName: parsedRow.itemName,
        value: safeValue,
        valueText: parsedRow.valueText,
        unit: parsedRow.unit,
        referenceRange: parsedRow.referenceRange,
        flag,
        rawRow: row.text,
      });
      continue;
    }

    const qualitative = parseQualitativeLabRow(row);
    if (qualitative) {
      items.push({
        page: row.page,
        rowY: row.y,
        itemName: qualitative.itemName,
        value: null,
        valueText: qualitative.valueText,
        unit: null,
        referenceRange: qualitative.referenceRange,
        flag: qualitative.flag,
        rawRow: row.text,
      });
      continue;
    }

    const numeric = parseFirstNumeric(row.tokens);
    if (!numeric) {
      continue;
    }

    const itemName = row.tokens.slice(0, numeric.index).join(' ').trim();
    if (!itemName || itemName.length < 2) {
      continue;
    }
    if (NOISE_ROW_REGEX.test(itemName)) {
      continue;
    }
    if (!LAB_CODE_REGEX.test(itemName) && !LAB_NAME_REGEX.test(itemName)) {
      continue;
    }

    const remaining = row.tokens.slice(numeric.index + 1);
    const rangeText = extractRangeText(remaining);
    const rangeStartIndex = rangeText
      ? remaining.findIndex((token) => rangeText.includes(token))
      : -1;
    const unitTokens = rangeStartIndex >= 0 ? remaining.slice(0, rangeStartIndex) : remaining;
    const unit = unitTokens.join(' ').trim() || null;

    const value = Number.isFinite(numeric.value) ? numeric.value : null;
    const referenceRange = rangeText?.trim() || null;
    const flag = inferFlag(value, referenceRange);

    items.push({
      page: row.page,
      rowY: row.y,
      itemName,
      value,
      valueText: numeric.valueText,
      unit,
      referenceRange,
      flag,
      rawRow: row.text,
    });
  }

  const unique = new Map<string, LabItem>();
  for (const item of items) {
    const key = `${item.page}|${item.itemName.toUpperCase()}|${item.valueText}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return [...unique.values()].sort((a, b) => {
    if (a.page !== b.page) {
      return a.page - b.page;
    }
    return a.rowY - b.rowY;
  });
}
