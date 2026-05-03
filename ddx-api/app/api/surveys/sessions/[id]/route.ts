import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { analyzeSurveySessionById } from '@/lib/survey-analysis';

async function getApprovedUser(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, approved: true, active: true, deletedAt: null },
    select: { id: true, hospitalId: true },
  });
}

// GET /api/surveys/sessions/[id]?userId=xxx — 사전문진 세션 상세 (내 병원 것만)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params;
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const user = await getApprovedUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const session = await prisma.surveySession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        hospitalId: true,
        patientName: true,
        guardianName: true,
        contact: true,
        visitType: true,
        previousChartText: true,
        status: true,
        token: true,
        createdAt: true,
        completedAt: true,
        analysisStatus: true,
        draftSummary: true,
        draftDdx: true,
        followUpQuestions: true,
        questions: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            order: true,
            source: true,
            stage: true,
            text: true,
            type: true,
            options: true,
          },
        },
        answers: {
          select: {
            id: true,
            questionInstanceId: true,
            answerText: true,
            answerJson: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    if (user.hospitalId && session.hospitalId !== user.hospitalId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ success: true, session });
  } catch (e) {
    console.error('GET /api/surveys/sessions/[id] error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// POST /api/surveys/sessions/[id]?userId=xxx — 사전문진 재분석 트리거 (내 병원 것만)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params;
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const user = await getApprovedUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const session = await prisma.surveySession.findUnique({
      where: { id: sessionId },
      select: { id: true, hospitalId: true, status: true, analysisStatus: true },
    });

    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    if (user.hospitalId && session.hospitalId !== user.hospitalId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (session.status !== 'completed') {
      return NextResponse.json({ success: false, error: 'only_completed_session_can_be_analyzed' }, { status: 400 });
    }

    if (session.analysisStatus === 'processing') {
      return NextResponse.json({ success: true, message: 'already_processing' });
    }

    await prisma.surveySession.update({
      where: { id: sessionId },
      data: { analysisStatus: 'pending' },
    });

    void analyzeSurveySessionById(sessionId).catch((e) =>
      console.error('reanalyze analyzeSurveySessionById failed:', e),
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('POST /api/surveys/sessions/[id] reanalyze error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
