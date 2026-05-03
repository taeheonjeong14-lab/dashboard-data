import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

async function getApprovedUser(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, approved: true, active: true, deletedAt: null },
    select: { id: true, hospitalId: true },
  });
}

// 새로운 상담 세션 생성 (모바일에서 녹음 시작 시)
export async function POST(request: NextRequest) {
  try {
    console.log('Consultation 생성 API 호출됨');
    const body = await request.json();
    const { sessionId, transcript, summary, ddx, cc, realtimeQuestions, status, userId, patientName, guardianName, visitType, previousChartContent, preConsultationId, surveySessionId } = body;

    // sessionId가 없으면 새로 생성
    const finalSessionId = sessionId || crypto.randomUUID();

    console.log('받은 데이터:', {
      sessionId: finalSessionId,
      userId: userId || null,
      transcriptLength: transcript?.length || 0,
      summaryLength: summary?.length || 0,
      ddxLength: ddx?.length || 0,
      questionsCount: Array.isArray(realtimeQuestions) ? realtimeQuestions.length : 0,
      status: status || 'recording',
    });

    // transcript는 문자열이어야 함 (빈 문자열 ''은 세션 생성 시 허용)
    if (typeof transcript !== 'string') {
      console.error('transcript가 문자열이 아님');
      return NextResponse.json(
        { error: 'transcript(대화 내용)이 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('Prisma로 데이터 저장 시작...');
    // patientName, guardianName: Prisma 클라이언트가 인식하려면 `npx prisma generate` 후 서버 재시작 필요
    const consultation = await prisma.consultation.upsert({
      where: { sessionId: finalSessionId },
      update: {
        ...(userId != null && { userId }),
        ...(patientName != null && patientName !== '' && { patientName }),
        ...(guardianName != null && guardianName !== '' && { guardianName }),
        ...(visitType != null && visitType !== '' && { visitType }),
        ...(previousChartContent != null && { previousChartContent: previousChartContent ?? null }),
        ...(preConsultationId != null && { preConsultationId }),
        ...(surveySessionId != null && { surveySessionId }),
        transcript,
        summary: summary ?? null,
        ddx: ddx ?? null,
        cc: cc ?? null,
        realtimeQuestions: Array.isArray(realtimeQuestions) ? realtimeQuestions : [],
        status: status || 'recording',
        updatedAt: new Date(),
      },
      create: {
        sessionId: finalSessionId,
        userId: userId || null,
        patientName: patientName || null,
        guardianName: guardianName || null,
        visitType: visitType || null,
        previousChartContent: previousChartContent ?? null,
        preConsultationId: preConsultationId || null,
        surveySessionId: surveySessionId || null,
        transcript,
        summary: summary ?? null,
        ddx: ddx ?? null,
        cc: cc ?? null,
        realtimeQuestions: Array.isArray(realtimeQuestions) ? realtimeQuestions : [],
        status: status || 'recording',
      },
    });

    // 문진이 실제로 완료된 경우에만 사전문진을 '사용됨'으로 표시 (녹음 없이 나가면 사전문진은 다시 선택 가능)
    const completedWithContent = status === 'completed' && typeof transcript === 'string' && transcript.trim().length > 0;
    if (completedWithContent && consultation.preConsultationId && consultation.id) {
      await prisma.preConsultation.updateMany({
        where: { id: consultation.preConsultationId },
        data: { isUsed: true, consultationId: consultation.id },
      });
    }

    console.log('✅ Consultation 저장 완료:', consultation.id, 'sessionId:', consultation.sessionId);
    return NextResponse.json({ 
      success: true, 
      id: consultation.id,
      sessionId: consultation.sessionId,
    });
  } catch (e) {
    console.error('❌ Consultation 저장 오류:', e);
    if (e instanceof Error) {
      console.error('에러 상세:', e.message, e.stack);
    }
    const errorMessage = e instanceof Error ? e.message : '상담 내용 저장 중 오류가 발생했습니다.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// 실시간 transcript 업데이트 (모바일에서 녹음 중) 또는 status만 변경 (다른 기기에서 녹음 시작 확인 시)
export async function PATCH(request: NextRequest) {
  try {
    console.log('Consultation 업데이트 API 호출됨');
    const body = await request.json();
    const { sessionId, transcript, status, userId, patientName, guardianName } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json(
        { error: 'sessionId가 필요합니다.' },
        { status: 400 }
      );
    }

    const hasTranscript = transcript !== undefined && typeof transcript === 'string';
    const hasStatus = status !== undefined && status !== '';

    if (!hasTranscript && !hasStatus) {
      return NextResponse.json(
        { error: 'transcript 또는 status가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('Prisma로 consultation 업데이트 시작...', { sessionId, hasTranscript, hasStatus });

    const consultation = await prisma.consultation.update({
      where: { sessionId },
      data: {
        ...(userId != null && { userId }),
        ...(hasStatus && { status }),
        ...(hasTranscript && { transcript }),
        updatedAt: new Date(),
      },
    });

    console.log('✅ Consultation 업데이트 완료:', consultation.id);
    return NextResponse.json({ 
      success: true, 
      id: consultation.id,
      sessionId: consultation.sessionId,
    });
  } catch (e) {
    console.error('❌ Consultation 업데이트 오류:', e);
    if (e instanceof Error) {
      console.error('에러 상세:', e.message, e.stack);
    }
    const errorMessage = e instanceof Error ? e.message : '상담 내용 업데이트 중 오류가 발생했습니다.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// 상담 데이터 조회 (PC에서 리포트 표시용)
// - sessionId=xxx 또는 id=xxx → 단일 상담 조회
// - userId=xxx → 같은 병원 상담 목록
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');

    // 병원 단위 목록 조회 (userId만 있는 경우)
    if (userId && !sessionId && !id) {
      const user = await getApprovedUser(userId);
      if (!user) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      // 같은 병원 계정들의 userId (직접 녹음으로 만들어진 상담 커버)
      let sameHospitalUserIds: string[] = [];
      if (user.hospitalId) {
        const users = await prisma.user.findMany({
          where: { hospitalId: user.hospitalId, approved: true, active: true, deletedAt: null },
          select: { id: true },
        });
        sameHospitalUserIds = users.map((u) => u.id);
      }

      // 같은 병원의 사전문진 세션 id (survey 기반 상담 커버)
      let sameHospitalSurveySessionIds: string[] = [];
      if (user.hospitalId) {
        const sessions = await prisma.surveySession.findMany({
          where: { hospitalId: user.hospitalId },
          select: { id: true },
          take: 5000,
        });
        sameHospitalSurveySessionIds = sessions.map((s) => s.id);
      }

      const where: Prisma.ConsultationWhereInput = user.hospitalId
        ? (() => {
            const ors: Prisma.ConsultationWhereInput[] = [
              { preConsultation: { hospitalId: user.hospitalId! } },
            ];
            if (sameHospitalUserIds.length > 0) {
              ors.push({ userId: { in: sameHospitalUserIds } });
            }
            if (sameHospitalSurveySessionIds.length > 0) {
              ors.push({ surveySessionId: { in: sameHospitalSurveySessionIds } });
            }
            return { OR: ors };
          })()
        : {
            // 병원 미할당 계정은 본인 기록만 조회
            userId: user.id,
          };

      const consultations = await prisma.consultation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      return NextResponse.json({ 
        success: true, 
        consultations 
      });
    }

    if (!sessionId && !id) {
      return NextResponse.json(
        { error: 'sessionId, id 또는 userId가 필요합니다.' },
        { status: 400 }
      );
    }

    const consultation = await prisma.consultation.findUnique({
      where: sessionId ? { sessionId } : { id: id! },
      include: { preConsultation: true },
    });

    if (!consultation) {
      return NextResponse.json(
        { error: '상담 데이터를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      consultation 
    });
  } catch (e) {
    console.error('❌ Consultation 조회 오류:', e);
    if (e instanceof Error) console.error('스택:', e.stack);
    const errorMessage = e instanceof Error ? e.message : '상담 내용 조회 중 오류가 발생했습니다.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// 상담 기록 삭제 (sessionId 또는 id로 지정)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const id = searchParams.get('id');

    if (!sessionId && !id) {
      return NextResponse.json(
        { error: 'sessionId 또는 id가 필요합니다.' },
        { status: 400 }
      );
    }

    await prisma.consultation.delete({
      where: sessionId ? { sessionId } : { id: id! },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('❌ Consultation 삭제 오류:', e);
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('Record to delete') || msg.includes('not found')) {
      return NextResponse.json({ error: '해당 기록을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '상담 기록 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
