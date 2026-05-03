import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const adminUserId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!adminUserId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(adminUserId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const session = await prisma.surveySession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        patientName: true,
        guardianName: true,
        contact: true,
        visitType: true,
        previousChartText: true,
        status: true,
        token: true,
        createdAt: true,
        completedAt: true,
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

    return NextResponse.json({ success: true, session });
  } catch (e) {
    console.error('GET /api/admin/surveys/sessions/[id] error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
