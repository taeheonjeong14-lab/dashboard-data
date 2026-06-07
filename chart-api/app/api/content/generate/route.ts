import { NextRequest, NextResponse } from 'next/server';
import { chartAppAuthMiddleware } from '@/lib/chart-app/auth';
import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';
import {
  getGeneratedByType,
  getHealthCheckupGeneratedContentForRun,
  upsertGeneratedRunContent,
} from '@/lib/chart-app/generated-content';
import {
  generateHealthCheckupContent,
  generateHealthCheckupSection,
  isRegenerateSection,
  HEALTH_CHECKUP_COVER_STORAGE_KEYS,
  parseHealthCheckupPayloadFromStorage,
  type HealthCheckupGeneratedContent,
} from '@/lib/chart-app/health-checkup-content-llm';
import { validateHealthCheckupGeneratedContent } from '@/lib/chart-app/health-checkup-content-schema';
import {
  applyImagePlacementForSection,
  runImagePlacementForRun,
} from '@/lib/chart-app/health-report-image-placement-run';
import { isParseRunUuid } from '@/lib/chart-app/uuid';
import { getChartPgPool } from '@/lib/db';
import { applyHealthCheckupCoverFromSource } from '@/lib/chart-app/health-checkup-cover-from-source';
import { loadReportSourceData } from '@/lib/chart-app/report-source';

const HEALTH_CHECKUP = 'health_checkup';
const BLOG_POST = 'blog_post';
const BLOG_CAUSAL = 'blog_causal';
const BLOG_OUTLINE = 'blog_outline';

// 진료케이스 케이스 개요(hospital-ui blog_case) 라벨
const OVERVIEW_LABELS: { key: string; label: string }[] = [
  { key: 'final_diagnosis', label: '최종 진단명' },
  { key: 'visit_background', label: '내원 배경' },
  { key: 'patient_notes', label: '환자 특이사항' },
  { key: 'diagnosis_method', label: '진단 방식' },
  { key: 'treatment_process', label: '치료 과정' },
  { key: 'aftercare_plan', label: '사후 관리 계획' },
  { key: 'emphasis', label: '강조 희망 사항' },
];

// ── 진료케이스 블로그 3단계 systemInstruction (docs/case-blog 기준) ──────────
const SYS_CAUSAL = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 진료 사례 블로그 글 작성의 [1단계 — 인과 흐름 재구성]입니다.
섹션 배치 전에, 무슨 일이 왜 그 순서로 일어났는지 임상 인과를 복원합니다.

# 반드시 지킬 것
- 제공된 입력(CHART_SOURCE, CASE_OVERVIEW)에 있는 내용만 사용한다.
  (처치를 잇는 "왜"의 일반 임상 원리 설명은 예외로 허용. 환자 고유 사실—
   증상·수치·결과—은 입력에 있을 때만 쓴다.)
- "고려됨"으로만 적힌 검사·처치는 시행한 것으로 쓰지 않는다.
- 약어는 약어사전으로 해석하고, 모르는 약어는 추측 말고 생략한다.
- 반드시 한국어로 작성한다. (코드/JSON 키는 영어 유지)

# 흐름의 축
- CASE_OVERVIEW의 최종 진단명·강조 희망사항을 흐름의 축으로 삼는다.
  (같은 차트라도 강조점에 따라 흐름의 중심이 달라진다)

# 인과 재구성 규칙
1. 날짜를 임상 단계로 묶고 각 단계에 이름을 붙인다.
   연속된 같은 문제의 진료는 하나의 단계로 묶는다.
2. 단계 사이를 "왜 다음 단계로 넘어갔는지"로 잇는다.
3. 한 단계 안에 처치가 여럿이면, 앞 처치가 다음 처치를 부른 이유로 엮는다.
4. 처치를 잇는 "왜"는 차트에 없어도 일반 임상 원리로 채운다.
5. 반복 복사된 항목(사료/유치교체 등)은 변화 없으면 제외한다.

