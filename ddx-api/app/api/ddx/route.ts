import { NextRequest, NextResponse } from 'next/server';

const DDX_PROMPT = `대화 내용을 바탕으로 DDx(차별진단) 작성.

규칙:
- 가능한 진단 나열, 가능성(높음/중간/낮음) 표시
- 각 진단의 근거 간결히 제시
- 각 진단마다 필요한 추가 검사 제안 필수
- 주어진 정보만 사용
- 한국어만 사용
- 간결하게 핵심만

형식:
1. 진단명 (가능성: 높음/중간/낮음)
근거:
- 근거 1
- 근거 2
필요한 추가 검사:
- 검사 1
- 검사 2

중요:
- 인사말, 서문 없이 바로 진단 목록만 작성
- 각 진단마다 "필요한 추가 검사:" 섹션 필수
- 줄바꿈은 \n 사용`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const transcript = body.transcript || body.summary; // transcript 또는 summary 모두 지원
    const preConsultationData = body.preConsultationData;
    const surveySessionData = body.surveySessionData;

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json(
        { error: 'transcript 또는 summary가 필요합니다.' },
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

    let userMessage = '다음은 수의사와 보호자의 대화 내용이야.\n\n---\n' + transcript + '\n---';
    if (preConsultationData) {
      userMessage += '\n\n사전문진 정보:\n\n---\n' + JSON.stringify(preConsultationData, null, 2) + '\n---';
    }
    if (surveySessionData) {
      userMessage += '\n\n우리 사전문진(Q/A + 초안 분석):\n\n---\n' + JSON.stringify(surveySessionData, null, 2) + '\n---';
    }
    userMessage += '\n\n위 내용을 바탕으로 DDx를 작성해줘.';
    const fullPrompt = DDX_PROMPT + '\n\n' + userMessage;

    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

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
          maxOutputTokens: 8192, // DDx 내용 제한 없음 (Gemini 최대값)
          temperature: 0.4, // 정확성과 속도 균형
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

    // 스트림을 읽어서 텍스트 추출
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      return NextResponse.json(
        { error: '스트림을 읽을 수 없습니다.' },
        { status: 502 }
      );
    }

    // ReadableStream 생성
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let buffer = '';
          let accumulatedText = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim() === '') continue;
              
              // SSE 형식: "data: {...}"
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]' || data === '') {
                  continue;
                }
                
                try {
                  const json = JSON.parse(data);
                  // Gemini 스트림 응답 형식: candidates[0].content.parts[0].text
                  const chunkText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  
                  if (chunkText) {
                    accumulatedText += chunkText;
                    controller.enqueue(
                      new TextEncoder().encode(`data: ${JSON.stringify({ text: accumulatedText })}\n\n`)
                    );
                  }
                } catch (e) {
                  console.error('JSON 파싱 오류:', e, 'Line:', line);
                }
              } else if (line.trim().startsWith('{')) {
                // JSON이 data: 없이 직접 오는 경우
                try {
                  const json = JSON.parse(line.trim());
                  const chunkText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  
                  if (chunkText) {
                    accumulatedText += chunkText;
                    controller.enqueue(
                      new TextEncoder().encode(`data: ${JSON.stringify({ text: accumulatedText })}\n\n`)
                    );
                  }
                } catch (e) {
                  // JSON 파싱 실패는 무시
                }
              }
            }
          }
          
          // 스트림 종료
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e) {
          console.error('스트림 처리 오류:', e);
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (e) {
    console.error('DDx API error:', e);
    const errorMessage = e instanceof Error ? e.message : 'DDx 생성 중 오류가 발생했습니다.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
