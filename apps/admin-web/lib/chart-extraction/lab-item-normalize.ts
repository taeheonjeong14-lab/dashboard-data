/**
 * 단일 소스: @dashboard/lab-normalize 재export.
 * chart-api / admin-web 양쪽이 동일한 정규화 로직을 쓰도록 통합됨.
 *
 * ※ 배포 주의: 표준 항목 목록(RECOGNIZED_LAB_ITEMS)은 **브라우저 번들에 박혀** 나간다.
 *   패키지만 고치고 admin-web 을 재배포하지 않으면, 추출 결과는 맞는데 화면만 "정규화 실패"
 *   주황색으로 남는다(실제로 Cl(corr) 신설 때 그랬다). Vercel Ignored Build Step 이
 *   apps/admin-web 경로만 보면 이 경우를 놓치므로 packages 도 함께 감시해야 한다.
 */
export {
  canonicalizeLabItemName,
  isRecognizedLabItem,
  type LabCanonicalizeSpecies,
} from '@dashboard/lab-normalize';
