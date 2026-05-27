/**
 * Y축 자동 도메인.
 *
 * 정책:
 * - 시작은 항상 0. (broken axis 미지원: 시작점이 바뀌면 misleading)
 * - 상단은 "nice step × 4" 형태로 round → recharts 가 5개 균등 눈금을
 *   자동으로 0, step, 2*step, 3*step, 4*step 에 배치.
 * - nice step 은 1·2·5·10·20·25·50·100·... 같은 깔끔한 배수에서 선택.
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

function pickNiceTop(target: number): number {
  if (target <= 0) return NICE_STEPS[0] * 4;
  for (const step of NICE_STEPS) {
    if (step * 4 >= target) return step * 4;
  }
  return Math.ceil(target);
}

export const Y_AXIS_AUTO_DOMAIN: [number, (dataMax: number) => number] = [
  0,
  (dataMax) => pickNiceTop(dataMax * 1.02),
];
