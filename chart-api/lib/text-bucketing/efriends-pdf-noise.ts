/**
 * 이프렌즈 PDF 푸터 등: 줄 전체가 "날짜 + 오전/오후 + 시각"만 있는 경우 (본문 검사 줄이 아님).
 * 다른 차트에는 적용하지 않는다.
 */
const EFRIENDS_STANDALONE_KO_DATETIME_LINE =
  /^20\d{2}[./-]\d{1,2}[./-]\d{1,2}\s+(?:오전|오후)\s+[0-2]?\d:[0-5]\d(?::[0-5]\d)?(?:\s+page\b.*)?$/i;

export function isEfriendsPdfFooterDateTimeLine(text: string): boolean {
  return EFRIENDS_STANDALONE_KO_DATETIME_LINE.test(text.trim());
}

/**
 * 이프렌즈 PDF 푸터: "Page. 15" 형태의 페이지 번호 단독 줄.
 * 날짜 줄과 별도 줄로 출력될 때도 노이즈로 처리한다.
 */
const EFRIENDS_STANDALONE_PAGE_LINE = /^Page\.?\s*\d+$/i;

export function isEfriendsPdfFooterPageLine(text: string): boolean {
  return EFRIENDS_STANDALONE_PAGE_LINE.test(text.trim());
}

/**
 * 페이지 상단·중간에 반복되는 `진료기록- 보호자(환자)` 형태 헤더.
 * 변형 허용: 공백 삽입(진료 기록), 병원명 접두사(정든동물병원 진료기록 - …)
 */
export function isEfriendsClinicalRecordBannerLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  // "진료기록 - 임예린(뿌)" or "진료 기록 - 임 예린 ( 뽀 )"
  if (/^진료\s*기록\s*-\s*.+\(.+\)$/.test(t)) return true;
  // "정든동물병원 진료기록 - 임예린(뿌)" — hospital name prefix
  if (/^[가-힣0-9 ]+병원\s+진료\s*기록\s*-\s*.+\(.+\)$/.test(t)) return true;
  return false;
}

/**
 * 같은 헤더 블록의 단독 병원명 줄(한글 …병원). 영문 본문/검사 줄은 제외.
 */
export function isEfriendsStandaloneHospitalBannerLine(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > 48) return false;
  if (!/[가-힣]/.test(t)) return false;
  if (/[A-Za-z]{4,}/.test(t)) return false;
  return /(?:동물)?병원$/.test(t);
}

/** 병원명 단독 + 진료기록 배너 — PDF 반복 헤더 노이즈 */
export function isEfriendsRepeatingPdfHeaderLine(text: string): boolean {
  return isEfriendsClinicalRecordBannerLine(text) || isEfriendsStandaloneHospitalBannerLine(text);
}
