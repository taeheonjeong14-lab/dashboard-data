/**
 * 단일 소스: @dashboard/lab-normalize 재export.
 * chart-api / admin-web 양쪽이 동일한 정규화 로직을 쓰도록 통합됨.
 */
export {
  canonicalizeLabItemName,
  isRecognizedLabItem,
  type LabCanonicalizeSpecies,
} from '@dashboard/lab-normalize';
