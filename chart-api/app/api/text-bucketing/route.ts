import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { parseChartKind, chartTypeNoticeFor, type ChartKind } from '@/lib/text-bucketing/chart-kind';
import {
  saveFullParseRun,
  sha256Hex,
} from '@/lib/chart-app/bucketing-run';
import { getChartPgPool } from '@/lib/db';
import { hospitalExistsForParseRun } from '@/lib/chart-app/hospital-gate';
import { hasLlmApiKey, getLlmProvider } from '@/lib/llm-provider';
import { extractOrderedLinesFromPdf, getOpenAiOrderedLinesModel } from '@/lib/report-llm';
import { runGoogleVisionOcr } from '@/lib/google-vision';
import { assignLinesToBuckets } from '@/lib/text-bucketing/assign-buckets';
import {
  extractEfriendsLabAndPhysicalExamBuckets,
} from '@/lib/text-bucketing/efriends-lab-extract';
import {
  isEfriendsPdfFooterDateTimeLine,
  isEfriendsPdfFooterPageLine,
  isEfriendsRepeatingPdfHeaderLine,
} from '@/lib/text-bucketing/efriends-pdf-noise';
import {
  efriendsChartBodyByDateFromBlocks,
  efriendsChartBodyByDateFromComposedPaste,
  parseEfriendsChartBlocksFromFormJson,
} from '@/lib/text-bucketing/compose-efriends-chart-paste';
import {
  parseVaccinationRecordsFromBucketLines,
} from '@/lib/text-bucketing/vaccination-parse';
import {
  cleanNoise,
  orderedLinesFromPastedChartText,
  groupChartBodyByDate,
  groupLabByDate,
  groupLabLinesByDate,
  parseBasicInfoFromText,
  parseEfriendsPhysicalExamItemsFromVitalsLines,
  mergeVitalsWithPhysicalExamItems,
  parseVitalsFromLines,
  parseLabItemsFromGroupLines,
  sanitizeLabItems,
  normalizeForContains,
  buildPlanLineScores,
  type OrderedLine,
  type BucketedLine,
} from '@/lib/text-bucketing/parse-helpers';
import { canonicalizeLabItemName } from '@/lib/lab-item-normalize';
import { detectSpeciesProfile } from '@/lib/lab-category-map';

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

const HOSPITAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const maxDuration = 120;

export type BucketingParsedInput = {
  chartType: ChartKind;
  hospitalId: string;
  buffer: Buffer;
  fileName: string;
  fileType: string;
  chartPasteText: string;
  efriendsChartBlocks: unknown | null;
};

function resolveHospitalInputId(camel: unknown, snake: unknown): string {
  const a = typeof camel === 'string' ? camel.trim() : '';
  if (a) return a;
  return typeof snake === 'string' ? snake.trim() : '';
}

function formDataStringField(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
}

async function parseMultipart(request: NextRequest): Promise<BucketingParsedInput> {
  const form = await request.formData();
  const chartKind = parseChartKind(formDataStringField(form, 'chartType'));
  if (!chartKind) throw new Error('INVALID_CHART_TYPE');

  const hospitalId = resolveHospitalInputId(
    formDataStringField(form, 'hospitalId'),
    formDataStringField(form, 'hospital_id'),
  );
  if (!hospitalId || !HOSPITAL_UUID_RE.test(hospitalId)) throw new Error('INVALID_HOSPITAL_ID');

  const chartPasteRaw = form.get('chartPasteText');
  const chartPasteText = typeof chartPasteRaw === 'string' ? chartPasteRaw.trim() : '';
  const efriendsChartBlocks = parseEfriendsChartBlocksFromFormJson(form.get('efriendsChartBlocksJson'));

  const file = form.get('file');
  if (!(file instanceof File)) throw new Error('MISSING_FILE');
  if (file.type !== 'application/pdf') throw new Error('FILE_NOT_PDF');
  if (file.size > MAX_FILE_SIZE_BYTES) throw new Error('FILE_TOO_LARGE');

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name?.trim() || 'report.pdf';

  return {
    chartType: chartKind,
    hospitalId,
    buffer: buf,
    fileName: name,
    fileType: file.type || 'application/pdf',
    chartPasteText,
    efriendsChartBlocks,
  };
}

