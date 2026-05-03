import { prisma } from '@/lib/prisma';

export type VerifyEmailResult =
  | { success: true; alreadyVerified: boolean; email: string; message: string }
  | { success: false; error: string };

/** 토큰으로 이메일 인증 처리. API·서버 컴포넌트에서 공통 사용 */
export async function verifyEmailByToken(token: string): Promise<VerifyEmailResult> {
  if (!token?.trim()) {
    return { success: false, error: '인증 링크가 올바르지 않습니다.' };
  }

  const record = await prisma.emailVerification.findUnique({
    where: { token: token.trim() },
  });

  if (!record) {
    return { success: false, error: '유효하지 않거나 만료된 링크입니다.' };
  }
  if (record.verifiedAt) {
    return {
      success: true,
      alreadyVerified: true,
      email: record.email,
      message: '이미 인증된 이메일입니다. 관리자 승인 후 로그인할 수 있습니다.',
    };
  }
  if (new Date() > record.expiresAt) {
    return { success: false, error: '인증 링크가 만료되었습니다. 다시 인증 메일을 요청해 주세요.' };
  }

  await prisma.emailVerification.update({
    where: { id: record.id },
    data: { verifiedAt: new Date() },
  });

  await prisma.user.updateMany({
    where: { email: { equals: record.email, mode: 'insensitive' } },
    data: { emailVerified: true },
  });

  return {
    success: true,
    alreadyVerified: false,
    email: record.email,
    message: '이메일 인증이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.',
  };
}
