import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/survey/match?hospitalId=xxx&contact=010... — 연락처로 완료된 사전문진 매칭
// 초진 접수 연동용. 서버-투-서버(hospital-web)에서 호출. 환자 프리필에 필요한 최소 정보만 반환.
const normDigits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const hospitalId = sp.get('hospitalId')?.trim();
  const contact = sp.get('contact')?.trim();
  if (!hospitalId || !contact) {
    return NextResponse.json({ success: false, error: 'hospitalId and contact required' }, { status: 400 });
  }
  const target = normDigits(contact);
  if (!target) return NextResponse.json({ success: true, matches: [] });

  try {
    const sessions = await prisma.surveySession.findMany({
      where: { hospitalId, status: 'completed' },
      orderBy: { scheduledDate: 'asc' },
      take: 500,
      select: {
        id: true,
        patientName: true,
        contact: true,
        scheduledDate: true,
        petBirthday: true,
        questions: { select: { id: true, text: true } },
        answers: { select: { questionInstanceId: true, answerText: true, answerJson: true } },
      },
    });

    const matches = sessions
      .filter((s) => normDigits(s.contact) === target)
      .map((s) => {
        const textById = new Map(s.questions.map((q) => [q.id, q.text]));
        const byText: Record<string, string> = {};
        for (const a of s.answers) {
          const t = textById.get(a.questionInstanceId);
          if (!t) continue;
          const v = Array.isArray(a.answerJson)
            ? (a.answerJson as string[]).join(', ')
            : (a.answerText ?? '');
          if (v) byText[t] = v;
        }
        return {
          id: s.id,
          patientName: s.patientName ?? '',
          scheduledDate: s.scheduledDate ? s.scheduledDate.toISOString() : null,
          species: byText['반려동물 종류'] ?? '',
          breed: byText['품종'] ?? '',
          sex: byText['성별'] ?? '',
          birthday: s.petBirthday ? s.petBirthday.toISOString().slice(0, 10) : '',
        };
      });

    return NextResponse.json({ success: true, matches });
  } catch (e) {
    console.error('GET /api/survey/match error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
