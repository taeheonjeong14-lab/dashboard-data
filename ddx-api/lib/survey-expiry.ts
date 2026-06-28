// 사전문진 링크 만료 규칙: 내원 예정일(scheduledDate)이 7일 지나면 만료(pending → expired).
// 별도 status 저장/크론 없이 "읽을 때 derive" + 공개 작성 라우트에서 차단하는 방식으로 일관 적용한다.
// (completed/expired 는 그대로 — pending 만 만료로 전환)

export const SURVEY_EXPIRE_DAYS_AFTER_SCHEDULED = 7;

export function isSurveyExpired(status: string, scheduledDate: Date | string | null | undefined): boolean {
  if (status !== 'pending') return false;
  if (!scheduledDate) return false;
  const sched = scheduledDate instanceof Date ? scheduledDate : new Date(scheduledDate);
  if (Number.isNaN(sched.getTime())) return false;
  const deadline = sched.getTime() + SURVEY_EXPIRE_DAYS_AFTER_SCHEDULED * 24 * 60 * 60 * 1000;
  return Date.now() > deadline;
}

/** 저장된 status 를 만료 규칙으로 보정한 "실효 status". */
export function effectiveSurveyStatus(status: string, scheduledDate: Date | string | null | undefined): string {
  return isSurveyExpired(status, scheduledDate) ? 'expired' : status;
}
