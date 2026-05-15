import type { ChartKind } from '@/lib/text-bucketing/chart-kind';
import { isVisitContextLine } from '@/lib/text-bucketing/chart-dates';

/**
 * 상단 환자/병원 블록이 끝나고 본 차트가 시작됐다고 볼 조건.
 * - IntoVet: 기존 방문 앵커만 (영문 차트 + 대괄호 방문 시각)
 * - PlusVet/기타: 동일 앵커 또는 "한 줄짜리 방문일시" 형태까지 허용
 */
export function shouldEndBasicInfo(lineText: string, kind: ChartKind): boolean {
  if (isVisitContextLine(lineText)) return true;
  if (kind === 'efriends') {
    const t = lineText.replace(/\s+/g, ' ').trim();
    if (/^(check list|soap history|laboratory result)\b/i.test(t)) return true;
    if (/\bradiology\s+result\b/i.test(t)) return true;
    if (/^date\s*:\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/i.test(t)) return true;
  }
  if (kind === 'intovet') return false;
  const t = lineText.trim();
  return /^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+[0-2]?\d:[0-5]\d(?::[0-5]\d)?\s*$/.test(t);
}

/**
 * 플러스벳: 섹션 제목은 "진단 검사 결과" (Lab/lab examination 문구 없음).
 * 실제 표 데이터는 이 줄 **이후** `yyyy.mm.dd hh:mm` 앵커 줄부터 assign-buckets에서 lab으로 넣는다.
 */
export function isPlusVetDiagnosticResultsSectionTitle(_normalizedLine: string, originalLine: string): boolean {
  const spaced = originalLine.replace(/\s+/g, ' ').trim();
  const compact = spaced.replace(/\s/g, '');
  if (compact.includes('진단검사결과')) return true;
  return /진단\s+검사\s+결과/.test(spaced);
}

/**
 * 플러스벳 등: 원시 검사 줄 나열이 끝나고 "추이" 요약 표·병원/보호자 헤더가 시작되는 제목.
 * lab 버킷은 이 줄 **앞**에서 끝나야 함 (`진단 검사 결과` 블록과 별개 문구).
 */
export function isDiagnosisTrendSectionTitle(lineText: string): boolean {
  const spaced = lineText.replace(/\s+/g, ' ').trim();
  return /진단\s*결과\s*추이/.test(spaced);
}

/**
 * Lab 구간 시작 헤더.
 * - IntoVet: 영문 "Lab examination"
 * - PlusVet: 여기서는 처리하지 않음 (`진단 검사 결과` + 시각 앵커는 assign-buckets 전용)
 * - 기타: 한국어 진단검사 헤더 등
 */
export function isLabSectionHeader(normalizedLine: string, originalLine: string, kind: ChartKind): boolean {
  if (kind === 'plusvet') return false;
  if (normalizedLine.includes('lab examination')) return true;
  if (kind === 'intovet') return false;
  /** eFriends PDF: Idexx 표는 `Laboratory Result` / `Laboratory Result (by Item)` 블록 — chartBody와 분리 */
  if (kind === 'efriends' && normalizedLine.includes('laboratory result')) return true;
  /** eFriends: 방문별 인라인 검사 요약 표 헤더 (Name / Reference / Result / Unit 컬럼) */
  if (kind === 'efriends' && /^name\s+reference\s+result\s+unit\b/i.test(originalLine.replace(/\s+/g, ' ').trim())) return true;

  if (normalizedLine.includes('진단 검사 결과') || normalizedLine.includes('진단검사결과')) return true;
  if (normalizedLine.includes('진단검사')) return true;
  if (/(^|\s)임상\s*병리/.test(originalLine.replace(/\s+/g, ' '))) return true;
  if (normalizedLine.includes('검체 검사') || normalizedLine.includes('검체검사')) return true;
  if (/검사\s*결과\s*추이/.test(originalLine.replace(/\s+/g, ' '))) return true;

  return false;
}
