import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/hospitals/master-hint?hospitalId= — 스태프 가입 시 그 병원 Master 이메일을 마스킹해 보여준다.
function maskEmail(email: string): string {
  const [id, domain] = email.split('@');
  if (!domain) return '***';
  const head = id.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, id.length - 2))}@${domain}`;
}

export async function GET(request: NextRequest) {
  const hospitalId = (request.nextUrl.searchParams.get('hospitalId') ?? '').trim();
  if (!hospitalId) return NextResponse.json({ masterEmail: null });
  try {
    const master = await prisma.user.findFirst({
      where: { hospitalId, hospitalRole: 'master', active: true, deletedAt: null },
      select: { email: true },
    });
    return NextResponse.json({ masterEmail: master?.email ? maskEmail(master.email) : null });
  } catch (e) {
    console.error('GET /api/hospitals/master-hint error:', e);
    return NextResponse.json({ masterEmail: null });
  }
}
