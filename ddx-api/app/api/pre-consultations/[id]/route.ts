import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { analyzePreConsultationById } from '@/lib/survey-analysis';

async function getApprovedUser(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, approved: true, active: true, deletedAt: null },
    select: { id: true, hospitalId: true },
  });
}

// 단일 사전문진 조회 (목록 페이지 → record 페이지 선택 시 사용)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const user = await getApprovedUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const preConsultation = await prisma.preConsultation.findUnique({
      where: { id },
      select: {
        id: true,
        hospitalId: true,
        patientName: true,
        guardianName: true,
        tallyData: true,
        questions: true,
        createdAt: true,
        isUsed: true,
        analysisStatus: true,
        draftSummary: true,
        draftDdx: true,
        followUpQuestions: true,
      },
    });
    
    if (!preConsultation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if ((user.hospitalId ?? null) !== (preConsultation.hospitalId ?? null)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ success: true, preConsultation });
  } catch (e) {
    console.error('Pre-consultation get error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// 사전문진을 사용 표시하고 consultation에 연결
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const user = await getApprovedUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const existing = await prisma.preConsultation.findUnique({
      where: { id },
      select: { id: true, hospitalId: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    if ((user.hospitalId ?? null) !== (existing.hospitalId ?? null)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { consultationId } = body;

    await prisma.preConsultation.update({
      where: { id },
      data: {
        isUsed: true,
        consultationId: consultationId || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Pre-consultation update error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/pre-consultations/[id]?userId=xxx — 재분석 트리거 (내 병원 것만)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const user = await getApprovedUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const pc = await prisma.preConsultation.findUnique({
      where: { id },
      select: { id: true, hospitalId: true, analysisStatus: true },
    });
    if (!pc) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (user.hospitalId && pc.hospitalId !== user.hospitalId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (pc.analysisStatus === 'processing') {
      return NextResponse.json({ success: true, message: 'already_processing' });
    }

    await prisma.preConsultation.update({
      where: { id },
      data: { analysisStatus: 'pending' },
    });

    void analyzePreConsultationById(id).catch((e) =>
      console.error('reanalyze analyzePreConsultationById failed:', e),
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Pre-consultation reanalyze error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
