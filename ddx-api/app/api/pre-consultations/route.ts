import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function getApprovedUser(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, approved: true, active: true, deletedAt: null },
    select: { id: true, hospitalId: true },
  });
}

// 사전문진 목록 조회 (all=true 시 매칭 여부 무관 전체, 미지정 시 미사용만)
// userId 쿼리 있으면 해당 사용자 소속 병원 것만 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId')?.trim();
    const patientName = searchParams.get('patientName')?.trim();
    const guardianName = searchParams.get('guardianName')?.trim();
    const limit = Math.min(Number(searchParams.get('limit')) || 20, 100);
    const includeUsed = searchParams.get('all') === 'true' || searchParams.get('includeUsed') === 'true';

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const user = await getApprovedUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const where: any = {};
    if (!includeUsed) where.isUsed = false;
    if (patientName) where.patientName = { contains: patientName, mode: 'insensitive' };
    if (guardianName) where.guardianName = { contains: guardianName, mode: 'insensitive' };
    // Hospital scoping: only pre-consultations under the same hospital are visible.
    // If the user has no hospitalId, only hospitalId = null is visible.
    where.hospitalId = user.hospitalId ?? null;

    const preConsultations = await prisma.preConsultation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        patientName: true,
        guardianName: true,
        createdAt: true,
        tallyData: true,
        questions: true,
        isUsed: true,
        analysisStatus: true,
        draftSummary: true,
        draftDdx: true,
        followUpQuestions: true,
      },
    });

    return NextResponse.json({ success: true, preConsultations });
  } catch (e) {
    console.error('Pre-consultations fetch error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
