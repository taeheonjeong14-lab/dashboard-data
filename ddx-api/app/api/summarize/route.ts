import { NextRequest, NextResponse } from 'next/server';
import { getImageUrlsFromTallyData } from '@/lib/tally';
import { fetchImagePartsForGemini } from '@/lib/gemini-images';

const SYSTEM_PROMPT = `당신은 수의 문진 정보를 하나로 정리하는 역할을 한다. 사전문진과 음성 문진 대화를 합쳐서 핵심만 요약한다. 첨부된 사진이 있으면 사진에 보이는 증상·부위·상태도 요약에 포함해줘.

다음 5개 항목을 bullet point로 간단히 정리해줘. 각 항목(1번~5번) 사이에는 반드시 한 줄 띄워서 가독성을 높여줘.

1. 주요 증상
2. 발생 시점 및 지속 시간
3. 환자의 과거 병력·투약·접종
4. 식이·환경·생활
5. 그 외 특이사항

규칙:
- 사전문진과 대화에 나온 사실만 적는다. 추론·추가하지 않는다. 중복은 한 번만.
- 추정 표현 금지. 언급된 사실만 bullet으로 나열.
- 구분 제목(대화/사전문진) 없이 통합 요약만.
- 한국어로만. 줄바꿈은 \\n만 사용, HTML 태그 사용하지 않는다.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const transcript = body.transcript;
    const preConsultationData = body.preConsultationData;
    const surveySessionData = body.surveySessionData;

    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json(
        { error: 'transcript(녹음 텍스트)가 필요합니다.' },
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

    const preText = preConsultationData ? JSON.stringify(preConsultationData, null, 2) : '(없음)';
    const surveyText = surveySessionData ? JSON.stringify(surveySessionData, null, 2) : '(없음)';
    let userMessage =
      '아래 내용을 모두 합쳐서 핵심만 항목별로 한 덩어리 요약해줘. 구분 제목(대화/사전문진) 없이 통합 요약만 출력해줘.\n\n' +
      '[Tally 사전문진 정보]\n' + preText + '\n\n' +
      '[우리 사전문진(Q/A + 초안 분석)]\n' + surveyText + '\n\n' +
      '[음성 문진 대화]\n' + transcript;
    const fullPrompt = SYSTEM_PROMPT + '\n\n' + userMessage;

    const imageUrls = preConsultationData ? getImageUrlsFromTallyData(preConsultationData).map((x) => x.url) : [];
    const imageParts = await fetchImagePartsForGemini(imageUrls, { maxImages: 3 });
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: fullPrompt },
      ...imageParts,
    ];

    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.3,
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
    console.error('Summarize API error:', e);
    const errorMessage = e instanceof Error ? e.message : '요약 처리 중 오류가 발생했습니다.';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
