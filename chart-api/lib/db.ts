import pg from 'pg';

const globalForPool = globalThis as unknown as { chartPgPool: pg.Pool | undefined };

export function getChartPgPool(): pg.Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!globalForPool.chartPgPool) {
    globalForPool.chartPgPool = new pg.Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    // 유휴 커넥션이 풀러/DB 쪽에서 끊길 때(ECONNRESET 등) 나는 에러를 잡지 않으면
    // 프로세스가 uncaughtException 으로 떨어진다. 풀은 죽은 커넥션을 알아서 버리므로 로그만 남긴다.
    globalForPool.chartPgPool.on('error', (err) => {
      console.warn('[pg pool] idle client error (무시 가능):', err.message);
    });
  }
  return globalForPool.chartPgPool;
}

export async function withPgTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = getChartPgPool();
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
