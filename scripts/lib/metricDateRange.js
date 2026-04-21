/**
 * KST 캘린더 기준 일별 metric_date 범위 계산 (블로그/스마트플레이스/SearchAd 공통 규칙).
 *
 * - endDate: 보통 KST 어제 (당일 데이터는 수집하지 않음)
 * - DB에 행이 없으면: endDate 포함 initialBackfillDays일 (end - (N-1) ~ end)
 * - DB에 max(metric_date)가 있으면: max+1 ~ endDate
 * - start > end 이면 empty (이미 최신)
 */

const INITIAL_BACKFILL_DAYS = 30;

function getKstYmdForInstant(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** @param {string} ymd YYYY-MM-DD @param {number} deltaDays */
function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0);
  return new Date(t).toISOString().slice(0, 10);
}

function getKstYesterdayString() {
  return addDaysYmd(getKstYmdForInstant(), -1);
}

/**
 * @param {string | null | undefined} maxMetricDate
 * @param {string} endDate YYYY-MM-DD
 * @param {number} [initialBackfillDays]
 * @returns {{ empty: boolean, startDate: string | null, endDate: string }}
 */
function computeMetricRange(maxMetricDate, endDate, initialBackfillDays = INITIAL_BACKFILL_DAYS) {
  const end = String(endDate).trim().slice(0, 10);
  const maxRaw =
    maxMetricDate != null && String(maxMetricDate).trim() !== "" ? String(maxMetricDate).trim().slice(0, 10) : null;
  let startDate;
  if (!maxRaw) {
    startDate = addDaysYmd(end, -(initialBackfillDays - 1));
  } else {
    startDate = addDaysYmd(maxRaw, 1);
  }
  if (startDate > end) {
    return { empty: true, startDate, endDate: end };
  }
  return { empty: false, startDate, endDate: end };
}

module.exports = {
  INITIAL_BACKFILL_DAYS,
  getKstYmdForInstant,
  addDaysYmd,
  getKstYesterdayString,
  computeMetricRange,
};