# 치료 성격 구분
- 각 단계가 수술/처치형(surgical), 내과 치료형(medical), 검사형(diagnostic)인지 판단.
- 내과(medical) 단계는 "시점별 상태 변화"를 핵심으로.
  · 시점은 차트 날짜 간격을 계산하되 뭉뚱그려 표현(약 2주 후 / 약 한 달 후).
  · 상태 변화는 차트에 수치 있으면 수치로(OO→OO), 없으면 정성적으로.

# 마취 동반 판단
- 전신마취 동반 처치가 있으면 anesthesia=true.
- 마취 동반 시, 마취 전 안전성 평가를 독립된 비중 있는 단계로 잡는다.
  (검진과 술전검사가 겹친 경우, 새 검사를 지어내지 말고 이미 한 검사의
   '마취 전 평가 의미'를 해석해 반영)

# 서술 형식
- what·why·toNext 는 각각 1~3개의 짧은 불릿(문자열 배열)로 작성한다.
  한 불릿은 한 가지 사실/이유만 담는 짧은 구/문장. (toNext 는 마지막 단계면 빈 배열)

# 출력 형식 — JSON only (다른 텍스트·마크다운 코드펜스 없이 JSON만)
{
  "axis": "이 케이스 흐름의 축 한 줄 요약",
  "anesthesia": true 또는 false,
  "phases": [
    {
      "id": "phase_1",
      "name": "단계명",
      "period": "경과 시점 (러프)",
      "type": "surgical | medical | diagnostic",
      "what": ["무슨 일이 있었나 (차트 근거) — 불릿1", "불릿2"],
      "why": ["왜 이 처치/판단으로 이어졌나 (임상 원리) — 불릿1", "불릿2"],
      "toNext": ["다음 단계로 넘어간 계기 — 불릿 (마지막 단계는 빈 배열 [])"]
    }
  ]
}

# 약어사전
CC=주호소, Rx=처방, CE=진료/코멘트, OU=양쪽 눈, AD=오른쪽 귀,
bid=하루2회, sid=하루1회, tid=하루3회, cast Sx=중성화수술,
aus NRF=청진 특이소견 없음, no vdsc=구토/설사/기침 등 없음`;

const SYS_OUTLINE = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 [2단계 — 섹션 아웃라인 배치]입니다.
1단계에서 재구성·검수된 인과 흐름(CAUSAL_FLOW)을 받아,
정해진 섹션 구조에 배치합니다.

# 입력 우선순위
- CAUSAL_FLOW(JSON): ★ 흐름과 순서의 기준. phases 순서·인과를 따른다.
- CASE_OVERVIEW: 반드시 모두 반영할 내용.
- CHART_SOURCE: 디테일(수치·검사명) 보강용으로만. 흐름을 바꾸지 말 것.
  CAUSAL_FLOW가 뺀 곁가지를 차트에 있다는 이유로 다시 넣지 말 것.

# 반드시 지킬 것
- 없는 사실 창작 금지. CAUSAL_FLOW와 CASE_OVERVIEW 내용 위주로.
- CAUSAL_FLOW의 인과 순서를 무너뜨리지 말 것.
- CASE_OVERVIEW의 모든 항목을 어느 섹션엔가 반드시 반영.
- 한국어. (JSON 키는 영어)

# 섹션 구조 (기본 8개, label로 표기)
인트로 / 질환 소개 / 내원 배경 / 진단 과정 / 치료 과정 /
사후 관리방안 / 원장님 한마디 / 아웃트로

# 치료 과정 유연 분할
- CAUSAL_FLOW의 치료 단계가 많거나 국면이 뚜렷이 다르면 '치료 과정'을
  여러 섹션으로 (label: "치료 과정 ①", "치료 과정 ②"). 최대 3개.
- 국면 전환 시에만 나눔. 세부 행위(채혈·절개·봉합)로는 나누지 않음.

# 배치 규칙
- 각 섹션은 points(요점)와 facts(팩트)로 나눈다. 각각 불릿 배열.
  · points: 무엇을 어떤 방향으로 다룰지 (서술 방향)
  · facts: 글에 반드시 들어갈 구체 데이터
- facts 두 종류 구분:
  ① 검사·진단 → 구체적으로. 검사 수치(예: SDMA 11), 검사명(예: 복부 초음파),
     진단명, 경과 시점.
  ② 처치·약물·수술 술기 → 일반어로. 약물명·성분·도구·규격은 쓰지 않음.
     (단 처치의 "흐름과 이유"는 살린다)
- 수치 단위는 차트에 명시된 것만. 없으면 단위 없이 수치만. (VHS 등 무단위 지표는 단위 없음)
- 질환 소개 섹션에 한해 일반 의학정보 작성 허용(일반 원리만, 환자 사실 창작 금지).

# 마취 안전성 (CAUSAL_FLOW의 anesthesia=true면)
- 진단 과정에 '마취 전 안전성 평가'를 비중 있게 배치.
- 이상 수치 + 정상·양호 수치도 facts에 포함. 단 정상 수치는 선별:
  1. 환자 위험요인(나이·기존질환)과 연결되는 항목
  2. 마취와 직접 관련된 항목(간·신장 등)
  3. 주의 수치와 대비되는 항목
  무관한 정상 수치는 넣지 않음. 차트에 실제 있는 항목만.

# 출력 형식 — JSON only
{
  "title_candidates": ["제목 후보 1", "제목 후보 2"],
  "sections": [
    {
      "id": "sec_1",
      "label": "섹션명 (예: 내원 배경)",
      "points": ["요점1", "요점2"],
      "facts": ["팩트1", "팩트2"]
    }
  ],
  "overviewCheck": [
    { "item": "CASE_OVERVIEW 항목", "reflectedIn": "sec_3" }
  ]
}`;

