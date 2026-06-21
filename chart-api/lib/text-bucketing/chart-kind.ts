export type ChartKind = "intovet" | "plusvet" | "other" | "efriends" | "woorien_pms";

export function parseChartKind(raw: unknown): ChartKind {
  if (raw === "plusvet" || raw === "other" || raw === "intovet" || raw === "efriends" || raw === "woorien_pms") return raw;
  return "intovet";
}

export function chartTypeNoticeFor(kind: ChartKind): string | null {
  if (kind === "other") {
    return "기타 차트는 병원·버전마다 양식 차이가 커서 일부 구간이 누락되거나 잘못 나뉠 수 있습니다.";
  }
  if (kind === "woorien_pms") {
    return "우리엔PMS: S.O.A.P 일자별 기록 + 검사결과 패널 구조입니다. 초기 버전이라 일부 구간이 누락되거나 잘못 나뉠 수 있습니다.";
  }
  if (kind === "efriends") {
    return "이프렌즈: PDF에 혈액검사가 많습니다. EMR 차트를 붙여 넣으면 본문·기본정보 등을 함께 읽습니다(선택).";
  }
  return null;
}
