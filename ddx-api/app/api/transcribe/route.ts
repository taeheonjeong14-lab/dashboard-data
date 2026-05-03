import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY가 설정되지 않았습니다. .env.local에 추가해주세요.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: '오디오 파일(file)이 필요합니다.' },
        { status: 400 }
      );
    }

    const body = new FormData();
    body.append('file', file);
    body.append('model', 'whisper-1');
    body.append('language', 'ko');
    body.append('response_format', 'text');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      let message = `Whisper API 오류: ${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) message += ' - ' + errJson.error.message;
      } catch {
        if (errText) message += ' - ' + errText.slice(0, 200);
      }
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const text = await res.text();
    const transcript = (text || '').trim();

    return NextResponse.json({ transcript });
  } catch (e) {
    console.error('Transcribe API error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '전사 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
