import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { geminiGenerateText } from '@/lib/chart-app/gemini';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BODY_MAX = 200;

// 질환 소개 박스 본문을 온디맨드로 생성한다(admin 토글 ON 시 호출).
// 특정 환자 수치/소견이 아니라 "질환 자체의 일반 소개"이며, 3가지를 순서대로 담는다:
// ① 질환 한 줄 설명 ② 악화 시 위험 ③ 따라서 무엇이 중요한지.
export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const diseaseName = typeof body.diseaseName === 'string' ? body.diseaseName.trim() : '';
  const species = typeof body.species === 'string' ? body.species.trim() : '';
  if (!diseaseName) {
    return NextResponse.json({ error: 'diseaseName is required' }, { status: 400 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 503 });
  }

  const prompt = [
    '너는 세계에서 가장 뛰어난 수의사야.',
    '아래 질환을 보호자에게 소개하는 짧은 글을 작성한다.',
    '',
    '규칙:',
    `- 공백 포함 **140자 이상 ${BODY_MAX}자 이하**, 한 문단(줄바꿈 없이). 너무 짧게 끝내지 말고 분량을 채운다.`,
    '- 아래 **3가지를 모두 빠짐없이** 순서대로 자연스럽게 담는다(하나라도 생략 금지): ① 질환에 대한 한 줄 설명, ② 악화될 경우 어떤 위험이 있는지, ③ 따라서 무엇이 중요한지.',
    '- 문장을 중간에 끊지 말고 반드시 완결된 문장으로 마무리한다.',
    '- 보호자 대상 공식 건강검진 보고서 톤(존댓말, 이해하기 쉬운 표현).',
    '- 특정 환자의 수치·소견은 넣지 말고 **질환 자체의 일반적인 소개**로 쓴다.',
    '- 한국어 수의학 표준 용어를 쓰되, 필요하면 「한국어(영어)」 형식으로 보조한다.',
    '- 제목·머리말·마크다운·따옴표 없이 본문 문장만 출력한다.',
    '',
    `질환명: ${diseaseName}`,
    species ? `대상 동물 종: ${species}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    // maxOutputTokens 는 넉넉히 — Gemini 2.5 계열은 thinking 토큰이 이 한도를 함께 소모하므로
    // 1024 처럼 빡빡하면 본문이 중간에 잘린다(MAX_TOKENS). 200자 본문 + thinking 여유 확보.
    const raw = await geminiGenerateText(prompt, { maxOutputTokens: 4096, temperature: 0.3 });
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Gemini returned empty response.');
    return NextResponse.json({ body: text.slice(0, BODY_MAX) });
  } catch (e) {
    console.error('[content/health-checkup/disease-intro] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '질환 소개 생성 실패' },
      { status: 500 },
    );
  }
}
