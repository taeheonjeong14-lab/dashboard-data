import { createHash } from 'node:crypto';
import { capSize, redactPayload } from './redact';

/**
 * core.error_logs 적재 — 앱 무관 공용 적재기.
 * 각 앱의 주 DB 접근 방식(supabase-js / pg / prisma)과 무관하게 동작하도록,
 * Supabase service-role REST(PostgREST)로 직접 INSERT 한다. 추가 의존성 없음.
 * admin 에러 로그 화면(/admin/error-logs)의 원본. 마스킹 규칙은 redact.ts 한 곳에만.
 */

/**
 * withErrorLog 가 이미 적재한 예외에 붙이는 표식.
 * 표식이 없으면 예외가 Next 까지 올라가 onRequestError 에서 한 번 더 적재된다(중복).
 * Symbol.for 를 쓰는 이유: 번들이 갈려도 같은 심볼로 해석되게 하려고.
 */
export const ALREADY_LOGGED = Symbol.for('dashboard.errorAlreadyLogged');

export function markLogged(err: unknown): void {
  if (err && typeof err === 'object') {
    try {
      (err as Record<symbol, unknown>)[ALREADY_LOGGED] = true;
    } catch {
      /* frozen 객체면 포기 — 중복 한 건이 유실보다 낫다 */
    }
  }
}

export function isAlreadyLogged(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as Record<symbol, unknown>)[ALREADY_LOGGED] === true;
}

/** route + 정규화한 message. 숫자·UUID를 지워 같은 종류의 에러가 한 지문으로 묶이게 한다. */
export function fingerprintOf(route: string | null, message: string): string {
  const normalized = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d+/g, '<n>')
    .slice(0, 300);
  return createHash('sha1').update(`${route ?? ''}|${normalized}`).digest('hex').slice(0, 16);
}

export type ErrorLogInput = {
  /** 어느 앱에서 났는지. 'hospital-web' | 'admin-web' | 'chart-api' | 'ddx-api' … */
  app: string;
  source: 'server' | 'client';
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  feature?: string | null;
  message: string;
  stack?: string | null;
  hospitalId?: string | null;
  userId?: string | null;
  /** 원문 그대로 넘겨도 된다. 저장 직전 redactPayload 를 통과한다. */
  requestBody?: unknown;
  context?: Record<string, unknown>;
};

function supabaseEnv(): { url: string; key: string } {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, key };
}

/**
 * 절대 throw 하지 않는다. 로깅 실패가 원래 요청을 더 망가뜨리면 안 된다.
 * 적재가 요청을 붙잡지 않도록 4초 타임아웃.
 */
export async function logError(input: ErrorLogInput): Promise<void> {
  try {
    const { url, key } = supabaseEnv();
    if (!url || !key) {
      console.error('[error-log] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 없음 — 적재 스킵:', input.message);
      return;
    }

    const message = (input.message || 'Unknown error').slice(0, 2_000);
    const route = input.route ?? null;
    const row = {
      app: input.app,
      source: input.source,
      route,
      method: input.method ?? null,
      status_code: input.statusCode ?? null,
      feature: input.feature ?? null,
      message,
      stack: input.stack ? input.stack.slice(0, 8_000) : null,
      hospital_id: input.hospitalId ?? null,
      user_id: input.userId ?? null,
      request_body: input.requestBody === undefined ? null : capSize(redactPayload(input.requestBody)),
      context: (capSize(redactPayload(input.context ?? {})) ?? {}) as Record<string, unknown>,
      fingerprint: fingerprintOf(route, message),
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4_000);
    try {
      const res = await fetch(`${url}/rest/v1/error_logs`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Profile': 'core', // error_logs 는 core 스키마
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('[error-log] 적재 실패:', res.status, body.slice(0, 300));
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error('[error-log] 적재 예외:', e instanceof Error ? e.message : e);
  }
}
