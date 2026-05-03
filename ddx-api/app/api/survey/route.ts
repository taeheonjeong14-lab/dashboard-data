import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { analyzeSurveySessionById } from '@/lib/survey-analysis';
import { syncSurveySessionIdentityFields } from '@/lib/survey-session-identity-sync';

// GET /api/survey?token=xxx — 토큰으로 세션 + 질문 조회 (공개, 로그인 불필요)
export async function GET(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get('token')?.trim();
    if (!token) {
      return NextResponse.json({ success: false, error: 'token required' }, { status: 400 });
    }

    const session = await prisma.surveySession.findUnique({
      where: { token },
      select: {
        id: true,
        patientName: true,
        guardianName: true,
        contact: true,
        petBirthday: true,
        petAge: true,
        visitType: true,
        scheduledDate: true,
        status: true,
        completedAt: true,
        hospital: { select: { name: true, logoUrl: true, brandColor: true } },
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
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, session });
  } catch (e) {
    console.error('GET /api/survey error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// POST /api/survey — 답변 저장 + 선택적으로 완료 처리
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = (body.token as string | undefined)?.trim();
    if (!token) {
      return NextResponse.json({ success: false, error: 'token required' }, { status: 400 });
    }

    const session = await prisma.surveySession.findUnique({
      where: { token },
      select: { id: true, status: true },
    });

    if (!session) {
      return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
    }
    if (session.status === 'completed') {
      return NextResponse.json({ success: false, error: 'already_completed' }, { status: 400 });
    }

    const answers = body.answers as Array<{
      questionInstanceId: string;
      answerText?: string;
      answerJson?: unknown;
    }> | undefined;

    const complete = body.complete === true;

    if (Array.isArray(answers) && answers.length > 0) {
      for (const a of answers) {
        if (!a.questionInstanceId) continue;
        await prisma.surveyAnswer.upsert({
          where: {
            sessionId_questionInstanceId: {
              sessionId: session.id,
              questionInstanceId: a.questionInstanceId,
            },
          },
          create: {
            sessionId: session.id,
            questionInstanceId: a.questionInstanceId,
            answerText: a.answerText ?? null,
            answerJson: a.answerJson ?? undefined,
          },
          update: {
            answerText: a.answerText ?? null,
            answerJson: a.answerJson ?? undefined,
          },
        });
      }
    }

    await syncSurveySessionIdentityFields(session.id);

    if (complete) {
      const updated = await prisma.surveySession.update({
        where: { id: session.id },
        data: { status: 'completed', completedAt: new Date(), analysisStatus: 'pending' },
      });
      // 사전문진 완료 시 비동기로 사전 분석 실행 (차트 요약/DDx/추가 질문)
      void analyzeSurveySessionById(updated.id).catch((e) =>
        console.error('analyzeSurveySessionById failed:', e),
      );
    }

    return NextResponse.json({ success: true, completed: complete });
  } catch (e) {
    console.error('POST /api/survey error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
