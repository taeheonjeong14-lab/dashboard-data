import { prisma } from '@/lib/prisma';

type GeminiAnalysisResult = {
  summary: string;
  ddx: Array<{
    name: string;
    likelihood?: string;
    reasons?: string[];
    tests?: string[];
  }>;
  followUpQuestions: string[];
};

const SYSTEM_PROMPT = `너는 소동물 임상의로 실제로 진료하는 수의사이자, 수의과대학 교육에서 문진/차트 작성/감별진단 교육을 담당하는 전문가야.
입력으로 주어지는 사전문진 응답(또는 Tally 사전문진 데이터)을 바탕으로, 실제 진료에 바로 쓸 수 있는 차트 요약 초안과 감별진단(DDx) 후보, 그리고 진료실에서 추가로 물어보면 좋은 질문 목록을 만들어줘.

### 전체 목적
- 수의사가 아이를 보기 전에 이미 머릿속에 구조화된 정보를 가지고 들어갈 수 있도록 돕기
- 실제 진료실에서 바로 쓸 수 있는 형태의 차트 요약과 DDx, 팔로업 질문을 제안하기

### 출력해야 할 세 가지
1) summary: 실시간 문진 요약과 동일한 형식으로, **다음 5개 항목을 반드시 번호 순서대로 고정 출력**.
   - 1. 주요 증상
   - 2. 발생 시점 및 지속 시간
   - 3. 환자의 과거 병력·투약·접종
   - 4. 식이·환경·생활
   - 5. 그 외 특이사항
   규칙:
   - 사전문진에 나온 사실만 적고 추론·추가는 하지 않는다.
   - 중복은 한 번만. 추정 표현 금지.
   - 반드시 아래 템플릿 형태를 유지:
     1) ...

     2) ...

     3) ...

     4) ...

     5) ...
   - 한국어로만 작성하고 줄바꿈은 \\n만 사용.

2) ddx: 감별진단 후보 목록  
   - 각 항목은 { name, likelihood, reasons, tests } 형식
   - likelihood: "높음" | "중간" | "낮음" 중 하나로 가능성 레벨
   - reasons: 이 후보를 고려하는 근거를 bullet 형태의 한국어 문장 배열로
   - tests: 이 후보를 좁히기 위해 도움이 될 검사(혈액/영상/기초검사 등)를 bullet 배열로

3) followUpQuestions: 실제 진료실에서 보호자에게 추가로 물어보면 좋은 질문 목록  
   - 보호자가 사전문진에서 이미 적은 내용과 **중복되는 질문은 절대 포함하지 말 것**
   - DDx를 더 좁히거나, 치료/예후 판단에 꼭 필요한 질문 위주
   - 각 질문은 짧고 명료한 한국어 한 문장, 물음표로 끝나야 함
   - 3~10개 정도 생성

### 중요한 제약
- 요약과 DDx, 질문 모두 **보호자가 쓴 문구를 그대로 복붙하지 말고**, 임상의 눈으로 한 번 해석해서 정리해 줄 것
- 단, 보호자가 강조한 내용(기간, 악화/호전, 특정 상황에서 심해짐 등)은 반드시 반영
- 질문 목록에는 이미 사전문진에서 물어본 질문 내용은 빼고, 부족한 부분을 메우는 질문만 포함

### 출력 형식 (반드시 이 JSON 형식만, 다른 텍스트 없이)
{
  "summary": "차트 요약 초안 (한국어 문자열)",
  "ddx": [
    {
      "name": "감별진단 후보명",
      "likelihood": "높음",
      "reasons": ["이 후보를 고려하는 근거1", "근거2"],
      "tests": ["추천 검사1", "추천 검사2"]
    }
  ],
  "followUpQuestions": ["추가로 물어볼 질문1?", "추가로 물어볼 질문2?"]
}`;

