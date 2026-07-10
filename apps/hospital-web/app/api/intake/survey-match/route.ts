import { NextRequest, NextResponse } from 'next/server';
import { withErrorLog } from '@/lib/with-error-log';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

// GET /api/intake/survey-match?hospitalId=xxx&contact=010... (공개 — 초진 접수 폼이 호출)
// 1) 병원의 사전문진 연동(on/off) 확인  2) ddx-api 로 연락처 매칭 조회(서버-투-서버)
// 3) 이미 다른 접수에 연결된 사전문진은 제외  → 미연결 매칭만 반환
const DDX_API = (
  process.env.DDX_API_URL ||
  process.env.NEXT_PUBLIC_DDX_API_URL ||
  'https://ddx-api.vercel.app'
).replace(/\/$/, '');

export const dynamic = 'force-dynamic';

type Match = {
  id: string;
  patientName: string;
  scheduledDate: string | null;
  species: string;
  breed: string;
  sex: string;
  /** 초진 접수증 PetAnswer 와 동일 — 생일을 알 때만 채워지고, 모를 때는 ageUnknown=true + ageText 로 옴 */
  birthDate: string;
  ageUnknown: boolean;
  ageText: string;
};

export const GET = withErrorLog({ route: '/api/intake/survey-match', feature: '초진 접수 설문 매칭' }, handleGET);

async function handleGET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const hospitalId = sp.get('hospitalId')?.trim();
  const contact = sp.get('contact')?.trim();
  if (!hospitalId || !contact) return NextResponse.json({ enabled: false, matches: [] });

  try {
    const svc = createServiceRoleClient();

    // 사전문진↔초진 접수 연동은 항상 켜짐(병원별 토글 폐지). 바로 매칭 조회로 진행.
    // ddx-api 매칭 조회
    let all: Match[] = [];
    try {
      const res = await fetch(`${DDX_API}/api/survey/match?hospitalId=${encodeURIComponent(hospitalId)}&contact=${encodeURIComponent(contact)}`);
      if (res.ok) {
        const data = (await res.json()) as { success?: boolean; matches?: Match[] };
        if (data.success && Array.isArray(data.matches)) all = data.matches;
      }
    } catch {
      /* ddx-api 연결 실패 → 매칭 없음으로 처리 */
    }
    if (all.length === 0) return NextResponse.json({ enabled: true, matches: [] });

    // 3) 이미 연결된 사전문진 제외 (intake.submissions.answers.linkedSurveySessionIds)
    const linked = new Set<string>();
    {
      const r = await svc.schema('intake').from('submissions').select('answers').eq('hospital_id', hospitalId).limit(2000);
      if (!r.error) {
        for (const row of (r.data ?? []) as Array<{ answers?: { linkedSurveySessionIds?: unknown } | null }>) {
          const ids = row.answers?.linkedSurveySessionIds;
          if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') linked.add(id);
        }
      }
    }

    const matches = all.filter((m) => !linked.has(m.id));
    return NextResponse.json({ enabled: true, matches });
  } catch (e) {
    return NextResponse.json({ enabled: false, matches: [], error: e instanceof Error ? e.message : 'Unknown error' });
  }
}
