import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendVerificationEmail } from '@/lib/email';

// 가입 인증 메일 발송 + 토큰 저장. /api/users/profile 과 동일 흐름을 재사용.
function getBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (u && u.length > 0) return u.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/$/, '');
  return 'http://localhost:3000';
}

export async function sendSignupVerifyEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = email.toLowerCase();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.emailVerification.create({ data: { email: normalized, token, expiresAt } });
  const link = `${getBaseUrl()}/verify-email?token=${token}`;
  const r = await sendVerificationEmail(email, link);
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}
