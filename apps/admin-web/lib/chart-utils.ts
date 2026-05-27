/**
 * Y축 자동 설정.
 *
 * 정책:
 * - 시작은 항상 0 (broken axis 미지원 → 시작점 이동은 misleading).
 * - 상단은 "nice step × N" 형태 (N ∈ [4, 6]), overshoot 최소가 되도록 선택.
 * - ticks 는 0, step, 2*step, ..., N*step 으로 명시 전달 (recharts 가 4분할로 보간하면
 *   1.25M 같은 어색한 step 이 나오는 걸 방지).
 * - 동률(top 같음) 시 N 작은 쪽(눈금 수 적은 쪽) 선호 = 깔끔.
 */

const NICE_STEPS = [
  1, 2, 5, 10, 20, 25, 50,
  100, 200, 250, 500,
  1000, 2000, 2500, 5000,
  10000, 20000, 25000, 50000,
  100000, 200000, 250000, 500000,
  1000000, 2000000, 2500000, 5000000,
  10000000, 20000000, 25000000, 50000000,
  100000000, 200000000, 500000000,
  1000000000, 2000000000, 5000000000,
];

export type YAxisConfig = {
  domain: [0, number];
  ticks: number[];
};

export function computeYAxisConfig(dataMax: number): YAxisConfig {
  const target = Math.max(0, dataMax) * 1.02;
  if (target <= 0) {
    return { domain: [0, 1], ticks: [0, 1] };
  }

  let best: { step: number; N: number; top: number; overshoot: number } | null = null;
  for (const step of NICE_STEPS) {
    for (const N of [4, 5, 6]) {
      const top = step * N;
      if (top >= target) {
        const overshoot = top - target;
        if (
          !best ||
          overshoot < best.overshoot ||
          (overshoot === best.overshoot && N < best.N)
        ) {
          best = { step, N, top, overshoot };
        }
      }
    }
  }

  if (!best) {
    const top = Math.max(1, Math.ceil(target));
    return { domain: [0, top], ticks: [0, top] };
  }
  const ticks = Array.from({ length: best.N + 1 }, (_, i) => i * best.step);
  return { domain: [0, best.top], ticks };
}

/**
 * 배열에서 null/NaN 제외 최대값. 모두 null 이면 0 반환.
 */
export function maxOfNullable(values: ReadonlyArray<number | null | undefined>): number {
  let m = 0;
  for (const v of values) {
    if (v != null && Number.isFinite(v) && v > m) m = v;
  }
  return m;
}
