import { NextRequest, NextResponse } from 'next/server';

const QUESTIONS_PROMPT = `너는 대한민국에서 가장 우수한 수의사야. 아래에 후배 수의사가 정리한 환자 정보 요약본이 있어. 이 정보를 바탕으로 DDx(차별진단)를 위해 추가로 확인해야 할 질문들을 제안해줘.

질문 생성 시 유의사항:
- 주어진 요약본에 명확히 나와있는 정보에 대해서는 질문하지 말아줘
- DDx를 좁히기 위해 필요한 핵심 질문들만 제안해줘
- 질문은 간결하고 명확하게 작성해줘
- 각 질문은 한 줄로 작성하고, 번호를 매겨서 나열해줘
- 질문 개수는 5-10개 정도가 적당해
- 보호자가 쉽게 답변할 수 있는 실용적인 질문들로 구성해줘

답변 형식:
1. 질문 내용
2. 질문 내용
3. 질문 내용
...`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const summary = body.summary;

    if (!summary || typeof summary !== 'string') {
      return NextResponse.json(
        { error: 'summary(요약본)이 필요합니다.' },
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

    const userMessage = '아래는 후배 수의사가 정리한 환자 정보 요약본이야.\n\n---\n' + summary + '\n---\n\n위 요약본을 바탕으로 DDx를 위한 추가 질문들을 제안해줘.';
    const fullPrompt = QUESTIONS_PROMPT + '\n\n' + userMessage;

    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: fullPrompt,
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Gemini API error:', res.status, err);
      let errorMessage = 'Gemini API 오류: ' + res.status;
      try {
        const errorJson = JSON.parse(err);
        if (errorJson.error?.message) {
          errorMessage += ' - ' + errorJson.error.message;
        }
      } catch {
        errorMessage += ' - ' + err.substring(0, 200);
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: 502 }
      );
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!text) {
      return NextResponse.json(
        { error: 'Gemini가 질문을 생성하지 못했습니다.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ questions: text });
  } catch (e) {
    console.error('Questions API error:', e);
    const errorMessage = e instanceof Error ? e.message : '질문 생성 중 오류가 발생했습니다.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
