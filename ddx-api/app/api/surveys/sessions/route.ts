import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { effectiveSurveyStatus } from '@/lib/survey-expiry';
import type { Prisma } from '@prisma/client';
import {
  buildFirstVisitQuestionRows,
  buildPrefilledPetRows,
  FOLLOW_UP_FIXED_QUESTIONS,
  buildOptionsJson,
  isFollowUpVisit,
  isExistingPatientVisit,
  type ExistingPatientInfo,
  type QuestionDef,
} from '@/lib/survey-questions';

async function getApprovedUser(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, approved: true, active: true, deletedAt: null },
    select: { id: true, hospitalId: true },
  });
}

// GET /api/surveys/sessions?userId=xxx — 내 병원의 사전문진 세션 목록
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const sp = url.searchParams;
    const userId = sp.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const q = sp.get('q')?.trim() ?? '';
    const usedParam = sp.get('used'); // "true" | "false" | null
    const includeUsed = sp.get('includeUsed') === 'true';
    const take = Math.min(Math.max(parseInt(sp.get('take') ?? '50', 10) || 50, 1), 500);
    const scheduledFrom = sp.get('scheduledFrom')?.trim() || '';
    const scheduledTo = sp.get('scheduledTo')?.trim() || '';
    const createdFrom = sp.get('createdFrom')?.trim() || '';
    const createdTo = sp.get('createdTo')?.trim() || '';
    const usedFrom = sp.get('usedFrom')?.trim() || '';
    const usedTo = sp.get('usedTo')?.trim() || '';

    const user = await getApprovedUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const where: Prisma.SurveySessionWhereInput = {};
    // Hospital scoping: only sessions created under the same hospital are visible.
    // If the user has no hospitalId, only sessions with hospitalId = null are visible.
    where.hospitalId = user.hospitalId ?? null;
    if (q) {
      where.OR = [
        { patientName: { contains: q, mode: 'insensitive' } },
        { guardianName: { contains: q, mode: 'insensitive' } },
      ];
    }
    // scheduledDate range (applies only when scheduledDate exists)
    if (scheduledFrom || scheduledTo) {
      const gte = scheduledFrom ? new Date(`${scheduledFrom}T00:00:00`) : undefined;
      const lte = scheduledTo ? new Date(`${scheduledTo}T23:59:59.999`) : undefined;
      where.scheduledDate = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }
    if (createdFrom || createdTo) {
      const gte = createdFrom ? new Date(`${createdFrom}T00:00:00`) : undefined;
      const lte = createdTo ? new Date(`${createdTo}T23:59:59.999`) : undefined;
      where.createdAt = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }

    const sessions = await prisma.surveySession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        token: true,
        patientName: true,
        guardianName: true,
        contact: true,
        visitType: true,
        scheduledDate: true,
        status: true,
        createdAt: true,
        completedAt: true,
        analysisStatus: true,
        _count: { select: { questions: true } },
      },
    });

    const sessionIds = sessions.map((s) => s.id);
    const usedSessionIds = new Set<string>();
    const usedAtBySessionId: Record<string, string> = {};
    if (sessionIds.length > 0) {
      try {
        const used = await prisma.consultation.findMany({
          where: { surveySessionId: { in: sessionIds } },
          select: { surveySessionId: true, createdAt: true },
        });
        for (const c of used) {
          if (c.surveySessionId) {
            usedSessionIds.add(c.surveySessionId);
            usedAtBySessionId[c.surveySessionId] = c.createdAt.toISOString();
          }
        }
      } catch (err) {
        // DB에 surveySessionId 컬럼이 없을 수 있음 → 전부 미사용으로 처리
        console.warn('GET /api/surveys/sessions: consultation.findMany failed (surveySessionId?)', err);
      }
    }

    const sessionsWithUsed = sessions.map((s) => ({
      ...s,
      status: effectiveSurveyStatus(s.status, s.scheduledDate), // 내원예정일+7일 지난 pending 은 expired 로 보정
      isUsed: usedSessionIds.has(s.id),
      usedAt: usedAtBySessionId[s.id] ?? null,
    }));

    const usedFromDate = usedFrom ? new Date(`${usedFrom}T00:00:00`) : null;
    const usedToDate = usedTo ? new Date(`${usedTo}T23:59:59.999`) : null;
    const filtered = sessionsWithUsed.filter((s) => {
      if (usedParam === 'true' && !s.isUsed) return false;
      if (usedParam === 'false' && s.isUsed) return false;
      if (usedFromDate || usedToDate) {
        const iso = s.usedAt ?? null;
        if (!iso) return false;
        const d = new Date(iso);
        if (usedFromDate && d < usedFromDate) return false;
        if (usedToDate && d > usedToDate) return false;
      }
      return true;
    });

    return NextResponse.json({ success: true, sessions: filtered });
  } catch (e) {
    console.error('GET /api/surveys/sessions error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// POST /api/surveys/sessions — 사전문진 세션 생성 + 고정 질문 삽입
export async function POST(request: NextRequest) {
  try {
    const rawText = (await request.text()).replace(/^\uFEFF/, '').trim();

    // 1) userId는 반드시 raw 문자열에서 먼저 추출 (파싱 이슈와 무관하게)
    let userId = '';
    const userIdMatch = rawText?.match(/"user[iI]d"\s*:\s*"([^"]+)"/);
    if (userIdMatch?.[1]) {
      userId = userIdMatch[1].trim();
    }
    // 2) JSON으로 파싱해서 나머지 필드 + userId 없었으면 한 번 더 시도
    let body: unknown = undefined;
    if (rawText) {
      try {
        body = JSON.parse(rawText) as unknown;
      } catch {
        body = undefined;
      }
    }
    if (!userId && body && typeof body === 'object' && !Array.isArray(body)) {
      const obj = body as Record<string, unknown>;
      const raw = obj.userId ?? obj.userID;
      if (typeof raw === 'string') userId = raw.trim();
      else if (raw != null) userId = String(raw);
    }
    if (typeof body === 'string' && !userId) userId = body.trim();

    let patientName: string | null = null;
    let guardianName: string | null = null;
    let contact: string | null = null;
    let visitType: string | null = null;
    let scheduledDate: Date | null = null;
    let previousChart: string | null = null;
    let petSpecies: string | null = null;
    let petBreed: string | null = null;
    let petSex: string | null = null;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const obj = body as Record<string, unknown>;
      patientName = typeof obj.patientName === 'string' && obj.patientName.trim() ? obj.patientName.trim() : null;
      guardianName = typeof obj.guardianName === 'string' && obj.guardianName.trim() ? obj.guardianName.trim() : null;
      contact = typeof obj.contact === 'string' && obj.contact.trim() ? obj.contact.trim() : null;
      const vt = typeof obj.visitType === 'string' ? obj.visitType.trim() : '';
      visitType = vt || null;
      const scheduledDateStr = typeof obj.scheduledDate === 'string' && obj.scheduledDate.trim() ? obj.scheduledDate.trim() : null;
      scheduledDate = scheduledDateStr ? new Date(scheduledDateStr) : null;
      previousChart = typeof obj.previousChart === 'string' && obj.previousChart.trim() ? obj.previousChart.trim() : null;
      petSpecies = typeof obj.petSpecies === 'string' && obj.petSpecies.trim() ? obj.petSpecies.trim() : null;
      petBreed = typeof obj.petBreed === 'string' && obj.petBreed.trim() ? obj.petBreed.trim() : null;
      petSex = typeof obj.petSex === 'string' && obj.petSex.trim() ? obj.petSex.trim() : null;
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId required', _debug: { rawLength: rawText?.length ?? 0, hasMatch: !!userIdMatch } },
        { status: 400 }
      );
    }

    const user = await getApprovedUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (!contact) {
      return NextResponse.json({ success: false, error: '연락처를 입력해 주세요.' }, { status: 400 });
    }

    const token = randomBytes(24).toString('hex');
    const followUp = isFollowUpVisit(visitType);
    // 기존 환자(새 증상·경과 확인)면 병원이 입력한 종/품종/성별을 선답변으로 사용.
    const existingInfo: ExistingPatientInfo | undefined =
      isExistingPatientVisit(visitType) && petSpecies && petSex
        ? { species: petSpecies, breed: petBreed ?? undefined, sex: petSex }
        : undefined;

    let fixedQuestions: QuestionDef[];
    if (followUp) {
      // 경과 확인: 이전 차트 기반 AI 질문(아래). 종/품종/성별은 숨김 선답변으로 앞에 둔다(요약 시그널먼트용).
      fixedQuestions = existingInfo ? [...buildPrefilledPetRows(existingInfo), ...FOLLOW_UP_FIXED_QUESTIONS] : FOLLOW_UP_FIXED_QUESTIONS;
    } else {
      // 신규환자(existingInfo 없음) 또는 새 증상(existingInfo 있음).
      fixedQuestions = buildFirstVisitQuestionRows(guardianName, patientName, contact, { existing: existingInfo });
    }

    // 선답변(숨김) 질문의 답을 order 로 기억했다가 세션 생성 후 SurveyAnswer 로 저장.
    const prefilledByOrder = new Map<number, string>();
    const allQuestionData: Prisma.SurveyQuestionInstanceCreateWithoutSessionInput[] = fixedQuestions.map((q, idx) => {
      if (q.prefilled && q.prefilledAnswer) prefilledByOrder.set(idx + 1, q.prefilledAnswer);
      return {
        order: idx + 1,
        source: q.prefilled ? 'prefilled' : 'fixed', // prefilled 는 작성 화면에서 숨김
        stage: q.category ?? 'initial', // 카테고리를 stage 로 운반(작성 화면 카테고리 인트로용)
        text: q.text,
        type: q.type,
        options: buildOptionsJson(q) ?? undefined,
      };
    });

    if (followUp) {
      if (!previousChart) {
        return NextResponse.json(
          { success: false, error: '경과 확인 사전문진은 이전 차트 내용이 필요합니다. (질문 생성을 위해 차트를 붙여넣어 주세요.)' },
          { status: 400 }
        );
      }
      try {
        const aiRes = await generateSurveyQuestions(previousChart, existingInfo);
        const startOrder = allQuestionData.length + 1;
        for (let i = 0; i < aiRes.length; i++) {
          allQuestionData.push({
            order: startOrder + i,
            source: 'ai_generated',
            stage: 'initial',
            text: aiRes[i].text,
            type: aiRes[i].type,
            options: (aiRes[i].options as Prisma.InputJsonValue) ?? undefined,
          });
        }
      } catch (err) {
        console.error('AI question generation failed:', err);
        if (err instanceof AiQuestionError) {
          const detail = err.detail ? ` [상세: ${err.detail}]` : '';
          const reasonMessage: Record<AiQuestionErrorReason, string> = {
            missing_api_key: '서버에 Gemini API 키가 설정되지 않았습니다.',
            api_http_error: 'Gemini API 호출 중 오류가 발생했습니다.',
            empty_response: 'AI 응답이 비어 있습니다.',
            json_not_found: 'AI 응답에서 질문 JSON 배열을 찾지 못했습니다.',
            json_parse_error: 'AI 응답 JSON 파싱에 실패했습니다.',
            invalid_question_types: 'AI가 허용되지 않은 질문 타입만 생성했습니다.',
            no_questions_after_filter: 'AI가 사용 가능한 질문을 생성하지 못했습니다.',
          };
          return NextResponse.json(
            {
              success: false,
              error: `AI 질문 생성 실패: ${reasonMessage[err.reason]}${detail}`,
              reason: err.reason,
              reasonDetail: err.detail ?? null,
            },
            { status: 502 }
          );
        }
        return NextResponse.json(
          {
            success: false,
            error:
              'AI 질문 생성에 실패했습니다. (Gemini API 키/네트워크/모델 응답 문제) 잠시 후 다시 시도하거나 서버 환경변수를 확인해 주세요.',
          },
          { status: 502 }
        );
      }
    }

    const session = await prisma.surveySession.create({
      data: {
        patientName,
        guardianName,
        contact,
        visitType,
        scheduledDate,
        previousChartText: previousChart,
        token,
        hospitalId: user.hospitalId ?? undefined,
        questions: {
          create: allQuestionData,
        },
      },
      select: {
        id: true,
        token: true,
        patientName: true,
        guardianName: true,
        contact: true,
        visitType: true,
        status: true,
        createdAt: true,
        questions: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            order: true,
            source: true,
            stage: true,
            text: true,
            type: true,
            options: true,
          },
        },
      },
    });

    // 선답변(숨김) 질문의 답 저장 — 보호자에겐 안 보이지만 분기·요약에 사용.
    const prefilledAnswerRows = session.questions
      .filter((qi) => qi.source === 'prefilled' && prefilledByOrder.has(qi.order))
      .map((qi) => ({ sessionId: session.id, questionInstanceId: qi.id, answerText: prefilledByOrder.get(qi.order)! }));
    if (prefilledAnswerRows.length > 0) {
      await prisma.surveyAnswer.createMany({ data: prefilledAnswerRows });
    }

    return NextResponse.json({ success: true, session });
  } catch (e) {
    console.error('POST /api/surveys/sessions error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// ─── AI 질문 생성 헬퍼 ───────────────────────────────────

const AI_PROMPT = `너는 경험이 풍부한 수의사이자 사전문진 설계 전문가야.
이전 진료 차트 기록을 바탕으로, 재진 사전문진 질문을 설계해줘.

## 사전문진의 목적
수의사가 내원 전에 미리 정보를 파악하여:
1) 가장 적절한 감별진단(DDx) 후보를 추릴 수 있도록 돕기
2) 내원 시 가장 적합한 검사와 처치를 바로 결정할 수 있도록 돕기

## 재진 사전문진에서 반드시 다뤄야 할 두 가지 핵심
1) 지난 진료 이후 경과 — 처방약 반응, 증상 호전/악화/변화 없음 여부, 식욕·활력 변화 등
2) 새롭게 발현된 증상 — 지난 진료 때는 없었지만 이후 새로 생긴 이상 증상

위 두 가지를 포함하되, 차트 내용을 분석해 수의사가 DDx와 처치 결정에 도움이 될 추가 질문이 있으면 자유롭게 포함해줘.

## 질문 생성 패턴(매우 중요)
질문은 "광범위 증상 체크리스트" 방식이 아니라, 반드시 "차트 기반 타깃 확인" 방식으로 만든다.

1) 이전 차트에서 핵심 문제(주호소/의심질환/치료·처방/경과 관찰 포인트)를 먼저 추론한다.
2) 그 핵심 문제와 직접 관련된 타깃 질문을 만든다.
   - 예: "지난번 피부염/외이염 치료 후 가려움은 지금 어느 정도인가요?"
   - 예: "지난번 구토 치료 후 구토가 다시 나타났나요?"
3) 질문은 "그 증상이 있나요?" 또는 "증상의 강도/빈도/변화는 어느 정도인가요?"처럼 구체적으로 묻는다.
4) 질문 순서는 "핵심 타깃 증상 존재 여부 → 강도/빈도/변화 → 동반 증상/악화요인" 흐름으로 구성한다.
5) 차트 근거 없이 보호자에게 전신 증상을 광범위하게 싸그리 묻는 질문(포괄 체크리스트형)은 피한다.
6) 단, 안전을 위해 필요한 경우에만 최소 1개의 넓은 스크리닝 질문을 둘 수 있다.

## [매우 중요] "보호자가 실제로 답할 수 있는 질문"으로 만든다
질문은 수의사의 언어가 아니라, 보호자가 집에서 직접 보고 겪은 것으로 답할 수 있는 형태여야 한다. 단순히 의학용어를 피하는 수준이 아니라, 보호자가 답을 알 수 있고 답하기 쉬운 형태로 반드시 바꿔서 묻는다. 보호자는 자기가 하는/할 수 있는 행동의 선상에서만 이 과정을 이해한다는 점을 항상 전제한다.

- **약 이름을 언급하지 않는다.** 보호자는 그냥 "준 약"을 먹였을 뿐 그게 무슨 약·성분인지 모른다. 약명 대신 "지난번 처방받은 약" 정도로만 지칭하거나, 그 약이 노리던 증상의 변화로 바꿔 묻는다. (예: "○○정 복용 후…" 처럼 약 이름을 쓰면 안 됨)
- **보호자가 직접 확인할 수 없는 것은 절대 묻지 않는다.** 심박수·호흡수(정확한 수치)·체온·혈압·혈당·혈액수치·영상/검사 소견처럼 기구나 검사 없이 알 수 없는 값은 묻지 않는다. (예: "심박수가 몇이었나요?" 같은 질문은 말이 안 됨)
- 대신 보호자가 **눈으로 본 모습·행동**이나 **직접 한 행동(먹은 양·물 마신 양·산책·배변·구토 여부 등)** 으로 답할 수 있게 바꾼다.
  - 예) 호흡수 → "가만히 쉴 때 숨이 평소보다 빨라 보이나요?"
  - 예) 통증 정도 → "만지거나 안을 때 아파하거나 싫어하나요?"
  - 예) 약 반응 → "지난번 처방받은 약을 드신 뒤 그 증상이 좋아졌나요?"
- 단, 이렇게 쉽게 바꾸면서도 **수의사가 경과·악화·합병증 등 임상적 판단을 내리는 데 도움이 되는** 정보를 끌어내야 한다. (보호자가 답할 수 있음 + 임상적으로 의미 있음, 두 가지를 동시에 만족시킬 것)

## 이미 포함된 고정 질문 (절대 중복 금지)
아래 질문들은 사전문진에 이미 포함되어 있으므로, 같거나 유사한 내용을 다시 묻지 않는다:
- "활력/컨디션은 어떤가요?" (평소와 비슷해요 / 좀 처져 있어요 / 많이 안 좋아요)
- "식욕은 어떤가요?" (정상 / 줄었어요 / 늘었어요)

## 질문 설계 규칙
- 위 고정 질문과 겹치거나 유사한 질문은 절대 만들지 않는다
- 같은 주제·내용을 두 번 묻지 않는다 (중복 금지)
- 주관식 질문(short_text, long_text)은 절대 사용하지 않는다
- 모든 질문은 반드시 선택형으로만 구성한다: single_choice(단일 선택), multi_choice(복수 선택), scale(숫자 척도) — 이 세 가지 유형은 모두 적극 활용해도 좋다
- 주관식으로 물어볼 법한 내용도 AI가 해당 차트와 상황에서 가장 likely한 보기를 직접 만들어서 선택형으로 변환
- 보기는 임상적으로 의미 있는 선택지로 구성하고, 마지막에는 항상 "기타(직접 입력)" 또는 "해당 없음" 포함
- 최소 4개, 최대 10개 질문 생성
- 이름·연락처 등 기본 신상 정보는 묻지 않기
- 보호자가 이해하기 쉬운 일상 언어로 작성 (의학 전문용어 최소화)
- 질문의 대부분(최소 70%)은 반드시 차트 기반 타깃 질문으로 구성한다
- 증상 상세 질문이 2개 이상 나오도록 구성하되, 차트와 무관한 과도한 질문은 피한다
- scale 질문의 점수 범위는 반드시 1~10으로 통일한다

## 응답 형식 (반드시 JSON 배열만 출력, 다른 텍스트 없이)
[
  { "text": "질문 내용", "type": "single_choice", "options": { "choices": ["보기1", "보기2", "보기3", "기타(직접 입력)"] } },
  { "text": "질문 내용", "type": "multi_choice", "options": { "choices": ["보기1", "보기2", "보기3", "해당 없음"] } },
  { "text": "질문 내용", "type": "scale", "options": { "min": 1, "max": 10, "minLabel": "매우 나쁨", "maxLabel": "매우 좋음" } }
]`;

type AiQuestionErrorReason =
  | 'missing_api_key'
  | 'api_http_error'
  | 'empty_response'
  | 'json_not_found'
  | 'json_parse_error'
  | 'invalid_question_types'
  | 'no_questions_after_filter';

class AiQuestionError extends Error {
  reason: AiQuestionErrorReason;
  detail?: string;
  constructor(reason: AiQuestionErrorReason, message: string, detail?: string) {
    super(message);
    this.reason = reason;
    this.detail = detail;
  }
}

async function generateSurveyQuestions(
  chartContent: string,
  patient?: ExistingPatientInfo,
): Promise<Array<{ text: string; type: string; options: unknown }>> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiQuestionError('missing_api_key', 'Gemini API key not configured');
  }

  // 병원이 발송 시 입력한 종/품종/성별(중성화 여부 포함) — AI가 이 동물에 맞는 질문만 만들도록 명시.
  const patientDesc = patient
    ? [`종류: ${patient.species}`, patient.breed ? `품종: ${patient.breed}` : '', `성별: ${patient.sex}`]
        .filter(Boolean)
        .join(' / ')
    : '';
  const patientBlock = patientDesc
    ? `[환자 정보]\n${patientDesc}\n(반드시 위 종·성별·중성화 상태에 맞는 질문만 생성한다. 다른 종 전용 질문 금지, 중성화된 개체에 임신·발정·생리 등 생식 관련 질문 금지, 성별에 맞지 않는 질문 금지.)\n\n`
    : '';

  const userMessage = `아래 이전 진료 차트를 분석해서 재진 사전문진 질문을 JSON 배열로 생성해줘.\n\n주의사항:\n- 활력/컨디션, 식욕 관련 질문은 이미 있으므로 절대 중복하지 말 것\n- 같은 주제를 두 번 묻지 말 것\n- 주관식(short_text, long_text)은 절대 사용하지 말 것\n- 모든 질문은 선택형(single_choice, multi_choice, scale)으로만 구성할 것\n- scale은 반드시 1~10 범위로 생성할 것\n- 보기에서 기타가 필요하면 "기타(직접 입력)"으로 제공할 것\n- 약 이름, 심박수 같은 수치 등 보호자가 모르거나 직접 확인할 수 없는 건 절대 묻지 말 것. 보호자가 눈으로 보거나 직접 한 행동으로 답할 수 있는 형태로 만들 것\n- 아래 [환자 정보]의 종·성별·중성화 상태에 맞지 않는 질문은 절대 만들지 말 것\n\n${patientBlock}[이전 차트 내용]\n---\n${chartContent}\n---\n\n반드시 JSON 배열만 출력해. 설명이나 다른 텍스트는 절대 포함하지 마.`;

  const callGemini = async (promptText: string, temperature: number): Promise<string> => {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            maxOutputTokens: 4096,
            temperature,
            responseMimeType: 'application/json',
          },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new AiQuestionError(
        'api_http_error',
        `Gemini API error ${res.status}`,
        (err || '').slice(0, 400)
      );
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  };

  let rawText = await callGemini(AI_PROMPT + '\n\n' + userMessage, 0.3);
  if (!rawText) {
    throw new AiQuestionError('empty_response', 'Gemini returned empty response');
  }

  const tryParseArray = (text: string): Array<{ text: string; type: string; options: unknown }> => {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new AiQuestionError('json_not_found', 'Failed to find JSON array in AI response', text.slice(0, 400));
    }
    try {
      return JSON.parse(jsonMatch[0]) as Array<{ text: string; type: string; options: unknown }>;
    } catch (e) {
      throw new AiQuestionError(
        'json_parse_error',
        e instanceof Error ? e.message : 'JSON parse error',
        jsonMatch[0].slice(0, 400)
      );
    }
  };

  let parsed: Array<{ text: string; type: string; options: unknown }> = [];
  try {
    parsed = tryParseArray(rawText);
  } catch (e) {
    if (!(e instanceof AiQuestionError) || e.reason !== 'json_parse_error') throw e;
    // One repair retry: ask model to re-emit strict JSON only.
    const repairPrompt = `다음 텍스트를 의미를 유지한 채 엄격한 JSON 배열로만 다시 출력해줘.
요구사항:
- 반드시 JSON 배열만 출력
- 코드펜스/설명문 금지
- 각 항목은 { "text": string, "type": "single_choice"|"multi_choice"|"scale", "options": object }

[원본 텍스트]
${rawText}`;
    rawText = await callGemini(repairPrompt, 0.1);
    if (!rawText) throw new AiQuestionError('empty_response', 'Gemini repair returned empty response');
    parsed = tryParseArray(rawText);
  }

  if (!Array.isArray(parsed)) {
    throw new AiQuestionError('json_parse_error', 'AI response JSON is not an array');
  }
  const validTypes = ['single_choice', 'multi_choice', 'scale'];
  const generatedTypes = parsed
    .map((q) => (q && typeof q.type === 'string' ? q.type : 'unknown'))
    .slice(0, 20)
    .join(', ');
  const filtered = parsed.filter((q) => q?.text && validTypes.includes(q.type)).slice(0, 8);
  if (parsed.length > 0 && filtered.length === 0) {
    throw new AiQuestionError(
      'invalid_question_types',
      'AI generated questions, but none matched allowed types',
      `types: ${generatedTypes}`
    );
  }
  if (filtered.length === 0) {
    throw new AiQuestionError('no_questions_after_filter', 'No usable questions generated');
  }
  const normalized = filtered.map((q) => {
    if (q.type !== 'scale') return q;
    const rawOptions = q.options && typeof q.options === 'object' ? (q.options as Record<string, unknown>) : {};
    return {
      ...q,
      options: {
        ...rawOptions,
        min: 1,
        max: 10,
      },
    };
  });
  return normalized;
}