async function callGeminiForAnalysis(payload: unknown): Promise<GeminiAnalysisResult | null> {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
          {
            role: 'user',
            parts: [
              {
                text:
                  '다음은 사전문진(또는 Tally)에서 수집된 원본 데이터야. 위 규칙에 따라 JSON만 출력해줘.\n\n' +
                  JSON.stringify(payload),
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      }),
    },
  );

  if (!res.ok) {
    console.error('Gemini analysis API error:', await res.text());
    return null;
  }

  const data = await res.json();
  const text: string =
    data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') ?? '';
  if (!text) return null;

  let cleaned = text.trim();
  cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    const normalizeSummary = (value: unknown): string => {
      const fallback = '1) -\n\n2) -\n\n3) -\n\n4) -\n\n5) -';
      if (typeof value !== 'string') return fallback;
      const lines = value
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const picked = lines.filter((l) => !/^[-*•]\s*$/.test(l)).slice(0, 5);
      while (picked.length < 5) picked.push('-');
      return [
        `1) ${picked[0]}`,
        '',
        `2) ${picked[1]}`,
        '',
        `3) ${picked[2]}`,
        '',
        `4) ${picked[3]}`,
        '',
        `5) ${picked[4]}`,
      ].join('\n');
    };
    const result: GeminiAnalysisResult = {
      summary: normalizeSummary(parsed.summary),
      ddx: Array.isArray(parsed.ddx) ? parsed.ddx : [],
      followUpQuestions: Array.isArray(parsed.followUpQuestions)
        ? parsed.followUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim().length > 0)
        : [],
    };
    return result;
  } catch (e) {
    console.error('Gemini analysis JSON parse error:', e, cleaned.slice(0, 500));
    return null;
  }
}

export async function analyzeSurveySessionById(sessionId: string): Promise<void> {
  try {
    await prisma.surveySession.update({
      where: { id: sessionId },
      data: { analysisStatus: 'processing' },
    });

    const session = await prisma.surveySession.findUnique({
      where: { id: sessionId },
      include: {
        questions: {
          orderBy: { order: 'asc' },
        },
        answers: true,
      },
    });

    if (!session) return;

    const payload = {
      meta: {
        patientName: session.patientName,
        guardianName: session.guardianName,
        contact: session.contact,
        visitType: session.visitType,
        scheduledDate: session.scheduledDate,
      },
      questionsAndAnswers: session.questions.map((q) => {
        const a = session.answers.find((ans) => ans.questionInstanceId === q.id);
        let answer: unknown = null;
        if (a?.answerJson !== null && a?.answerJson !== undefined) {
          answer = a.answerJson;
        } else if (a?.answerText) {
          answer = a.answerText;
        }
        return {
          order: q.order,
          text: q.text,
          type: q.type,
          options: q.options,
          answer,
        };
      }),
    };

    const analysis = await callGeminiForAnalysis(payload);

    if (!analysis) {
      await prisma.surveySession.update({
        where: { id: sessionId },
        data: { analysisStatus: 'error' },
      });
      return;
    }

    await prisma.surveySession.update({
      where: { id: sessionId },
      data: {
        analysisStatus: 'done',
        draftSummary: analysis.summary || null,
        draftDdx: analysis.ddx && analysis.ddx.length > 0 ? JSON.stringify(analysis.ddx) : null,
        followUpQuestions:
          analysis.followUpQuestions && analysis.followUpQuestions.length > 0
            ? analysis.followUpQuestions
            : undefined,
      },
    });
  } catch (e) {
    console.error('analyzeSurveySessionById error:', e);
    try {
      await prisma.surveySession.update({
        where: { id: sessionId },
        data: { analysisStatus: 'error' },
      });
    } catch {
      // ignore
    }
  }
}

export async function analyzePreConsultationById(preConsultationId: string): Promise<void> {
  try {
    await prisma.preConsultation.update({
      where: { id: preConsultationId },
      data: { analysisStatus: 'processing' },
    });

    const pc = await prisma.preConsultation.findUnique({
      where: { id: preConsultationId },
    });
    if (!pc) return;

    const payload = {
      meta: {
        patientName: pc.patientName,
        guardianName: pc.guardianName,
      },
      tallyData: pc.tallyData,
      questionsFromTally: pc.questions,
    };

    const analysis = await callGeminiForAnalysis(payload);

    if (!analysis) {
      await prisma.preConsultation.update({
        where: { id: preConsultationId },
        data: { analysisStatus: 'error' },
      });
      return;
    }

    await prisma.preConsultation.update({
      where: { id: preConsultationId },
      data: {
        analysisStatus: 'done',
        draftSummary: analysis.summary || null,
        draftDdx: analysis.ddx && analysis.ddx.length > 0 ? JSON.stringify(analysis.ddx) : null,
        followUpQuestions:
          analysis.followUpQuestions && analysis.followUpQuestions.length > 0
            ? analysis.followUpQuestions
            : undefined,
      },
    });
  } catch (e) {
    console.error('analyzePreConsultationById error:', e);
    try {
      await prisma.preConsultation.update({
        where: { id: preConsultationId },
        data: { analysisStatus: 'error' },
      });
    } catch {
      // ignore
    }
  }
}

