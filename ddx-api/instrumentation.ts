/**
 * Next 전역 서버 오류 훅 — 라우트 수정 없이 "던져진" 예외를 core.error_logs 에 적재.
 * 스스로 try/catch 후 5xx 를 리턴하는 라우트는 여기로 안 오므로 withErrorLog 로 별도 포착.
 */
import { makeOnRequestError } from '@dashboard/error-log';

export const onRequestError = makeOnRequestError({ app: 'ddx-api' });
