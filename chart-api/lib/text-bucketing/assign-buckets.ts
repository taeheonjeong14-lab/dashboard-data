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

/**
 * "바이탈" 섹션 시작 헤더인지(=section 을 vitals 로 전환해도 되는 줄).
 * 진료 O) 안의 데이터 줄 "- Vital sign : NRF" 처럼 'vital' 글자만 들어간 줄은 제외해야 한다.
 * (그렇지 않으면 그 줄 이후 A/Problem list/DDX/Rx/Plan 이 전부 vitals 로 새어 진료 본문이 잘린다.)
 */
function isVitalsSectionHeaderLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/^바이탈\s*$/.test(t)) return true; // 한국어 섹션 제목(단독 줄). \b 는 한글 뒤에서 안 잡혀 제외.
  return /^vital(?:\s*signs?)?$/i.test(t); // 영문 단독 제목만(콜론·값 붙은 데이터 줄 제외)
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
     * PlusVet 진료 헤더: 날짜+시각 줄이고 곧(3줄 내) Subjective가 따라오면, 그건 lab 시각 앵커가 아니라
     * 그 진료의 헤더다 → chartBody로 보낸다. 이렇게 해야 (1) 그 진료의 날짜가 chartBody 그룹 키로 잡히고
     * (앞 진료 날짜 재사용 방지), (2) 진료 시작 시 lab 모드가 아니어서 A/P/Plan이 lab으로 새지 않는다.
     */
    if (chartKind === 'plusvet') {
      const t0 = line.text.replace(/\s+/g, ' ').trim();
      const isDateTime = /^(?:\[)?\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}/.test(t0);
      const next3 = sanitizedLines[i + 3]?.text ?? '';
      const subjSoon = [next1, next2, next3].some((x) => /^subjective\b/i.test(x.replace(/\s+/g, ' ').trim()));
      if (isDateTime && subjSoon) {
        section = 'chartBody';
        plusvetDiagnosticResultsSection = false;
        buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
        continue;
      }
    }

    /**
     * PlusVet: "Subjective"는 새 진료의 시작이다. 어떤 섹션(특히 한번 들어가면 잘 못 빠져나오는 lab)에
     * 있든 chartBody로 복귀시킨다. 진료 헤더(`DATE | 재진 | 담당의`) 줄은 추출이 들쭉날쭉해 신뢰 불가 —
     * Subjective가 진료 경계를 가리키는 안정적 신호다. (이게 없으면 첫 lab 진입 후 모든 진료가 lab에 처박힘)
     */
    if (chartKind === 'plusvet' && /^subjective\b/i.test(line.text.replace(/\s+/g, ' ').trim())) {
      section = 'chartBody';
      plusvetDiagnosticResultsSection = false;
      buckets.chartBody.push({ page: line.page, text: line.text, corrected: false });
      continue;
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
        if (isVitalsSectionHeaderLine(line.text)) {
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
    // plusvet 은 엄격한 "바이탈" 헤더만 인정(인라인 'Vital sign : NRF' 오탐 방지). 그 외 종류는 기존 동작 유지.
    if (chartKind === 'plusvet' ? isVitalsSectionHeaderLine(line.text) : /바이탈|vital/i.test(line.text)) {
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
