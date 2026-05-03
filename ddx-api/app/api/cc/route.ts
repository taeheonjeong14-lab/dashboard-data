import { NextRequest, NextResponse } from 'next/server';

const CC_PROMPT = `아래 내용에서 가장 주된 증상 최대 세 가지만 명사/명사구로 써줘. 최대 50글자 이내의 한 줄로 출력해줘.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const transcript = body.transcript;
    const summary = body.summary;
    const preConsultationData = body.preConsultationData;
    const surveySessionData = body.surveySessionData;

    const summaryStr = typeof summary === 'string' ? summary.trim() : '';
    const transcriptStr = typeof transcript === 'string' ? transcript.trim() : '';

    if (!summaryStr && !transcriptStr) {
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

    let userMessage: string;
    if (summaryStr) {
      userMessage = `내용:\n\n---\n${summaryStr}\n---`;
    } else {
      const preStr = preConsultationData
        ? `[사전문진]\n${JSON.stringify(preConsultationData, null, 2)}\n\n`
        : '';
      const surveyStr = surveySessionData
        ? `[우리 사전문진]\n${JSON.stringify(surveySessionData, null, 2)}\n\n`
        : '';
      userMessage = `${preStr}${surveyStr}[대화]\n\n---\n${transcriptStr}\n---`;
    }
    const fullPrompt = CC_PROMPT + '\n\n' + userMessage;

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
          maxOutputTokens: 256,
          temperature: 0.2,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Gemini API error:', res.status, err);
      return NextResponse.json(
        { error: 'CC 생성 중 오류가 발생했습니다.' },
        { status: 502 }
      );
    }

    const data = await res.json();
    let cc =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    cc = cc.replace(/^["']|["']$/g, '').trim();
    const firstLine = cc.split(/\r?\n/)[0]?.trim() || cc;
    cc = firstLine
      .replace(/^\d+\.\s*/, '')
      .replace(/^주요\s*증상\s*[:：]\s*/i, '')
      .replace(/^\*\s*/, '')
      .replace(/\s*\*\s*$/, '')
      .trim();
    if (cc.length > 80) {
      const cut = cc.slice(0, 80);
      const lastSpace = cut.trimEnd().lastIndexOf(' ');
      cc = lastSpace > 10 ? cut.slice(0, lastSpace).trim() : cut.trim();
    }

    return NextResponse.json({ cc });
  } catch (e) {
    console.error('CC API error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'CC 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
