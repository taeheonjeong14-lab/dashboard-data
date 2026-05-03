import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `너는 경험이 풍부한 수의사이자 사전문진 설계 전문가야.
이전 진료 차트 기록을 보고, 재진 사전문진에서 보호자에게 미리 물어봐야 할 질문을 구조화된 JSON으로 생성해줘.

규칙:
- 보호자가 모바일에서 쉽게 답변할 수 있는 형태로 질문 설계
- 이전 차트에서 언급된 진단·처치·약·경과를 바탕으로, 이번 내원 전에 확인할 사항 위주
- 최소 3개, 최대 8개 질문 생성
- 질문 유형은 아래 중 선택:
  - "short_text": 짧은 주관식 (한 줄)
  - "long_text": 긴 주관식 (여러 줄)
  - "single_choice": 객관식 단일 선택 (choices 필수)
  - "multi_choice": 객관식 복수 선택 (choices 필수)
  - "scale": 숫자 척도 (min, max, minLabel, maxLabel 필수)
- 객관식에는 반드시 적절한 보기를 함께 생성
- 이전 차트에 이미 있는 기본 정보(이름, 연락처 등)는 묻지 않기
- 질문은 보호자 입장에서 이해하기 쉬운 일상 언어로 작성

응답 형식 (반드시 JSON 배열만 출력, 다른 텍스트 없이):
[
  {
    "text": "질문 내용",
    "type": "single_choice",
    "options": { "choices": ["보기1", "보기2", "보기3"] }
  },
  {
    "text": "질문 내용",
    "type": "scale",
    "options": { "min": 1, "max": 5, "minLabel": "매우 나쁨", "maxLabel": "매우 좋음" }
  },
  {
    "text": "질문 내용",
    "type": "short_text",
    "options": null
  }
]`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const chartContent = typeof body.chartContent === 'string' ? body.chartContent.trim() : '';

    if (!chartContent) {
      return NextResponse.json({ error: 'chartContent가 필요합니다.' }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다.' }, { status: 500 });
    }

    const userMessage = `아래 이전 진료 차트를 분석해서, 재진 사전문진 질문을 JSON 배열로 생성해줘.\n\n[이전 차트 내용]\n---\n${chartContent}\n---\n\n위 차트를 바탕으로 보호자가 내원 전에 미리 답변할 수 있는 사전문진 질문을 만들어줘. 반드시 JSON 배열만 출력해.`;

    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n' + userMessage }] }],
          generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('Gemini API error (generate-questions):', res.status, err);
      return NextResponse.json({ error: 'AI 질문 생성 중 오류가 발생했습니다.' }, { status: 502 });
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('Failed to parse AI response as JSON:', rawText);
      return NextResponse.json({ error: 'AI 응답을 파싱할 수 없습니다.' }, { status: 502 });
    }

    const questions = JSON.parse(jsonMatch[0]) as Array<{
      text: string;
      type: string;
      options: unknown;
    }>;

    const validTypes = ['short_text', 'long_text', 'single_choice', 'multi_choice', 'scale'];
    const filtered = questions
      .filter((q) => q.text && validTypes.includes(q.type))
      .slice(0, 8);

    return NextResponse.json({ success: true, questions: filtered });
  } catch (e) {
    console.error('Generate Questions API error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '질문 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
