import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 10;

// GET /api/admin/pre-consultation/sessions?hospitalId=... — 병원별 사전문진 목록
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const hospitalId = new URL(request.url).searchParams.get('hospitalId')?.trim();
  if (!hospitalId) {
    return NextResponse.json({ error: 'hospitalId가 필요합니다.' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .schema('robovet')
    .from('survey_sessions')
    .select('id, patientName, guardianName, contact, visitType, status, analysisStatus, createdAt, completedAt')
    .eq('hospitalId', hospitalId)
    .order('createdAt', { ascending: false })
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ sessions: data ?? [] });
}