const SYS_BLOGPOST = `당신은 동물병원을 운영하는 수의사이자 병원 원장입니다.
지금은 [3단계 — 블로그 글 작성]입니다.
2단계에서 완성·검수된 아웃라인(OUTLINE)을 받아 네이버 블로그 글로 완성합니다.

# 화자와 톤
- 화자: 병원이 환자의 사례를 소개하는 1인칭. 환자 이름은 병원정보의 환자명을 사용.
  예: "저희 OO동물병원에서 치료받았던 OO이의 사례를 소개합니다."
- 톤: 정보를 전달하고 설명하는 느낌. 친근하되 전문성 유지.
  이야기를 풀어놓기보다 질환과 진료 과정을 차분히 설명하는 무게로.
- <좋은예시>가 있으면 그 톤을 최우선으로 따른다.

# 글쓰기 규칙
- OUTLINE의 points는 서술 방향이다. 자연스러운 문장으로 풀어쓴다.
- OUTLINE의 facts는 누락·변경 없이 모두 반영하되 보호자가 이해할 말로 푼다.
  · 검사 수치·검사명은 구체적으로 살리되 쉬운 해석을 곁들인다.
    (예: "SDMA 11" → "신장 수치(SDMA)는 11로 정상 범위였습니다")
  · 처치·약물·도구 전문 명칭은 일반어로(아웃라인이 이미 일반어면 그대로).
- 섹션 사이를 앞이 다음을 부르는 흐름으로 잇는다.

# 수치·시간 표현
- 수치엔 단위를 붙이되 차트에 명시된 단위만. 없으면 단위 없이 수치만.
  (VHS처럼 본래 단위 없는 지표는 단위 없음)
- 나이·기간·횟수 등은 단위 표기(15세, 약 2주, 1일 2회).
- 내과 치료는 시간에 따른 호전을 보여준다. 정확한 날짜 대신 경과 표현
  (약 2주 후/약 한 달 후), 변화는 가능하면 수치로.

# 마취 안전성 (해당 시)
- 마취 전 검사를 꼼꼼히 했음을 강조. 이상 수치 + 양호 수치 모두 의미와 함께.
  · 양호: "OO 수치가 정상 범위로 확인되어 마취에 무리가 없다고 판단했습니다"
  · 주의: "OO 수치가 높아, 마취 시 면밀한 모니터링이 필요하다고 판단했습니다"

# 네이버 검색 노출 (2026)
- 키워드 부자연스러운 반복 금지(저품질 분류됨). 자연스럽게 녹인다.
- 이 글 하나로 보호자 궁금증이 해소되게 (증상→원인→진단→치료→관리→예방).
- 애매한 표현보다 구체적 사실·수치로 신뢰를.
- 제목은 검색할 표현 + 궁금증을 끄는 형태.

# 형식
- 섹션 제목은 "아웃라인 섹션명: 내용 제목" 형식.
  (예: "내원 배경: 증상이 없어도 안심할 수 없는 이유")
- 줄글로 작성. 불릿·번호 목록 금지. 나열 항목도 짧은 문단으로.
- 사진 위치는 [사진: 설명]으로 표시.
- 공백 포함 2,000~3,000자.

# 반드시 지킬 것
- 없는 사실 창작 금지. OUTLINE·CASE_OVERVIEW·병원정보에 있는 것만.
- "100% 완치·최고·유일" 등 과장·단정 금지, 치료 결과 보장 금지.
- 확정적 진단·처방 단정 금지("정확한 진단은 진료를 통해").
- 한국어. (JSON 키는 영어)

# 출력 형식 — JSON only
{
  "title": "최종 제목",
  "excerpt": "요약 (미리보기용 1~2문장)",
  "bodyMarkdown": "## 섹션명: 소제목\\n\\n본문...\\n\\n[사진: 설명]\\n\\n...",
  "tags": ["키워드1", "키워드2"],
  "charCount": 글자수
}`;

