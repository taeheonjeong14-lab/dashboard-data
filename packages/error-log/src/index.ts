/**
 * @dashboard/error-log — 앱 무관 공용 에러 적재.
 * core.error_logs(admin /admin/error-logs 원본)에 Supabase service-role REST 로 직접 INSERT.
 * hospital-web·admin-web·chart-api·ddx-api 어디서든 drop-in.
 *
 * 두 겹 그물:
 *   - makeOnRequestError → instrumentation.ts (던져진 예외 자동 포착)
 *   - withErrorLog       → 라우트 래퍼 (스스로 5xx 를 리턴하는 라우트까지 포착)
 *
 * 필요 env: SUPABASE_URL(또는 NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 */
export {
  logError,
  markLogged,
  isAlreadyLogged,
  fingerprintOf,
  ALREADY_LOGGED,
  type ErrorLogInput,
} from './log-error';
export { withErrorLog, type Identify } from './with-error-log';
export { makeOnRequestError } from './on-request-error';
export { redactPayload, capSize, isRedactedKey, REDACT_KEYS } from './redact';
