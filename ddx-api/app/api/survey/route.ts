import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { analyzeSurveySessionById } from '@/lib/survey-analysis';
import { syncSurveySessionIdentityFields } from '@/lib/survey-session-identity-sync';
import { isSurveyExpired } from '@/lib/survey-expiry';

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

    // 내원 예정일 + 7일 경과한 미제출 링크는 만료 → 작성 차단(이미 제출한 건은 그대로 열람 가능).
    if (isSurveyExpired(session.status, session.scheduledDate)) {
      return NextResponse.json({ success: false, error: 'expired' }, { status: 410 });
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

    // 신규환자 동의(필수 시각 + 마케팅 여부). 완료 제출에만 포함되며, 그 외 방문유형은 전송되지 않는다.
    const consentAgreedAtRaw = typeof body.consentAgreedAt === 'string' ? body.consentAgreedAt : null;
    const consentAgreedAt = consentAgreedAtRaw ? new Date(consentAgreedAtRaw) : null;
    const hasConsentMarketing = typeof body.consentMarketing === 'boolean';
    const consentMarketing = hasConsentMarketing ? (body.consentMarketing as boolean) : null;

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
        data: {
          status: 'completed',
          completedAt: new Date(),
          analysisStatus: 'pending',
          ...(consentAgreedAt && !Number.isNaN(consentAgreedAt.getTime()) ? { consentAgreedAt } : {}),
          ...(consentMarketing !== null ? { consentMarketing } : {}),
        },
      });
      // 사전문진 완료 시 사전 분석 실행 (차트 요약/DDx/추가 질문).
      // after() 로 등록해야 응답 반환 후에도 서버리스 함수가 살아 분석이 끝까지 완료된다 — void Promise 만 던지면 Vercel 에서 즉시 종료될 수 있다.
      after(() =>
        analyzeSurveySessionById(updated.id).catch((e) =>
          console.error('analyzeSurveySessionById failed:', e),
        ),
      );
      // 병원 유저 알림 — 사전문진 작성 완료
      try {
        if (updated.hospitalId) {
          const recipients = await prisma.user.findMany({
            where: { hospitalId: updated.hospitalId, deletedAt: null, rejected: false },
            select: { id: true },
          });
          if (recipients.length) {
            await prisma.notification.createMany({
              data: recipients.map((r) => ({
                userId: r.id, hospitalId: updated.hospitalId, type: 'survey_submitted',
                title: '사전문진 작성 완료',
                body: `${updated.guardianName || '보호자'}/${updated.patientName || '환자'}님이 사전문진을 작성해주셨어요. 확인해주세요.`,
                link: '/pre-consultation',
              })),
            });
          }
        }
      } catch (e) { console.error('[survey notify] failed:', e); }
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
