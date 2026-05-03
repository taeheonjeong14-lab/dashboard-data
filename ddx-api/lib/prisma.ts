import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not set');

  try {
    // Fail fast with the same validation pg uses (password special chars must be URL-encoded).
    new URL(url);
  } catch {
    throw new Error(
      'DATABASE_URL is not a valid URL. Remove wrapping quotes in Vercel, use one line, and URL-encode password characters like @ # % ? /'
    );
  }

  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query'] : undefined,
  });
}

function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrisma();
  }
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = globalForPrisma.prisma;
  }
  return globalForPrisma.prisma;
}

/** Lazy proxy so importing this module does not connect during `next build`. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') {
      return (value as (...a: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});
