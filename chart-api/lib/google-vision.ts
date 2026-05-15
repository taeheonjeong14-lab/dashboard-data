import vision from '@google-cloud/vision';
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'node:crypto';

type VisionVertex = {
  x: number;
  y: number;
};

type VisionWord = {
  text: string;
  vertices: VisionVertex[];
  page: number;
};

export type OcrRow = {
  page: number;
  y: number;
  text: string;
  tokens: string[];
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
};

export type VisionOcrResult = {
  text: string;
  confidence: number | null;
  rows: OcrRow[];
  debug?: {
    wordsFromFullText: number;
    wordsFromTextAnnotations: number;
    rowsWithCoordinates: number;
    totalRows: number;
  };
};

let cachedClient: InstanceType<typeof vision.ImageAnnotatorClient> | null = null;
let cachedStorage: Storage | null = null;

function normalizePrivateKey(rawKey: string) {
  return rawKey.replace(/\\n/g, '\n');
}

function getVisionClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const clientEmail = process.env.GOOGLE_CLOUD_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    cachedClient = new vision.ImageAnnotatorClient({
      credentials: {
        client_email: clientEmail,
        private_key: normalizePrivateKey(privateKey),
      },
    });
    return cachedClient;
  }

  cachedClient = new vision.ImageAnnotatorClient();
  return cachedClient;
}

function getStorageClient() {
  if (cachedStorage) {
    return cachedStorage;
  }

  const clientEmail = process.env.GOOGLE_CLOUD_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_CLOUD_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    cachedStorage = new Storage({
      credentials: {
        client_email: clientEmail,
        private_key: normalizePrivateKey(privateKey),
      },
    });
    return cachedStorage;
  }

  cachedStorage = new Storage();
  return cachedStorage;
}

function toVertexArray(
  vertices:
    | Array<{
        x?: number | null;
        y?: number | null;
      }>
    | undefined,
  normalizedVertices?:
    | Array<{
        x?: number | null;
        y?: number | null;
      }>
    | undefined,
): VisionVertex[] {
  if (vertices?.length) {
    return vertices.map((vertex) => ({
      x: vertex.x ?? 0,
      y: vertex.y ?? 0,
    }));
  }

  if (normalizedVertices?.length) {
    return normalizedVertices.map((vertex) => ({
      x: Math.round((vertex.x ?? 0) * 10000),
      y: Math.round((vertex.y ?? 0) * 10000),
    }));
  }

  return [];
}

function extractWordsFromFullTextAnnotation(annotation: unknown): VisionWord[] {
  const parsed = annotation as {
    pages?: Array<{
      blocks?: Array<{
        paragraphs?: Array<{
          words?: Array<{
            symbols?: Array<{ text?: string | null }>;
            boundingBox?: {
              vertices?: Array<{ x?: number | null; y?: number | null }>;
              normalizedVertices?: Array<{ x?: number | null; y?: number | null }>;
            };
          }>;
        }>;
      }>;
    }>;
  } | null;
  const words: VisionWord[] = [];

  for (const [pageIndex, page] of (parsed?.pages ?? []).entries()) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          const text = (word.symbols ?? [])
            .map((symbol) => symbol.text ?? '')
            .join('')
            .trim();

          if (!text) {
            continue;
          }

          words.push({
            text,
            vertices: toVertexArray(
              word.boundingBox?.vertices,
              word.boundingBox?.normalizedVertices,
            ),
            page: pageIndex + 1,
          });
        }
      }
    }
  }

  return words;
}

function extractWordsFromTextAnnotations(
  textAnnotations:
    | Array<{
        description?: string | null;
        boundingPoly?: {
          vertices?: Array<{ x?: number | null; y?: number | null }>;
        };
      }>
    | undefined,
  page: number,
): VisionWord[] {
  if (!textAnnotations || textAnnotations.length <= 1) {
    return [];
  }

  const words: VisionWord[] = [];
  for (const annotation of textAnnotations.slice(1)) {
    const text = (annotation.description ?? '').trim();
    if (!text) {
      continue;
    }
    words.push({
      text,
      vertices: toVertexArray(annotation.boundingPoly?.vertices),
      page,
    });
  }
  return words;
}

function averageY(vertices: VisionVertex[]) {
  if (vertices.length === 0) {
    return 0;
  }
  const sum = vertices.reduce((accumulator, vertex) => accumulator + vertex.y, 0);
  return sum / vertices.length;
}

function minX(vertices: VisionVertex[]) {
  if (vertices.length === 0) {
    return 0;
  }
  return Math.min(...vertices.map((vertex) => vertex.x));
}