type GenerateDebugInfo = {
  enabled: boolean;
  parser: {
    rawLength: number;
    repaired: boolean;
    repairRawLength?: number;
    parseError?: string;
    repairError?: string;
  };
  model: {
    maxOutputTokens: number;
  };
};

function isDebugEnabled(body: Record<string, unknown>): boolean {
  const reqDebug = body.debug;
  if (typeof reqDebug === 'boolean') return reqDebug;
  const envDebug = (process.env.CHART_APP_DEBUG_CONTENT_GENERATE ?? '').trim().toLowerCase();
  return envDebug === '1' || envDebug === 'true';
}

async function parseJsonWithRepair(raw: string, schemaHint: string): Promise<{ parsed: unknown; debug: GenerateDebugInfo['parser'] }> {
  const parserDebug: GenerateDebugInfo['parser'] = {
    rawLength: raw.length,
    repaired: false,
  };
  try {
    return { parsed: tryParseJsonObject(raw), debug: parserDebug };
  } catch (firstErr) {
    parserDebug.parseError = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const repairPrompt = [
      'You are a JSON repair tool.',
      'Fix the following malformed JSON and return JSON only.',
      `Required shape hint: ${schemaHint}`,
      'Rules:',
      '- Keep original meaning.',
      '- Do not add markdown fences or commentary.',
      '- Ensure valid JSON parseable by JSON.parse.',
      '',
      'Malformed JSON:',
      raw.slice(0, 120_000),
    ].join('\n');
    const repaired = await geminiGenerateText(repairPrompt, { maxOutputTokens: 8192 });
    parserDebug.repaired = true;
    parserDebug.repairRawLength = repaired.length;
    try {
      return { parsed: tryParseJsonObject(repaired), debug: parserDebug };
    } catch (repairErr) {
      parserDebug.repairError = repairErr instanceof Error ? repairErr.message : String(repairErr);
      throw repairErr;
    }
  }
}

