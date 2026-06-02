/** 보고서 푸터용: "남기웅" -> "남 기 웅" */
export function spreadKoreanCharsForFooter(name: string): string {
  const t = name.replace(/\s+/g, '').trim();
  if (!t) return '';
  return Array.from(t).join(' ');
}

/** 예: 도담동물의료센터 -> `도담동물의료센터 원장` (directorTitle 지정 시 해당 직함 사용) */
export function formatDirectorHospitalLine(hospitalNameKo: string, directorTitle?: string | null): string {
  const hospital = hospitalNameKo.trim() || '병원명';
  const title = directorTitle?.trim() || '원장';
  return `${hospital} ${title}`;
}