function maxX(vertices: VisionVertex[]) {
  if (vertices.length === 0) {
    return 0;
  }
  return Math.max(...vertices.map((vertex) => vertex.x));
}

function minY(vertices: VisionVertex[]) {
  if (vertices.length === 0) {
    return 0;
  }
  return Math.min(...vertices.map((vertex) => vertex.y));
}

function maxY(vertices: VisionVertex[]) {
  if (vertices.length === 0) {
    return 0;
  }
  return Math.max(...vertices.map((vertex) => vertex.y));
}

function toRows(words: VisionWord[]): OcrRow[] {
  const groupedByPage = new Map<number, VisionWord[]>();

  for (const word of words) {
    const pageWords = groupedByPage.get(word.page) ?? [];
    pageWords.push(word);
    groupedByPage.set(word.page, pageWords);
  }

  const rows: OcrRow[] = [];
  const rowThresholdPx = 12;

  for (const [pageNumber, pageWords] of groupedByPage.entries()) {
    const sortedWords = [...pageWords].sort((a, b) => {
      const yDiff = averageY(a.vertices) - averageY(b.vertices);
      if (Math.abs(yDiff) > rowThresholdPx) {
        return yDiff;
      }
      return minX(a.vertices) - minX(b.vertices);
    });

    const pageRows: Array<{ y: number; words: VisionWord[] }> = [];

    for (const word of sortedWords) {
      const y = averageY(word.vertices);
      const lastRow = pageRows[pageRows.length - 1];

      if (!lastRow || Math.abs(lastRow.y - y) > rowThresholdPx) {
        pageRows.push({ y, words: [word] });
        continue;
      }

      lastRow.words.push(word);
      lastRow.y = (lastRow.y + y) / 2;
    }

    for (const row of pageRows) {
      const orderedWords = [...row.words].sort(
        (a, b) => minX(a.vertices) - minX(b.vertices),
      );
      const tokens = orderedWords.map((word) => word.text);
      const allVertices = orderedWords.flatMap((word) => word.vertices);
      rows.push({
        page: pageNumber,
        y: Math.round(row.y),
        text: tokens.join(' ').trim(),
        tokens,
        xMin: allVertices.length > 0 ? minX(allVertices) : null,
        xMax: allVertices.length > 0 ? maxX(allVertices) : null,
        yMin: allVertices.length > 0 ? minY(allVertices) : null,
        yMax: allVertices.length > 0 ? maxY(allVertices) : null,
      });
    }
  }

  return rows;
}

function getTextFromRows(rows: OcrRow[]) {
  return rows.map((row) => row.text).join('\n').trim();
}

function tokenizeLine(line: string) {
  return line
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildRowsFromPlainText(text: string, page: number): OcrRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => ({
    page,
    y: (index + 1) * 10,
    text: line,
    tokens: tokenizeLine(line),
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
  }));
}