// POST /api/content/generate — contentType 분기
export async function POST(request: NextRequest) {
  const authErr = chartAppAuthMiddleware(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const runId = String(body.runId ?? '').trim();
  const contentType = String(body.contentType ?? '').trim();
  const debugEnabled = isDebugEnabled(body);
  const maxOutputTokens = 8192;
  if (!isParseRunUuid(runId)) return NextResponse.json({ error: 'runId invalid' }, { status: 400 });

  const pool = getChartPgPool();
  const runOk = await pool.query(`SELECT 1 FROM chart_pdf.parse_runs WHERE id = $1::uuid`, [runId]);
  if (runOk.rows.length === 0) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  try {
    const source = await loadReportSourceData(runId);

    if (contentType === HEALTH_CHECKUP) {
      const sectionRaw = typeof body.section === 'string' ? body.section.trim() : '';
      if (sectionRaw) {
        if (!isRegenerateSection(sectionRaw)) {
          return NextResponse.json({ error: `invalid section: ${sectionRaw}` }, { status: 400 });
        }
        try {
          const checkupDate = typeof body.checkupDate === 'string' ? body.checkupDate.trim() : '';
          const must = typeof body.mustInclude === 'string' ? body.mustInclude.trim().slice(0, 1000) : '';
          const prior = await getHealthCheckupGeneratedContentForRun(pool, runId);
          const priorPayload = parseHealthCheckupPayloadFromStorage(prior?.payload ?? {});
          const coverProgramFromBody = typeof body.coverProgram === 'string' ? body.coverProgram.trim() : '';
          const reportProgramForPrompt =
            coverProgramFromBody ||
            (typeof priorPayload.coverProgram === 'string' ? priorPayload.coverProgram.trim() : '') ||
            '';
          const partial = await generateHealthCheckupSection(sectionRaw, source, {
            reportProgramName: reportProgramForPrompt || undefined,
            checkupDate: checkupDate || undefined,
            mustInclude: must || undefined,
          });

          // 이미지 페이지(치과·피부 / 방사선·초음파)는 텍스트만 재생성하면 이미지 슬롯이 빈
          // 데모 블록으로 덮인다. 현재 run 의 케이스 이미지(나중에 추가된 것 포함)를 다시 배치한다.
          if (sectionRaw === 'systems4' || sectionRaw === 'systems5') {
            const blocksKey = sectionRaw === 'systems4' ? 'systemsPage4Blocks' : 'systemsPage5Blocks';
            const partialRecord = partial as Record<string, unknown>;
            try {
              partialRecord[blocksKey] = await applyImagePlacementForSection(
                pool,
                runId,
                sectionRaw,
                partialRecord[blocksKey],
              );
            } catch (placementErr) {
              console.error('[content/generate] section image placement failed (non-blocking):', placementErr);
            }
          }

          return NextResponse.json({ runId, contentType, section: sectionRaw, generated: partial, saved: false });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('GEMINI_API_KEY')) {
            return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
          }
          console.error('[content/generate] section regen error:', e);
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }

      try {
        const prior = await getHealthCheckupGeneratedContentForRun(pool, runId);
        const priorPayload = parseHealthCheckupPayloadFromStorage(prior?.payload ?? {});
        const coverProgramFromBody =
          typeof body.coverProgram === 'string' ? body.coverProgram.trim() : '';
        const reportProgramForPrompt =
          coverProgramFromBody || (typeof priorPayload.coverProgram === 'string' ? priorPayload.coverProgram.trim() : '') || '';
        const checkupDate = typeof body.checkupDate === 'string' ? body.checkupDate.trim() : '';
        const veterinarian = typeof body.veterinarian === 'string' ? body.veterinarian.trim() : '';
        const must =
          typeof body.mustInclude === 'string' ? body.mustInclude.trim().slice(0, 1000) : '';
        const generated = await generateHealthCheckupContent(source, {
          reportProgramName: reportProgramForPrompt || undefined,
          checkupDate: checkupDate || undefined,
          veterinarian: veterinarian || undefined,
          mustInclude: must || undefined,
        });

        /** 표지 merge 순서(vet-report POST /api/content/generate 와 동일 개념): generated → 이전 저장(키별 undefined 아닌 값만) → 요청 checkupDate/veterinarian 덮어쓰기 → 요청 coverProgram 비어 있지 않으면 표지 프로그램 덮어쓰기 → applyHealthCheckupCoverFromSource 로 DB 기본값은 null/undefined 만 채움. */
        const coverPreserve: Partial<HealthCheckupGeneratedContent> = {};
        for (const key of HEALTH_CHECKUP_COVER_STORAGE_KEYS) {
          const v = priorPayload[key];
          if (v !== undefined) coverPreserve[key] = v;
        }

        const merged: HealthCheckupGeneratedContent = {
          ...generated,
          ...coverPreserve,
          ...(checkupDate ? { coverCheckupDate: checkupDate } : {}),
          ...(veterinarian ? { coverVeterinarian: veterinarian } : {}),
        };
        if (coverProgramFromBody) merged.coverProgram = coverProgramFromBody;

        const withSourceCover = applyHealthCheckupCoverFromSource(merged, source);
        const payload = parseHealthCheckupPayloadFromStorage(withSourceCover);
        const validated = validateHealthCheckupGeneratedContent(payload, { runId });
        if (!validated.ok) {
          console.warn('[POST /api/content/generate] validation failed', {
            runId,
            error: validated.error,
            coverSnapshot: HEALTH_CHECKUP_COVER_STORAGE_KEYS.map((k) => [
              k,
              typeof (payload as Record<string, unknown>)[k],
            ]),
          });
          return NextResponse.json({ error: validated.error }, { status: 422 });
        }
        try {
          await runImagePlacementForRun(pool, runId, validated.value);
        } catch (placementErr) {
          console.error('[content/generate] image placement failed (non-blocking):', placementErr);
        }

        const parserDebug: GenerateDebugInfo['parser'] = {
          rawLength: JSON.stringify(source).length,
          repaired: false,
        };
        const saved = await upsertGeneratedRunContent(pool, runId, HEALTH_CHECKUP, validated.value);
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? {
              enabled: true,
              parser: parserDebug,
              model: { maxOutputTokens },
            }
          : undefined;
        return NextResponse.json({
          runId,
          contentType,
          generated: validated.value,
          source,
          resultCode: 'OK',
          saved,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // ── 진료케이스 블로그 3단계 (docs/case-blog) ─────────────────────────────
    // 케이스 개요(hospital-ui blog_case) 로드 — 전체 항목(빈 값 포함) + 프롬프트용 텍스트.
    const loadCaseOverviewForRun = async () => {
      const blogCase = await getGeneratedByType(pool, runId, 'blog_case');
      const rawOverview =
        (blogCase?.payload as { overview?: Record<string, unknown> } | null)?.overview ?? {};
      const caseOverview = OVERVIEW_LABELS.map(({ key, label }) => ({
        label,
        value: String((rawOverview as Record<string, unknown>)[key] ?? '').trim(),
      }));
      const filled = caseOverview.filter((x) => x.value);
      const caseOverviewText = filled.length
        ? filled.map((x) => `- ${x.label}: ${x.value}`).join('\n')
        : '(작성된 케이스 개요 없음)';
      return { caseOverview, caseOverviewText };
    };

    // 1단계 — 인과 흐름(causalFlow). thinking 켬, maxOutputTokens 넉넉히. 저장 안 함(모달에서 검수).
    if (contentType === BLOG_CAUSAL) {
      try {
        const { caseOverview, caseOverviewText } = await loadCaseOverviewForRun();
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const userContent = [
          'CASE_OVERVIEW:',
          caseOverviewText,
          '',
          'CHART_SOURCE:',
          sourceText,
          '',
          '---',
          '위 자료로 인과 흐름을 재구성하여, 지정된 JSON 형식으로만 출력하세요.',
        ].join('\n');
        const stageMaxTokens = 16384;
        const raw = await geminiGenerateText(userContent, {
          systemInstruction: SYS_CAUSAL,
          thinkingBudget: 4096,
          maxOutputTokens: stageMaxTokens,
        });
        const { parsed: causalFlow, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: axis (string), anesthesia (boolean), phases (array of {id,name,period,type, what:string[], why:string[], toNext:string[]})',
        );
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
        return NextResponse.json({
          runId,
          contentType,
          generated: { causalFlow, caseOverview },
          payload: { causalFlow, caseOverview },
          saved: false,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // 2단계 — 섹션 아웃라인(outline). 입력=검수된 causalFlow. thinking 0. 저장 안 함.
    if (contentType === BLOG_OUTLINE) {
      try {
        const causalFlowJson = body.causalFlow != null ? JSON.stringify(body.causalFlow).slice(0, 40_000) : '';
        if (!causalFlowJson) {
          return NextResponse.json({ error: 'causalFlow is required for blog_outline' }, { status: 400 });
        }
        const { caseOverview, caseOverviewText } = await loadCaseOverviewForRun();
        const sourceText = JSON.stringify(source).slice(0, 120_000);
        const userContent = [
          'CAUSAL_FLOW (1단계 검수 결과):',
          causalFlowJson,
          '',
          'CASE_OVERVIEW:',
          caseOverviewText,
          '',
          'CHART_SOURCE:',
          sourceText,
          '',
          '---',
          '위 인과 흐름을 섹션 아웃라인으로 배치하여, 지정된 JSON 형식으로만 출력하세요.',
          '마지막에 overviewCheck로 CASE_OVERVIEW 누락 여부를 점검하세요.',
        ].join('\n');
        const stageMaxTokens = 8192;
        const raw = await geminiGenerateText(userContent, {
          systemInstruction: SYS_OUTLINE,
          thinkingBudget: 0,
          maxOutputTokens: stageMaxTokens,
        });
        const { parsed: outline, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: title_candidates (string[]), sections (array of {id,label,points,facts}), overviewCheck (array)',
        );
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
        return NextResponse.json({
          runId,
          contentType,
          generated: { outline, caseOverview },
          payload: { outline, caseOverview },
          saved: false,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    // 3단계 — 블로그 글(blogPost). 입력=검수된 outline + 병원명/환자명 + 좋은예시(선택). thinking 0. 저장.
    if (contentType === BLOG_POST) {
      try {
        const outlineJson = body.outline != null ? JSON.stringify(body.outline).slice(0, 60_000) : '';
        if (!outlineJson) {
          return NextResponse.json({ error: 'outline is required for blog_post' }, { status: 400 });
        }
        const { caseOverview, caseOverviewText } = await loadCaseOverviewForRun();
        const goodExample = typeof body.goodExample === 'string' ? body.goodExample.trim().slice(0, 20_000) : '';
        const hospitalName = (source.basicInfo?.hospitalName ?? '').trim();
        const patientName = (source.basicInfo?.patientName ?? '').trim();
        const userContent = [
          `병원정보: 병원명 ${hospitalName || '(미상)'} / 환자명 ${patientName || '(미상)'}`,
          '',
          'OUTLINE (2단계 검수 결과):',
          outlineJson,
          '',
          'CASE_OVERVIEW:',
          caseOverviewText,
          goodExample ? `\n<좋은예시>\n${goodExample}\n</좋은예시>` : '',
          '',
          '---',
          '위 아웃라인으로 블로그 글을 완성하여, 지정된 JSON 형식으로만 출력하세요.',
        ].join('\n');
        const stageMaxTokens = 12288;
        const raw = await geminiGenerateText(userContent, {
          systemInstruction: SYS_BLOGPOST,
          thinkingBudget: 0,
          maxOutputTokens: stageMaxTokens,
        });
        const { parsed: generated, debug: parserDebug } = await parseJsonWithRepair(
          raw,
          'object with keys: title (string), excerpt (string), bodyMarkdown (string), tags (string[]), charCount (number)',
        );
        const saved = await upsertGeneratedRunContent(pool, runId, BLOG_POST, generated);
        const debug: GenerateDebugInfo | undefined = debugEnabled
          ? { enabled: true, parser: parserDebug, model: { maxOutputTokens: stageMaxTokens } }
          : undefined;
        return NextResponse.json({
          runId,
          contentType,
          generated,
          payload: generated,
          caseOverview,
          saved,
          ...(debug ? { debug } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('GEMINI_API_KEY')) {
          return NextResponse.json({ error: 'LLM not configured (GEMINI_API_KEY)' }, { status: 503 });
        }
        throw e;
      }
    }

    return NextResponse.json({ error: `unsupported contentType: ${contentType}` }, { status: 400 });
  } catch (e) {
    console.error('POST /api/content/generate:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
