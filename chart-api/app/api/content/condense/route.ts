import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const items = body.items;
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.some((i) => typeof i !== 'string')
  ) {
    return NextResponse.json({ error: 'items must be a non-empty string array' }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 503 });
  }

  const prompt = [
    '너는 수의학 보고서 편집 전문가야.',
    '아래 JSON 배열의 각 텍스트 항목을 간결하게 다시 써라.',
    '',
    '규칙:',
    '- 의학적 내용(진단명, 수치, 소견, 권고사항)은 하나도 빠뜨리지 않는다.',
    '- 문체와 어조(보호자 대상 공식 보고서 톤)를 그대로 유지한다.',
    '- 중복 표현, 불필요한 접속어, 군더더기 수식어만 제거한다.',
    '- 빈 문자열("")은 그대로 빈 문자열("")로 유지한다.',
    '- 입력 배열과 정확히 동일한 길이의 JSON 배열로만 응답한다.',
    '- 마크다운 코드 펜스나 설명 텍스트 없이 JSON 배열만 출력한다.',
    '',
    '입력:',
    JSON.stringify(items as string[]),
  ].join('\n');

  try {
    const raw = await geminiGenerateText(prompt, { maxOutputTokens: 8192 });
    if (!raw.trim()) throw new Error('Gemini returned empty response.');

    let parsed: unknown;
    try {
      parsed = tryParseJsonObject(raw);
    } catch {
      throw new Error(`Gemini returned non-JSON. Preview: ${raw.replace(/\s+/g, ' ').slice(0, 200)}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Gemini response is not a JSON array.');
    }
    if (parsed.length !== (items as string[]).length) {
      // 단일 항목인데 모델이 문단별로 쪼개 보낸 경우 → 다시 하나로 합친다.
      // (다중 항목 섹션은 위치 매핑이 중요하므로 엄격하게 길이 검사를 유지한다.)
      if ((items as string[]).length === 1 && parsed.every((x) => typeof x === 'string')) {
        return NextResponse.json({ items: [(parsed as string[]).join('\n\n')] });
      }
      throw new Error(`Array length mismatch: expected ${(items as string[]).length}, got ${parsed.length}`);
    }

    return NextResponse.json({ items: parsed });
  } catch (e) {
    console.error('[content/condense] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '간결 생성 실패' },
      { status: 500 },
    );
  }
}