async function runGoogleVisionPdfOcr(fileBuffer: Buffer): Promise<VisionOcrResult> {
  const inputBucketName = process.env.GOOGLE_CLOUD_OCR_INPUT_BUCKET;
  const outputBucketName =
    process.env.GOOGLE_CLOUD_OCR_OUTPUT_BUCKET ?? inputBucketName;

  if (!inputBucketName || !outputBucketName) {
    throw new Error(
      'PDF OCR requires GOOGLE_CLOUD_OCR_INPUT_BUCKET and GOOGLE_CLOUD_OCR_OUTPUT_BUCKET env vars.',
    );
  }

  const client = getVisionClient();
  const storage = getStorageClient();

  const requestId = `${Date.now()}-${randomUUID()}`;
  const inputObjectPath = `ocr-input/${requestId}.pdf`;
  const outputPrefix = `ocr-output/${requestId}`;
  const outputUri = `gs://${outputBucketName}/${outputPrefix}/`;
  const inputUri = `gs://${inputBucketName}/${inputObjectPath}`;

  const inputBucket = storage.bucket(inputBucketName);
  const outputBucket = storage.bucket(outputBucketName);

  await inputBucket.file(inputObjectPath).save(fileBuffer, {
    metadata: { contentType: 'application/pdf' },
  });

  const [operation] = await client.asyncBatchAnnotateFiles({
    requests: [
      {
        inputConfig: {
          gcsSource: { uri: inputUri },
          mimeType: 'application/pdf',
        },
        outputConfig: {
          gcsDestination: { uri: outputUri },
          batchSize: 5,
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['ko', 'en'] },
      },
    ],
  });

  await operation.promise();

  const [outputFiles] = await outputBucket.getFiles({ prefix: outputPrefix });
  if (outputFiles.length === 0) {
    throw new Error('PDF OCR finished but no output files were generated.');
  }

  const extractedWords: VisionWord[] = [];
  let wordsFromFullText = 0;
  let wordsFromTextAnnotations = 0;
  let fallbackText = '';
  const fallbackRows: OcrRow[] = [];
  let inferredPage = 1;

  for (const outputFile of outputFiles) {
    const [buffer] = await outputFile.download();
    const payload = JSON.parse(buffer.toString('utf-8')) as {
      responses?: Array<{
        error?: { message?: string };
        fullTextAnnotation?: {
          text?: string;
          pages?: Array<unknown>;
        };
        textAnnotations?: Array<{ description?: string }>;
        responses?: Array<{
          error?: { message?: string };
          fullTextAnnotation?: {
            text?: string;
            pages?: Array<unknown>;
          };
          textAnnotations?: Array<{ description?: string }>;
        }>;
      }>;
    };

    for (const response of payload.responses ?? []) {
      const pageResponses = response.responses?.length ? response.responses : [response];

      for (const pageResponse of pageResponses) {
        if (pageResponse.error?.message) {
          throw new Error(`Vision OCR page error: ${pageResponse.error.message}`);
        }

        const words = extractWordsFromFullTextAnnotation(
          pageResponse.fullTextAnnotation,
        ).map((w) => ({ ...w, page: inferredPage }));
        if (words.length > 0) {
          extractedWords.push(...words);
          wordsFromFullText += words.length;
        } else {
          const fallbackWords = extractWordsFromTextAnnotations(
            pageResponse.textAnnotations,
            inferredPage,
          );
          extractedWords.push(...fallbackWords);
          wordsFromTextAnnotations += fallbackWords.length;
        }

        const plainText =
          pageResponse.fullTextAnnotation?.text ??
          pageResponse.textAnnotations?.[0]?.description ??
          '';

        if (plainText) {
          fallbackText = fallbackText
            ? `${fallbackText}\n${plainText}`
            : plainText;
          fallbackRows.push(...buildRowsFromPlainText(plainText, inferredPage));
        }

        inferredPage += 1;
      }
    }
  }

  await Promise.allSettled([
    inputBucket.file(inputObjectPath).delete({ ignoreNotFound: true }),
    ...outputFiles.map((file) => file.delete({ ignoreNotFound: true })),
  ]);

  let rows = toRows(extractedWords);
  if (rows.length <= 1 && fallbackRows.length > 0) {
    rows = fallbackRows;
  }

  const text = getTextFromRows(rows) || fallbackText.trim();

  return {
    text,
    confidence: null,
    rows,
    debug: {
      wordsFromFullText,
      wordsFromTextAnnotations,
      rowsWithCoordinates: rows.filter(
        (row) =>
          row.xMin !== null &&
          row.xMax !== null &&
          row.yMin !== null &&
          row.yMax !== null,
      ).length,
      totalRows: rows.length,
    },
  };
}

export async function runGoogleVisionOcr(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<VisionOcrResult> {
  if (mimeType === 'application/pdf') {
    return runGoogleVisionPdfOcr(fileBuffer);
  }

  const client = getVisionClient();
  const base64 = fileBuffer.toString('base64');

  const [result] = await client.documentTextDetection({
    image: { content: base64 },
    imageContext: {
      languageHints: ['ko', 'en'],
    },
  });

  const page = result.fullTextAnnotation?.pages?.[0];
  const detectedRows = toRows(
    extractWordsFromFullTextAnnotation(result.fullTextAnnotation),
  );
  const fallbackText = result.fullTextAnnotation?.text ?? '';
  const fallbackRows = buildRowsFromPlainText(fallbackText, 1);
  const rows = detectedRows.length <= 1 ? fallbackRows : detectedRows;
  return {
    text: getTextFromRows(rows) || fallbackText,
    confidence: (page as { confidence?: number } | undefined)?.confidence ?? null,
    rows,
    debug: {
      wordsFromFullText: detectedRows.length > 0 ? detectedRows.length : 0,
      wordsFromTextAnnotations: 0,
      rowsWithCoordinates: rows.filter(
        (row) =>
          row.xMin !== null &&
          row.xMax !== null &&
          row.yMin !== null &&
          row.yMax !== null,
      ).length,
      totalRows: rows.length,
    },
  };
}
