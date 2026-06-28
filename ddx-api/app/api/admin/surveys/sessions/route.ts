import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';
import {
  buildFirstVisitQuestionRows,
  buildPrefilledPetRows,
  FOLLOW_UP_FIXED_QUESTIONS,
  buildOptionsJson,
  isFollowUpVisit,
  isExistingPatientVisit,
  type ExistingPatientInfo,
  type QuestionDef,
} from '@/lib/survey-questions';

// GET /api/admin/surveys/sessions?userId=xxx — 설문 세션 목록 (관리자만)
export async function GET(request: NextRequest) {
  try {
    const adminUserId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!adminUserId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(adminUserId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const sessions = await prisma.surveySession.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        patientName: true,
        guardianName: true,
        contact: true,
        visitType: true,
        status: true,
        createdAt: true,
        completedAt: true,
        _count: { select: { questions: true } },
      },
    });

    return NextResponse.json({ success: true, sessions });
  } catch (e) {
    console.error('GET /api/admin/surveys/sessions error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/admin/surveys/sessions — 새 설문 세션 생성 + 고정 질문 자동 삽입
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const adminUserId = (body.adminUserId as string | undefined)?.trim();
    if (!adminUserId) {
      return NextResponse.json({ success: false, error: 'adminUserId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(adminUserId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const patientName = (body.patientName as string | undefined)?.trim() || null;
    const guardianName = (body.guardianName as string | undefined)?.trim() || null;
    const contact = (body.contact as string | undefined)?.trim() || null;
    const visitType = (body.visitType as string | undefined)?.trim() || null;
    const petSpecies = (body.petSpecies as string | undefined)?.trim() || null;
    const petBreed = (body.petBreed as string | undefined)?.trim() || null;
    const petSex = (body.petSex as string | undefined)?.trim() || null;

    const token = randomBytes(24).toString('hex');

    const existingInfo: ExistingPatientInfo | undefined =
      isExistingPatientVisit(visitType) && petSpecies && petSex
        ? { species: petSpecies, breed: petBreed ?? undefined, sex: petSex }
        : undefined;

    const fixedQuestions: QuestionDef[] = isFollowUpVisit(visitType)
      ? (existingInfo ? [...buildPrefilledPetRows(existingInfo), ...FOLLOW_UP_FIXED_QUESTIONS] : FOLLOW_UP_FIXED_QUESTIONS)
      : buildFirstVisitQuestionRows(guardianName, patientName, contact, { existing: existingInfo });

    const prefilledByOrder = new Map<number, string>();

    const session = await prisma.surveySession.create({
      data: {
        patientName,
        guardianName,
        contact,
        visitType,
        token,
        questions: {
          create: fixedQuestions.map((q, idx) => {
            if (q.prefilled && q.prefilledAnswer) prefilledByOrder.set(idx + 1, q.prefilledAnswer);
            return {
              order: idx + 1,
              source: q.prefilled ? 'prefilled' : 'fixed',
              stage: q.category ?? 'initial', // 카테고리를 stage 로 운반(작성 화면 카테고리 인트로용)
              text: q.text,
              type: q.type,
              options: buildOptionsJson(q) ?? undefined,
            };
          }),
        },
      },
      select: {
        id: true,
        token: true,
        patientName: true,
        guardianName: true,
        contact: true,
        visitType: true,
        status: true,
        createdAt: true,
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
      },
    });

    const prefilledAnswerRows = session.questions
      .filter((qi) => qi.source === 'prefilled' && prefilledByOrder.has(qi.order))
      .map((qi) => ({ sessionId: session.id, questionInstanceId: qi.id, answerText: prefilledByOrder.get(qi.order)! }));
    if (prefilledAnswerRows.length > 0) {
      await prisma.surveyAnswer.createMany({ data: prefilledAnswerRows });
    }

    return NextResponse.json({ success: true, session });
  } catch (e) {
    console.error('POST /api/admin/surveys/sessions error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

