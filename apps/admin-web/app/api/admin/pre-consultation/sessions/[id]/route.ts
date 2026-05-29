import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const maxDuration = 10;

// GET /api/admin/pre-consultation/sessions/[id] — 사전문진 상세(세션 + 질문 + 답변)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const supabase = createServiceRoleClient();

  const { data: session, error } = await supabase
    .schema('robovet')
    .from('survey_sessions')
    .select(
      'id, hospitalId, patientName, guardianName, contact, visitType, previousChartText, status, analysisStatus, draftSummary, draftDdx, followUpQuestions, scheduledDate, petAge, createdAt, completedAt',
    )
    .eq('id', id)
    .single();

  if (error || !session) {
    return NextResponse.json({ error: '사전문진을 찾을 수 없습니다.' }, { status: 404 });
  }

  const { data: questions } = await supabase
    .schema('robovet')
    .from('survey_question_instances')
    .select('id, order, source, stage, text, type, options')
    .eq('sessionId', id)
    .order('order', { ascending: true });

  const { data: answers } = await supabase
    .schema('robovet')
    .from('survey_answers')
    .select('id, questionInstanceId, answerText, answerJson')
    .eq('sessionId', id);

  return NextResponse.json({
    session,
    questions: questions ?? [],
    answers: answers ?? [],
  });
}
