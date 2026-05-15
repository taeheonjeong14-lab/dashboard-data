import type { ChartKind } from '@/lib/text-bucketing/chart-kind';
import {
  isDiagnosisTrendSectionTitle,
  isLabSectionHeader,
  isPlusVetDiagnosticResultsSectionTitle,
  shouldEndBasicInfo,
} from '@/lib/text-bucketing/chart-bucket-rules';
import {
  extractPlusVetLabSectionAnchorDateTime,
  isPlusVetChartVisitHeaderLine,
  isPlusVetLabMachinePanelHeaderLine,
  isVisitContextLine,
} from '@/lib/text-bucketing/chart-dates';
import type { OcrRow } from '@/lib/google-vision';
import { minimalOcrCorrection, type OrderedLine, type BucketedLine } from '@/lib/text-bucketing/ocr-line-correction';

export type BucketName = 'basicInfo' | 'chartBody' | 'vaccination' | 'lab' | 'vitals';

/**
 * 영문 "Vaccination"으로 줄이 시작하면(선행 ▶ 허용) vaccination 구간으로 본다.
 * CC / Subject 줄은 제외. 한글 접종·예방만으로는 버킷을 열지 않는다.
 */
function isEnglishVaccinationSectionHeaderLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/^CC\s*[:：]/i.test(t)) return false;
  if (/^Subject\b/i.test(t)) return false;
  return /^(?:▶\s*)?vaccination\b/i.test(t);
}

export function assignLinesToBuckets(
  sanitizedLines: OrderedLine[],
  ocrRows: OcrRow[],
  chartKind: ChartKind,
): Record<BucketName, BucketedLine[]> {
  const buckets: Record<BucketName, BucketedLine[]> = {
    basicInfo: [],
    chartBody: [],
    vaccination: [],
    lab: [],
    vitals: [],
  };

  let section: BucketName = 'chartBody';
  let basicInfoOpen = true;
  /** PlusVet: "진단 검사 결과" 이후 ~ 첫 시각 앵커 전까지는 chartBody (중복 기본정보) */
  let plusvetDiagnosticResultsSection = false;

  for (let i = 0; i < sanitizedLines.length; i += 1) {
    const line = sanitizedLines[i];
    const next1 = sanitizedLines[i + 1]?.text ?? '';
    const next2 = sanitizedLines[i + 2]?.text ?? '';
    const normalized = line.text.toLowerCase();
    if (basicInfoOpen) {
      const efriendsVisitContextPair =
        chartKind === 'efriends' &&
        /^date\s*:\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/i.test(line.text.replace(/\s+/g, ' ').trim()) &&
        (
          /purpose of visit\s*:/i.test(line.text) ||
          /record user\s*:/i.test(line.text) ||
          /purpose of visit\s*:/i.test(next1) || /record user\s*:/i.test(next1) ||
          /purpose of visit\s*:/i.test(next2) || /record user\s*:/i.test(next2)
        );
      if (shouldEndBasicInfo(line.text, chartKind) || efriendsVisitContextPair) {
        basicInfoOpen = false;
        section = 'chartBody';
      } else {
        buckets.basicInfo.push({
          page: line.page,
          text: line.text,
          corrected: false,
        });
        continue;
      }
    }

    /**
     * 인투벳·기타: 방문마다 차트 끝에 "예방 접종 및 기생충" 문진이 붙음.
     * vaccination으로 넘긴 뒤에도 다음 `[재진] [날짜]…` 가 오면 새 방문 chartBody로 복귀해야 함.
     * (그렇지 않으면 첫 방문 문진 이후 모든 줄이 영구히 vaccination 버킷에만 쌓임)
     */
    if (
      section === 'vaccination' &&
      (chartKind === 'intovet' || chartKind === 'other' || chartKind === 'efriends') &&
      isVisitContextLine(line.text)
    ) {
      section = 'chartBody';
      buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
      continue;
    }

    if (section === 'lab' && isDiagnosisTrendSectionTitle(line.text)) {
      section = 'chartBody';
      if (chartKind === 'plusvet') {
        plusvetDiagnosticResultsSection = false;
      }
      buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
      continue;
    }

    if (chartKind === 'plusvet' && section === 'lab' && isPlusVetChartVisitHeaderLine(line.text)) {
      section = 'chartBody';
      buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
      continue;
    }

    if (chartKind === 'plusvet') {
      if (isPlusVetDiagnosticResultsSectionTitle(normalized, line.text)) {
        plusvetDiagnosticResultsSection = true;
        section = 'chartBody';
        buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
        continue;
      }
      if (plusvetDiagnosticResultsSection) {
        if (isEnglishVaccinationSectionHeaderLine(line.text)) {
          plusvetDiagnosticResultsSection = false;
          section = 'vaccination';
          buckets.vaccination.push({ page: line.page, text: line.text, corrected: false });
          continue;
        }
        if (/바이탈|vital/i.test(line.text)) {
          plusvetDiagnosticResultsSection = false;
          section = 'vitals';
          continue;
        }
        if (extractPlusVetLabSectionAnchorDateTime(line.text)) {
          section = 'lab';
          buckets.lab.push(minimalOcrCorrection(line, ocrRows));
          continue;
        }
        if (section === 'lab') {
          buckets.lab.push(minimalOcrCorrection(line, ocrRows));
          continue;
        }
        buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
        continue;
      }
      if (isPlusVetLabMachinePanelHeaderLine(line.text)) {
        section = 'lab';
        buckets.lab.push(minimalOcrCorrection(line, ocrRows));
        continue;
      }
    }

    if (chartKind === 'efriends') {
      const trimmed = line.text.replace(/\s+/g, ' ').trim();
      if (/^check list\b/i.test(trimmed)) {
        section = 'vitals';
        buckets.vitals.push({ page: line.page, text: line.text, corrected: false });
        continue;
      }
      if (section === 'vitals' && /^soap history\b/i.test(trimmed)) {
        section = 'chartBody';
        buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
        continue;
      }
    }

    if (isLabSectionHeader(normalized, line.text, chartKind)) {
      section = 'lab';
      continue;
    }
    if (isEnglishVaccinationSectionHeaderLine(line.text)) {
      plusvetDiagnosticResultsSection = false;
      section = 'vaccination';
      buckets.vaccination.push({ page: line.page, text: line.text, corrected: false });
      continue;
    }
    if (/바이탈|vital/i.test(line.text)) {
      section = 'vitals';
      continue;
    }

    if (section === 'lab') {
      if (chartKind === 'efriends') {
        const t = line.text.replace(/\s+/g, ' ').trim();
        if (/\bradiology\s+result\b/i.test(t)) {
          section = 'chartBody';
          buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
          continue;
        }
        if (/^check list\b/i.test(t)) {
          section = 'vitals';
          buckets.vitals.push({ page: line.page, text: line.text, corrected: false });
          continue;
        }
        if (/^soap history\b/i.test(t)) {
          section = 'chartBody';
          buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
          continue;
        }
      }
      buckets.lab.push(minimalOcrCorrection(line, ocrRows));
      continue;
    }
    if (section === 'vaccination') {
      buckets.vaccination.push({ page: line.page, text: line.text, corrected: false });
      continue;
    }
    if (section === 'vitals') {
      buckets.vitals.push({ page: line.page, text: line.text, corrected: false });
      continue;
    }

    buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
  }

  return buckets;
}

export type { OrderedLine, BucketedLine };
