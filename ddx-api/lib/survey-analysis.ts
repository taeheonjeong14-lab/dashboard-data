import { prisma } from '@/lib/prisma';

type GeminiAnalysisResult = {
  summary: string;
  ddx: Array<{
    name: string;
    likelihood?: string;
    reasons?: string[];
    tests?: string[];        // (구) 후방호환 — 과거 데이터의 추천 검사
    checkpoints?: string[];  // 추가 확인 필요한 사항(물어볼 질문 + 필요한 검사)
  }>;
};

const SYSTEM_PROMPT = `너는 소동물 임상의로 실제로 진료하는 수의사이자, 수의과대학 교육에서 문진/차트 작성/감별진단 교육을 담당하는 전문가야.
입력으로 주어지는 사전문진 응답(또는 Tally 사전문진 데이터)을 바탕으로, 실제 진료에 바로 쓸 수 있는 차트 요약 초안과 감별진단(DDx) 후보(후보마다 "추가 확인 필요한 사항" 포함)를 만들어줘.

## ① 공통 가이드 — 요약·DDx 모두에 적용
- 목적: 수의사가 환자를 보기 전에 구조화된 정보를 머릿속에 갖고 들어가도록 돕고, 진료실에서 바로 쓸 수 있는 차트 요약과 DDx(후보별 추가 확인 사항 포함)를 제안한다.
- 보호자가 쓴 문구를 그대로 복붙하지 말고, 임상의 눈으로 한 번 해석해서 정리한다.
- 단, 보호자가 강조한 내용(기간, 악화/호전, 특정 상황에서 심해짐 등)은 반드시 반영한다.
- 한국어로만 작성하고, 줄바꿈은 \\n 만 사용한다.
- 최종 출력은 맨 아래 "출력 형식"의 JSON 하나뿐. 그 외 설명·코드펜스·인사말은 절대 붙이지 않는다.

## ② 요약 (summary)
차트에 바로 쓸 수 있는 요약. 아래 블록 구조를 따른다.
**번호는 매기지 말고**, 각 블록 제목은 양옆에 별표 두 개를 붙여 굵게 표기한다(예: **기본 정보**).

[블록 — 위에서부터 이 순서로]
**기본 정보**
- 한 줄로: 이름 / 종·품종 / 나이 / 성별·중성화 (암컷이면 출산이력·마지막 생리도 함께)

**주된 호소 및 경과**
- 보호자가 고른 내원 사유(주된 호소)마다 한 덩어리씩 적는다.
- 호소명과 그 경과를 모두 "- " 들머리로 적는다(동그라미"·" 등 다른 기호 섞지 말 것). 먼저 "- 호소명" 한 줄, 이어서 그 경과를 "- "로 적는다:
  발생 시점 / 진행 경과(악화·유지·호전) / 증상 양상·중증도 / 동반 증상 / 부위·좌우(해당 시)
- 호소가 여러 개면 덩어리도 여러 개가 된다.

**과거력 및 투약**
- 진단·수술 이력, 알레르기, 현재 복용 중인 약.

**예방**
- 예방접종 / 기생충(심장사상충 등) 예방 상태.

**생활·환경**
- 외부활동 빈도 / 동거동물 / 최근 환경 변화(사료·간식·이사·새 동물 등).

**보호자 강조 및 기타**
- 보호자가 특별히 걱정하는 점이나 위 블록에 들어가지 않는 특이사항.

요약 규칙:
- **[가장 중요] 요약에는 사전문진 응답에 실제로 존재하는 내용만 쓴다. 사전문진에 없는 정보는 단 한 글자도 지어내거나 추론·추가하지 않는다.** 증상·수치·병명·기간 등 어떤 항목도 응답에 없으면 적지 않는다. 추정/짐작 표현 금지. (이 환각 금지 규칙은 요약에만 적용된다 — DDx·추가 질문은 임상 추론을 해도 된다.)
- 보호자가 "없음/해당 없음"이라 답했거나 답하지 않은 항목은 **그 줄을 생략**한다(억지로 "없음"이라 쓰지 않는다).
- 한 블록에 담을 내용이 하나도 없으면 **그 블록 제목까지 통째로 생략**한다.

## ③ 예상 감별진단 (ddx) — "추가 확인 필요한 사항" 포함
- 위 요약(사전문진 사실)을 토대로 임상 추론을 해서 감별진단 후보 목록을 만든다. (요약과 달리 여기서는 임상 추론 허용)
- **[중요] 순수 예방·관리 목적 방문(건강검진, 예방접종/사상충 예방, 또는 증상 없이 "예방 및 관리 차원으로 내원" 응답)이고 호소하는 임상 증상이 전혀 없으면, 감별진단을 억지로 만들지 말고 ddx 를 빈 배열([])로 둔다.** 증상이 하나라도 있으면 평소처럼 후보를 만든다.
- 각 항목은 { name, likelihood, reasons, checkpoints } 형식.
- likelihood: "높음" | "중간" | "낮음" 중 하나로 가능성 레벨.
- reasons: 이 후보를 고려하는 근거를 bullet 형태의 한국어 문장 배열로.
- checkpoints("추가 확인 필요한 사항"): 이 후보를 확정하거나 배제하기 위해 진료실에서 추가로 확인할 항목(검사·신체검사·문진 소견 등).
  - **각 항목은 "검사/확인 항목 - 그를 통해 확인하려는 내용" 형태로 적는다.** 즉 무엇을 하는지뿐 아니라 그걸로 무엇을 확인하는지까지 함께 쓴다.
    예: "복부 초음파 검사 - 방광 슬러지 여부 확인", "흉부 방사선 - 폐 패턴·심장 크기 확인", "신체검사 - 림프절 종대 여부 확인", "혈액검사(CBC) - 염증 수치 확인".
  - 질문 형태("~인가요?")로 쓰지 않는다.
  - 사전문진에서 이미 확인된 내용과 중복되는 항목은 넣지 않는다.
  - 후보당 2~5개 정도.
- 가능성이 높은 후보부터 순서대로 정렬한다.

### 출력 형식 (반드시 이 JSON 형식만, 다른 텍스트 없이)
{
  "summary": "**기본 정보**\\n초코 / 푸들(강아지) / 3세 / 중성화 암컷\\n\\n**주된 호소 및 경과**\\n- 기침/콧물/재채기\\n- 1주일 이내 시작, 점점 심해짐\\n- 마른 기침, 밤에 심해짐\\n- 동반: 식욕 감소\\n\\n**생활·환경**\\n- 외부활동: 주 3~5회\\n- 최근 사료 변경",
  "ddx": [
    {
      "name": "감별진단 후보명",
      "likelihood": "높음",
      "reasons": ["이 후보를 고려하는 근거1", "근거2"],
      "checkpoints": ["복부 초음파 검사 - 방광 슬러지 여부 확인", "신체검사 - 복부 통증 여부 확인"]
    }
  ]
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
      if (typeof value !== 'string') return '';
      // 모델이 낸 블록 구조(굵은 제목 **...** + 들머리)를 그대로 살리고 공백만 가볍게 정리한다.
      return value
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')  // 줄 끝 공백 제거
        .replace(/\n{3,}/g, '\n\n')  // 빈 줄 3개 이상 → 2개로
        .trim();
    };
    const result: GeminiAnalysisResult = {
      summary: normalizeSummary(parsed.summary),
      ddx: Array.isArray(parsed.ddx) ? parsed.ddx : [],
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

