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
        petAge: true,
        questions: { select: { id: true, text: true, type: true } },
        answers: { select: { questionInstanceId: true, answerText: true, answerJson: true } },
      },
    });

    const matches = sessions
      .filter((s) => normDigits(s.contact) === target)
      .map((s) => {
        const textById = new Map(s.questions.map((q) => [q.id, q.text]));
        const typeById = new Map(s.questions.map((q) => [q.id, q.type]));
        const byText: Record<string, string> = {};
        // 초진 접수증 PetAnswer 와 동일한 모양(birthDate / ageUnknown / ageText)으로 가공.
        // pet_birthday answerJson 을 우선 보고, 없으면 surveySession 컬럼(petBirthday/petAge)으로 fallback.
        let birthDate = '';
        let ageUnknown = false;
        let ageText = '';

        for (const a of s.answers) {
          const qType = typeById.get(a.questionInstanceId);
          if (qType === 'pet_birthday') {
            const j = a.answerJson as
              | { date?: unknown; unknownBirthday?: unknown; approximateYears?: unknown }
              | null
              | undefined;
            if (j && typeof j === 'object' && !Array.isArray(j)) {
              if (j.unknownBirthday === true && typeof j.approximateYears === 'number' && j.approximateYears > 0) {
                ageUnknown = true;
                ageText = String(j.approximateYears);
              } else if (typeof j.date === 'string' && j.date) {
                birthDate = j.date;
              }
            }
            continue;
          }
          const t = textById.get(a.questionInstanceId);
          if (!t) continue;
          const v = Array.isArray(a.answerJson)
            ? (a.answerJson as string[]).join(', ')
            : (a.answerText ?? '');
          if (v) byText[t] = v;
        }

        // pet_birthday 답변이 비어 있으면 세션 컬럼으로 fallback(레거시 데이터 대비).
        if (!birthDate && !ageUnknown) {
          if (s.petBirthday) birthDate = s.petBirthday.toISOString().slice(0, 10);
          else if (typeof s.petAge === 'number' && s.petAge > 0) {
            ageUnknown = true;
            ageText = String(s.petAge);
          }
        }

        return {
          id: s.id,
          patientName: s.patientName ?? '',
          scheduledDate: s.scheduledDate ? s.scheduledDate.toISOString() : null,
          species: byText['반려동물 종류'] ?? '',
          breed: byText['품종'] ?? '',
          sex: byText['성별'] ?? '',
          birthDate,
          ageUnknown,
          ageText,
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
