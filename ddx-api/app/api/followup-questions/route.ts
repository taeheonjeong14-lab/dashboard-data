import { NextRequest, NextResponse } from 'next/server';

const FOLLOWUP_QUESTIONS_PROMPT = `너는 경험이 풍부한 수의사야. 이전 진료 차트 기록을 보고, 오늘 재진에서 꼭 해야 하는 팔로업 질문들을 제안해줘.

규칙:
- 반드시 물음표(?)로 끝나거나 질문어("나요", "인가요" 등)를 포함한 완전한 질문 문장만 작성
- 한 줄에 질문 하나씩, 번호로 구분 (1. ... 2. ...)
- 최대 5개만 제안 (문진 시간을 고려해 가장 중요한 것만)
- 이전 차트에서 언급된 진단·처치·약·경과를 바탕으로, 오늘 확인해야 할 사항 위주로
- 짧고 핵심만 담은 질문으로`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const previousChartContent = typeof body.previousChartContent === 'string' ? body.previousChartContent.trim() : '';

    if (!previousChartContent) {
      return NextResponse.json(
        { error: 'previousChartContent(이전 차트 내용)가 필요합니다.' },
        { status: 400 }
      );
    }

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API 키가 설정되지 않았습니다. .env.local을 확인해주세요.' },
        { status: 500 }
      );
    }

    const userMessage = `이전 차트 기록을 토대로 오늘 꼭 해야 하는 팔로업 질문을 띄워줘.\n\n[이전 차트 내용]\n---\n${previousChartContent}\n---\n\n위 차트를 보고 재진 시 꼭 물어봐야 할 질문을 최대 5개만 번호로 나열해줘. 한 줄에 하나의 완전한 질문만.`;
    const fullPrompt = FOLLOWUP_QUESTIONS_PROMPT + '\n\n' + userMessage;

    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.3,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Gemini API error (followup-questions):', res.status, err);
      return NextResponse.json(
        { error: '팔로업 질문 생성 중 오류가 발생했습니다.' },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    const lines = rawText
      .split(/\n/)
      .map((line: string) => line.replace(/^\s*\d+[.)]\s*/, '').replace(/^[•\-*]\s*/, '').trim())
      .filter((line: string) => line.length > 3)
      .slice(0, 5);

    return NextResponse.json({ questions: lines });
  } catch (e) {
    console.error('Followup Questions API error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '팔로업 질문 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