// POST /api/text-bucketing — multipart/form-data 업로드 기반 전체 파싱 파이프라인
export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  if (!hasLlmApiKey()) {
    return NextResponse.json(
      { error: '현재 LLM provider API key가 설정되지 않았습니다.' },
      { status: 400 },
    );
  }

  let input: BucketingParsedInput;
  try {
    input = await parseMultipart(request);
  } catch (e) {
    const code = (e as Error).message;
    const map: Record<string, { status: number; error: string }> = {
      INVALID_CHART_TYPE: {
        status: 400,
        error: 'chartType은 intovet | plusvet | other | efriends 중 하나여야 합니다.',
      },
      INVALID_HOSPITAL_ID: {
        status: 400,
        error: '병원을 선택해 주세요. (hospitalId 또는 hospital_id, UUID)',
      },
      MISSING_FILE: {
        status: 400,
        error: '업로드 파일이 필요합니다. (field: file)',
      },
      FILE_NOT_PDF: { status: 400, error: 'PDF만 지원합니다. (application/pdf)' },
      FILE_TOO_LARGE: { status: 400, error: '파일 크기는 30MB 이하여야 합니다.' },
    };
    const m = map[code];
    if (m) return NextResponse.json({ error: m.error }, { status: m.status });
    throw e;
  }

  const pool = getChartPgPool();
  const hospitalOk = await hospitalExistsForParseRun(pool, input.hospitalId);
  if (!hospitalOk) {
    return NextResponse.json(
      { error: '등록되지 않은 병원입니다. hospitalId / hospital_id 를 확인해 주세요.' },
      { status: 400 },
    );
  }

  try {
    const labDebugEnabled = process.env.LAB_DEBUG === 'true';
    const binary = input.buffer;
    const { chartType, chartPasteText, efriendsChartBlocks } = input;

    const llmLines = await extractOrderedLinesFromPdf({
      pdfBuffer: binary,
      filename: input.fileName || 'report.pdf',
    });
    console.log(
      `[text-bucketing DEBUG] llmLines count=${llmLines.length}, first3=${JSON.stringify(llmLines.slice(0, 3))}, last3=${JSON.stringify(llmLines.slice(-3))}`,
    );

    const ocr = await runGoogleVisionOcr(binary, input.fileType);

    const pasteLines =
      chartType === 'efriends' ? orderedLinesFromPastedChartText(chartPasteText, 'efriends') : [];

    const sanitizedPdfLines = llmLines
      .map((line) => {
        let text: string | null = cleanNoise(line.text);
        if (chartType === 'efriends' && text && isEfriendsPdfFooterDateTimeLine(text)) text = null;
        if (chartType === 'efriends' && text && isEfriendsPdfFooterPageLine(text)) text = null;
        if (chartType === 'efriends' && text && isEfriendsRepeatingPdfHeaderLine(text)) text = null;
        return { ...line, text: text ?? '' };
      })
      .filter((line): line is OrderedLine => Boolean(line.text));

    // LLM이 읽지 못한 페이지는 OCR로 보완
    const llmCoveredPages = new Set(sanitizedPdfLines.map((l) => l.page));
    const ocrSupplementLines: OrderedLine[] = ocr.rows
      .filter((row) => {
        if (llmCoveredPages.has(row.page)) return false;
        const t = row.text.trim();
        if (!t || cleanNoise(t) === null) return false;
        if (chartType === 'efriends' && isEfriendsPdfFooterDateTimeLine(t)) return false;
        if (chartType === 'efriends' && isEfriendsPdfFooterPageLine(t)) return false;
        if (chartType === 'efriends' && isEfriendsRepeatingPdfHeaderLine(t)) return false;
        return true;
      })
      .map((row) => ({ page: row.page, text: row.text.trim() }));

    const effectivePdfLines: OrderedLine[] = [...ocrSupplementLines, ...sanitizedPdfLines].sort(
      (a, b) => a.page - b.page,
    );
    console.log(
      `[text-bucketing DEBUG] llmPages=${llmCoveredPages.size}, ocrSupplementPages=${new Set(ocrSupplementLines.map((l) => l.page)).size}, effectivePdfLines=${effectivePdfLines.length}`,
    );

    const sanitizedLines = [...pasteLines, ...effectivePdfLines];

    let buckets = assignLinesToBuckets(sanitizedLines, ocr.rows, chartType);
    let physicalExamBucket: (typeof buckets)['vitals'] | undefined;
    if (chartType === 'efriends') {
      const { lab: efLabLines, physicalExam } = extractEfriendsLabAndPhysicalExamBuckets(effectivePdfLines);
      if (efLabLines.length > 0) {
        buckets = { ...buckets, lab: efLabLines };
      }
      physicalExamBucket = physicalExam.length > 0 ? physicalExam : undefined;
      if (physicalExamBucket && physicalExamBucket.length > 0) {
        buckets = { ...buckets, vitals: [...buckets.vitals, ...physicalExamBucket] };
      }
    }

    const physicalExamItems =
      chartType === 'efriends' ? parseEfriendsPhysicalExamItemsFromVitalsLines(buckets.vitals) : [];
    const mergedVitals = mergeVitalsWithPhysicalExamItems(
      parseVitalsFromLines(sanitizedLines, chartType),
      physicalExamItems,
    );

    const efriendsDirectBlocks = efriendsChartBodyByDateFromBlocks(
      Array.isArray(efriendsChartBlocks) ? (efriendsChartBlocks as Parameters<typeof efriendsChartBodyByDateFromBlocks>[0]) : [],
    );
    let chartBodyByDate =
      chartType === 'efriends'
        ? efriendsDirectBlocks.length > 0
          ? efriendsDirectBlocks
          : groupChartBodyByDate(buckets.chartBody, chartType)
        : groupChartBodyByDate(buckets.chartBody, chartType);

    if (
      chartType === 'efriends' &&
      chartBodyByDate.length === 0 &&
      chartPasteText.trim().length > 0
    ) {
      const recovered = efriendsChartBodyByDateFromComposedPaste(chartPasteText);
      if (recovered.length > 0) {
        chartBodyByDate = recovered;
      }
    }

    const allBucketLines = Object.values(buckets).flat() as BucketedLine[];
    const correctedCount = allBucketLines.filter((line) => line.corrected).length;

    const labLineGroups = groupLabLinesByDate(buckets.lab);
    const chartTextForBasicInfo = sanitizedLines.map((line) => line.text).join('\n');
    const parsedBasicInfo = parseBasicInfoFromText(chartTextForBasicInfo, chartType, buckets.basicInfo);
    const labCanonicalSpecies = detectSpeciesProfile(parsedBasicInfo.species);

    const labItemsSource = 'rules' as const;
    const labExtractError: string | null = null;
    const labItemsByDate: Array<{
      dateTime: string;
      pages: number[];
      items: Array<{
        itemName: string;
        rawItemName: string;
        valueText: string;
        unit: string | null;
        referenceRange: string | null;
        flag: 'low' | 'high' | 'normal' | 'unknown';
        page: number;
      }>;
      source: 'llm' | 'rules' | 'empty';
      error: string | null;
    }> = [];

    for (const group of labLineGroups) {
      const parsed = sanitizeLabItems(
        parseLabItemsFromGroupLines(group.lines, chartType),
        chartType,
      );
      labItemsByDate.push({
        dateTime: group.dateTime,
        pages: [...new Set(group.lines.map((line) => line.page))].sort((a, b) => a - b),
        items: parsed.map((item) => ({
          itemName: canonicalizeLabItemName(item.itemName, labCanonicalSpecies),
          rawItemName: item.itemName,
          valueText: item.valueText,
          unit: item.unit,
          referenceRange: item.referenceRange,
          flag: item.flag,
          page: item.page,
        })),
        source: labItemsSource,
        error: labExtractError,
      });
    }

    const flatLabItems = labItemsByDate.flatMap((group) => group.items);
    const unmatchedLabItems = labDebugEnabled
      ? (() => {
          const groupedText = labLineGroups.map((group) => ({
            dateTime: group.dateTime,
            normalized: normalizeForContains(group.lines.map((line) => line.text).join(' ')),
          }));
          return sanitizeLabItems(
            flatLabItems.map((item) => ({
              itemName: item.itemName,
              valueText: item.valueText,
              referenceRange: item.referenceRange,
            })),
            chartType,
          )
            .filter((item) => {
              const needleName = normalizeForContains(item.itemName);
              const needleValue = normalizeForContains(item.valueText);
              return !groupedText.some((group) => {
                const hasName = needleName ? group.normalized.includes(needleName) : false;
                const hasValue = needleValue ? group.normalized.includes(needleValue) : true;
                return hasName && hasValue;
              });
            })
            .map((item) => {
              const needleName = normalizeForContains(item.itemName);
              const needleValue = normalizeForContains(item.valueText);
              const hasAnyNameMatch = groupedText.some((group) =>
                needleName ? group.normalized.includes(needleName) : false,
              );
              const hasAnyValueMatch = groupedText.some((group) =>
                needleValue ? group.normalized.includes(needleValue) : false,
              );
              const candidateGroupsByName = groupedText
                .filter((group) => (needleName ? group.normalized.includes(needleName) : false))
                .map((group) => group.dateTime);
              return {
                itemName: item.itemName,
                valueText: item.valueText,
                hasAnyNameMatch,
                hasAnyValueMatch,
                candidateGroupsByName,
              };
            })
            .slice(0, 120);
        })()
      : [];

    const responsePayload = {
      chartType,
      chartTypeNotice: chartTypeNoticeFor(chartType),
      counts: {
        llm: llmLines.length,
        pasteLines: pasteLines.length,
        sanitized: sanitizedLines.length,
        removedByHardRule: llmLines.length - sanitizedPdfLines.length,
        correctedInBuckets: correctedCount,
      },
      llmText: llmLines.map((line) => line.text).join('\n'),
      sanitizedText: sanitizedLines.map((line) => line.text).join('\n'),
      bucketed: {
        basicInfo: buckets.basicInfo,
        chartBody: buckets.chartBody,
        vaccination: buckets.vaccination,
        lab: buckets.lab,
        vitals: buckets.vitals,
      },
      basicInfoParsed: parsedBasicInfo,
      chartBodyByDate,
      labByDate: groupLabByDate(buckets.lab),
      labItemsByDate,
      labItems: flatLabItems.map((item) => ({
        itemName: item.itemName,
        valueText: item.valueText,
        unit: item.unit,
        referenceRange: item.referenceRange,
        flag: item.flag,
        page: item.page,
      })),
      labItemsSource,
      labExtractError,
      ...(labDebugEnabled
        ? {
            debugTrace: {
              labDebugEnabled,
              llmLabLines: sanitizedLines
                .filter((line) => line.text.toLowerCase().includes('lab') || line.text.toLowerCase().includes('crp'))
                .map((line) => line.text)
                .slice(0, 120),
              ocrLabRows: ocr.rows
                .filter((row) =>
                  /(lab|name|unit|min|max|result|crp|performed by|normal|negative|positive)/i.test(row.text),
                )
                .map((row) => row.text)
                .slice(0, 200),
              bucketLabLines: buckets.lab.map((line) => line.text).slice(0, 200),
              groupedLabLines: groupLabLinesByDate(buckets.lab).map((group) => ({
                dateTime: group.dateTime,
                lines: group.lines.map((line) => line.text).slice(0, 120),
              })),
              extractedLabItems: flatLabItems.slice(0, 200).map((item) => ({
                itemName: item.itemName,
                valueText: item.valueText,
                unit: item.unit,
                flag: item.flag,
              })),
              unmatchedLabItems,
            },
          }
        : {}),
      ocrDebug: ocr.debug ?? null,
      chartDebug: {
        groups: chartBodyByDate.map((group) => {
          const fullLines = [
            ...(group.bodyText ? group.bodyText.split(/\r?\n/) : []),
            ...(group.planText ? group.planText.split(/\r?\n/) : []),
          ]
            .map((line) => line.trim())
            .filter(Boolean);
          return {
            dateTime: group.dateTime,
            planDetected: group.planDetected,
            planLineScores: buildPlanLineScores(fullLines),
          };
        }),
      },
    };

    const vaccinationRecords = parseVaccinationRecordsFromBucketLines(
      buckets.vaccination.map((line) => ({ text: line.text })),
    );

    const provider = getLlmProvider();
    const model =
      provider === 'gemini'
        ? (process.env.GEMINI_REPORT_MODEL ?? 'gemini-2.5-flash')
        : getOpenAiOrderedLinesModel();

    const client = await pool.connect();
    let saved: { runId: string; friendlyId: string };
    try {
      await client.query('BEGIN');
      saved = await saveFullParseRun({
        client,
        fileName: input.fileName || 'report.pdf',
        fileBuffer: binary,
        chartType,
        provider,
        model,
        parserVersion: 'text-bucket-v1',
        rawPayload: { ...responsePayload, vaccinationRecords },
        chartBodyByDate: chartBodyByDate.map((group) => ({
          dateTime: group.dateTime,
          bodyText: group.bodyText,
          planText: group.planText,
          planDetected: group.planDetected,
        })),
        labItemsByDate: labItemsByDate.map((group) => ({
          dateTime: group.dateTime,
          items: group.items.map((item) => ({
            itemName: item.itemName,
            rawItemName: item.rawItemName,
            valueText: item.valueText,
            unit: item.unit,
            referenceRange: item.referenceRange,
            flag: item.flag,
          })),
        })),
        vaccinationRecords,
        vitals: mergedVitals,
        physicalExamItems,
        basicInfoParsed: parsedBasicInfo,
        hospitalId: input.hospitalId,
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const debugPayload = {
      llmLineCount: llmLines.length,
      ocrRowCount: ocr.rows.length,
      llmPageCount: llmCoveredPages.size,
      ocrSupplementPageCount: new Set(ocrSupplementLines.map((l) => l.page)).size,
      effectivePdfLineCount: effectivePdfLines.length,
      sanitizedLineCount: sanitizedLines.length,
      bucketSizes: {
        basicInfo: buckets.basicInfo.length,
        chartBody: buckets.chartBody.length,
        lab: buckets.lab.length,
        vitals: buckets.vitals.length,
      },
      effectiveHead: effectivePdfLines.slice(0, 10).map((l) => `p${l.page}: ${l.text}`),
      bucketLines: {
        basicInfo: buckets.basicInfo.map((l) => `p${l.page}: ${l.text}`),
        vitals: buckets.vitals.map((l) => `p${l.page}: ${l.text}`),
        chartBody: buckets.chartBody.map((l) => `p${l.page}: ${l.text}`),
        lab: buckets.lab.map((l) => `p${l.page}: ${l.text}`),
      },
    };
    try {
      writeFileSync(
        'C:/Users/tj900/Downloads/bucket-debug.json',
        JSON.stringify(debugPayload, null, 2),
        'utf8',
      );
    } catch (_) {
      /* non-fatal */
    }

    return NextResponse.json({
      runId: saved.runId,
      friendlyId: saved.friendlyId,
      _debug: debugPayload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('POST /api/text-bucketing:', error);
    return NextResponse.json(
      { error: `Text bucket pipeline failed: ${message}` },
      { status: 500 },
    );
  }
}
