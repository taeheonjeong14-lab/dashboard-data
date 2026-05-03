import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getImageUrlsFromTallyData } from '@/lib/tally';
import { fetchImagePartsForGemini } from '@/lib/gemini-images';
import { analyzePreConsultationById } from '@/lib/survey-analysis';

// 질문 문자열에서 따옴표·콤마 등 불필요한 문자 제거 (직/곡 따옴표, 앞뒤 콤마)
const QUOTE_AND_COMMA = /^[\s,"'\u201C\u201D\u2018\u2019\u0060\u00AB\u00BB\u2039\u203A،]+|[\s,"'\u201C\u201D\u2018\u2019\u0060\u00AB\u00BB\u2039\u203A،]+$/g;
function cleanQuestionText(s: string): string {
  return s
    .trim()
    .replace(QUOTE_AND_COMMA, '')
    .trim();
}

// Gemini 입력 토큰 절약: 질문 생성에 필요한 최소 데이터만 전달 (응답 잘림 방지)
function trimPayloadForQuestions(fullBody: any): unknown {
  const fields = fullBody?.data?.fields;
  if (!Array.isArray(fields)) return fullBody;
  const trimmed = fields.map((f: any) => ({ label: f?.label ?? null, value: f?.value }));
  return { data: { formName: fullBody?.data?.formName, fields: trimmed } };
}

const BATCH_PROMPT = `너는 수의사 문진을 돕는 역할이야. 아래 "사전문진 데이터"는 보호자가 Tally 폼에 이미 답한 내용이야. 첨부된 사진이 있으면 사진도 보고, 피부·귀·눈 등 보이는 부위나 증상을 참고해서 질문에 반영해줘. 이 데이터(와 사진)를 바탕으로 감별진단(DDx)을 세우기 위해, 전문 수의사라면 문진에서 꼭 추가로 할 만한 질문만 만들어줘.
- 이미 답한 내용은 다시 묻지 말 것. (예: 이름/나이 등이 있으면 그걸 다시 묻는 질문 금지)
- 수의학적으로 의미 있는 추가 정보(증상 세부, 기간, 진행 양상, 식이/환경, 이전 치료 등)를 얻기 위한 질문만 만들어줘.
- 각 질문은 간단명료하게 한 문장. 반드시 물음표(?)로 끝내줘.
- 출력: 번호나 기호 없이 질문만. 설명이나 다른 말 없이 질문만.`;

function isCompleteQuestion(q: string): boolean {
  const t = q.trim();
  // 최소 길이 체크
  if (t.length < 5) return false;
  // 반드시 ?로 끝나야 함
  if (!/[?！？]\s*$/.test(t)) return false;
  // 콤마로 끝나면 잘린 것
  if (/[,،]\s*$/.test(t)) return false;
  // 조사로 끝나면 잘린 것
  if (/\s*(에는|하고|에서|거나|밖에|까지|통|나|이|가|을|를|의|에|로|으로)\s*$/.test(t)) return false;
  // 한 글자나 두 글자로 끝나면 잘린 것 (예: "통", "나")
  if (/[가-힣]{1,2}\s*$/.test(t) && !/[?！？]\s*$/.test(t)) return false;
  return true;
}

async function generateQuestionBatch(
  apiKey: string,
  trimmedData: unknown,
  count: number,
  existing: string[]
): Promise<{ questions: string[]; rawResponse: string }> {
  const extra = existing.length > 0
    ? `\n\n이미 만든 질문(이거 제외하고 다른 걸로):\n${existing.map((q) => `- ${q}`).join('\n')}\n\n위와 다른 질문을 `
    : '';
  const userMessage = `사전문진 데이터:\n${JSON.stringify(trimmedData)}\n\n${extra}질문을 정확히 ${count}개만, 한 줄에 하나씩만 출력해줘.`;
  const fullPrompt = BATCH_PROMPT + '\n\n' + userMessage;

  const imageUrls = getImageUrlsFromTallyData(trimmedData).map((x) => x.url);
  const imageParts = await fetchImagePartsForGemini(imageUrls, { maxImages: 3 });
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: fullPrompt },
    ...imageParts,
  ];

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: 65536, temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    return { questions: [], rawResponse: '' };
  }
  const data = await res.json();
  const contentParts = data.candidates?.[0]?.content?.parts ?? [];
  const fullText = contentParts.map((p: { text?: string }) => p?.text || '').join('').trim();

  if (!fullText) return { questions: [], rawResponse: '' };
  
  const cleaned = fullText.replace(/```/g, '').trim();
  const questionPattern = /[^?！？]+[?！？]+/g;
  const matches = cleaned.match(questionPattern) || [];
  
  const questions = matches
    .map((q: string) => {
      let trimmed = q.trim().replace(/^[-*•\d.]+\s*/, '').trim();
      trimmed = cleanQuestionText(trimmed);
      return trimmed;
    })
    .filter((q: string) => {
      if (!/[?！？]\s*$/.test(q)) return false;
      return isCompleteQuestion(q);
    });
  
  return { questions, rawResponse: fullText };
}

async function generateQuestions(preConsultationData: any): Promise<{ questions: string[]; rawResponse: string }> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    return { questions: [], rawResponse: '' };
  }
  try {
    const trimmedData = trimPayloadForQuestions(preConsultationData);
    const questions: string[] = [];
    const seen = new Set<string>();
    let combinedRawResponse = '';

    // 호출 1번, 상한 65536으로 질문 5~7개 한 줄씩 한 번에 받기
    const targetCount = 6;
    const batch = await generateQuestionBatch(apiKey, trimmedData, targetCount, []);
    combinedRawResponse = batch.rawResponse || '';
    for (const q of batch.questions) {
      const key = q.slice(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        questions.push(q);
      }
    }

    return { questions: questions.slice(0, 10), rawResponse: combinedRawResponse };
  } catch (e) {
    console.error('generateQuestions 에러:', e);
    return { questions: [], rawResponse: '' };
  }
}

// 테스트용: GET 요청도 받아서 엔드포인트가 작동하는지 확인
export async function GET() {
  console.log('✅ Tally webhook endpoint is accessible');
  return NextResponse.json({ 
    success: true, 
    message: 'Tally webhook endpoint is working',
    timestamp: new Date().toISOString()
  });
}

export async function POST(request: NextRequest) {
  try {
    const hospitalIdFromUrl = new URL(request.url).searchParams.get('hospitalId')?.trim() || null;
    let hospitalId: string | null = null;
    if (hospitalIdFromUrl) {
      const hospital = await prisma.hospital.findUnique({ where: { id: hospitalIdFromUrl } });
      if (!hospital) {
        return NextResponse.json({ success: false, error: 'Invalid or unknown hospitalId' }, { status: 400 });
      }
      hospitalId = hospital.id;
    }

    const body = await request.json();
    const responseId = body.data?.responseId || body.data?.submissionId || body.responseId;
    const fields = body.data?.fields || [];
    
    let patientName = '';
    let guardianName = '';
    
    for (const field of fields) {
      if (field.label === '반려동물 이름' && field.value) {
        patientName = String(field.value);
      } else if (field.label === '성명' && field.value) {
        guardianName = String(field.value);
      }
    }
    
    const rawData = body;

    if (!responseId) {
      return NextResponse.json({ success: false, error: 'responseId required' }, { status: 400 });
    }

    const existing = await prisma.preConsultation.findUnique({
      where: { tallyResponseId: responseId },
    });

    if (existing) {
      return NextResponse.json({ success: true, message: 'Already exists' });
    }

    const trimmedForGemini = trimPayloadForQuestions(rawData);
    const result = await generateQuestions(trimmedForGemini);

    const rawToStore =
      typeof result.rawResponse === 'string' && result.rawResponse.length > 0
        ? result.rawResponse
        : '[raw not captured]';

    const created = await prisma.preConsultation.create({
      data: {
        hospitalId,
        patientName: patientName?.trim() || null,
        guardianName: guardianName?.trim() || null,
        tallyData: rawData,
        tallyResponseId: responseId,
        questions: result.questions.length > 0 ? result.questions : undefined,
        geminiRawResponse: rawToStore,
        isUsed: false,
      },
    });
    // Tally 사전문진이 저장되면 비동기로 사전 분석 실행
    void analyzePreConsultationById(created.id).catch((e) =>
      console.error('analyzePreConsultationById failed:', e),
    );

    return NextResponse.json({ success: true, questionsCount: result.questions.length });
  } catch (e) {
    console.error('Tally webhook error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
