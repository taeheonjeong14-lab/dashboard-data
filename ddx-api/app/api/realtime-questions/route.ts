import { NextRequest, NextResponse } from 'next/server';

const REALTIME_QUESTIONS_PROMPT = `너는 경험이 풍부한 수의사야. 대화를 분석해서 DDx(차별진단)를 위해 필요한 가장 중요한 질문 하나만 제안해줘.

⚠️ 매우 중요 - 반드시 지켜야 할 형식:
1. 반드시 물음표(?)로 끝나거나 질문어("나요", "인가요", "있나요", "하나요", "어떤가요")를 포함한 완전한 질문 문장이어야 함
2. 절대로 단어나 짧은 구절만 답변하지 말 것
3. 절대로 답변 형식으로 답변하지 말 것

✅ 올바른 예시:
- "증상이 언제부터 시작되었나요?"
- "식욕은 정상인가요?"
- "다리를 절기 시작한 것은 언제부터인가요?"
- "구토나 설사 증상이 있나요?"

❌ 절대 금지 (이런 형식으로 답변하지 말 것):
- "언제부터" (단어만)
- "다치" (단어만)
- "다리를 절기 시작한 이후" (답변 형식, 질문이 아님)
- "증상 시작 시점" (명사구, 질문이 아님)

규칙:
- DDx를 좁히는데 가장 도움이 되는 질문만
- 중복 질문 금지
- 충분한 정보면 "NO_MORE_QUESTIONS"만 답변

⚠️ 간결성 요구사항:
- 실시간 질문은 최대한 간결하게 핵심 메시지만 살려서 작성
- 불필요한 설명이나 장황한 표현은 제거
- 핵심만 담은 짧고 명확한 질문으로 작성`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const transcript = body.transcript;
    const existingQuestions = body.existingQuestions || [];
    const previousChartContent = typeof body.previousChartContent === 'string' ? body.previousChartContent.trim() : '';

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json(
        { error: 'transcript(대화 내용)이 필요합니다.' },
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

    let existingQuestionsText = '';
    if (existingQuestions.length > 0) {
      existingQuestionsText = '\n\n이미 제안된 질문들 (이것들과 유사하거나 중복되는 질문은 하지 말아줘):\n' + 
        existingQuestions.map((q: string, idx: number) => `${idx + 1}. ${q}`).join('\n');
    }

    let previousChartSection = '';
    if (previousChartContent) {
      previousChartSection = '\n\n[이전 진료 차트 내용 - 재진이므로 아래 내용을 참고해서, 이미 파악된 정보는 묻지 말고 이어서 필요한 질문만 제안해줘]:\n' + previousChartContent;
    }

    const userMessage = `대화 내용:\n${transcript}${previousChartSection}${existingQuestionsText}\n\n위 대화를 분석해서 DDx를 만들기 위해 꼭 필요한 질문을 완전한 질문 문장으로 던져줘. 반드시 물음표(?)로 끝나거나 질문어("나요", "인가요" 등)를 포함한 완전한 질문이어야 하며, 단어나 짧은 구절만 답변하지 말 것. 최대한 간결하게 핵심 메시지만 살려서 작성해줘.${previousChartContent ? ' 이전 차트에 이미 있는 정보는 질문하지 말고, 이번 진료에서 추가로 필요한 것만 질문해줘.' : ''}`;
    const fullPrompt = REALTIME_QUESTIONS_PROMPT + '\n\n' + userMessage;

    console.log('📤 Gemini에 전송되는 전체 프롬프트:\n', fullPrompt);
    console.log('📤 프롬프트 길이:', fullPrompt.length, '자');

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
        generationConfig: {
          maxOutputTokens: 1200, // 질문이 잘리지 않도록 충분한 길이
          temperature: 0.4, // 빠른 응답을 위해 낮춤
        },
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
        finishReason?: string;
        finishMessage?: string;
      }>;
    };

    console.log('🔍 Gemini API 전체 응답 구조:', JSON.stringify(data, null, 2));
    
    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const finishMessage = candidate?.finishMessage;
    
    console.log('🔍 finishReason:', finishReason);
    console.log('🔍 finishMessage:', finishMessage);
    
    // 모든 parts의 text를 합치기
    const allParts = candidate?.content?.parts || [];
    const allTexts = allParts.map(part => part.text || '').filter(Boolean);
    const rawText = allTexts.join('');
    
    console.log('🔍 Gemini 원본 응답 (모든 parts 합친 결과):', JSON.stringify(rawText));
    console.log('🔍 원본 응답 길이:', rawText.length, '자');
    
    // finishReason이 MAX_TOKENS면 응답이 잘렸을 수 있음
    if (finishReason === 'MAX_TOKENS') {
      console.warn('⚠️ 응답이 maxOutputTokens 제한으로 인해 잘렸을 수 있습니다!');
    }
    
    // 앞뒤 공백 및 따옴표 제거
    let text = rawText.trim();
    // JSON 문자열로 인코딩된 따옴표 제거
    text = text.replace(/^["']|["']$/g, '');
    text = text.trim();

    console.log('🔍 Gemini 정리된 응답:', JSON.stringify(text), '길이:', text.length);

    if (!text) {
      return NextResponse.json(
        { error: 'Gemini가 질문을 생성하지 못했습니다.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ questions: text });
  } catch (e) {
    console.error('Realtime Questions API error:', e);
    const errorMessage = e instanceof Error ? e.message : '실시간 질문 생성 중 오류가 발생했습니다.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
