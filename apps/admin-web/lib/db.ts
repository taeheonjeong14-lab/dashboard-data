import pg from 'pg';

const globalForPool = globalThis as unknown as { adminWebPgPool: pg.Pool | undefined };

function supabaseLikeHost(connectionString: string): boolean {
  try {
    const u = connectionString.replace(/^postgresql:\/\//, 'postgres://');
    const host = new URL(u).hostname.toLowerCase();
    return host.endsWith('supabase.co') || host.endsWith('pooler.supabase.com');
  } catch {
    return /supabase\.co|pooler\.supabase\.com/i.test(connectionString);
  }
}

export function getAdminWebPgPool(): pg.Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!globalForPool.adminWebPgPool) {
    const insecureSsl =
      process.env.PGSSL_INSECURE === '1' ||
      process.env.PGSSL_INSECURE === 'true' ||
      supabaseLikeHost(url);
    globalForPool.adminWebPgPool = new pg.Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 20_000,
      ...(insecureSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    // 유휴 커넥션이 풀러/DB 쪽에서 끊길 때(ECONNRESET 등) 나는 에러를 잡지 않으면
    // 프로세스가 uncaughtException 으로 떨어진다. 풀은 죽은 커넥션을 알아서 버리므로 로그만 남긴다.
    globalForPool.adminWebPgPool.on('error', (err) => {
      console.warn('[pg pool] idle client error (무시 가능):', err.message);
    });
  }
  return globalForPool.adminWebPgPool;
}

export async function withPgTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = getAdminWebPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

