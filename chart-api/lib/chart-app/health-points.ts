/**
 * 검진 포인트 — 건강검진 리포트 생성의 1단계.
 *
 * 리포트 본문을 쓰기 전에, 차트·검사결과·이미지에서 "리포트에 언급할 이상/특기 소견"만 뽑아
 * 포인트(불릿) 목록으로 만든다. 포인트마다 근거(어디서 나왔는지)와 배치(어느 섹션에 들어갈지)를 붙인다.
 * admin 이 이 목록을 검토·수정한 뒤 확정하면, 확정본이 리포트 생성 프롬프트의 최상위 입력이 된다.
 *
 * 왜: 지금까지는 리포트 문장만 남아 "이게 차트에 적힌 사실인지, AI 가 이미지를 보고 판단한 것인지"
 * 검토자가 알 수 없었다. 근거를 먼저 확정하고 그걸로 글을 쓰게 하면 검토가 사실 단위에서 일어나고,
 * 섹션 배치가 미리 정해져 "초음파에서 확인했다면서 초음파 섹션엔 그 내용이 없는" 정합성 붕괴도 막는다.
 */
import { geminiGenerateText, tryParseJsonObject } from '@/lib/chart-app/gemini';
import type { UsageContext } from '@/lib/billing/usage-log';
import type { ReportSourceData } from '@/lib/chart-app/report-types';
import { buildHealthCheckupSourceBlock } from '@/lib/chart-app/health-checkup-content-llm';
import { HEALTH_CHECKUP_ORGAN_ORDER, HEALTH_CHECKUP_ORGAN_SPECS } from '@/lib/chart-app/health-checkup-prompt-instructions';

/** 포인트의 근거 유형. */
export type HealthPointBasis = 'chart' | 'lab' | 'image';

/** 검사 섹션 키 — 리포트의 섹션 재생성 키와 같다(lab=혈액검사 해석, systems4=치과·피부, systems5=방사선·초음파). */
export const HEALTH_POINT_EXAM_SECTIONS = ['lab', 'systems4', 'systems5'] as const;
export type HealthPointExamSection = (typeof HEALTH_POINT_EXAM_SECTIONS)[number];

export interface HealthPoint {
  id: string;
  /** 한 줄 서술 — 종합 소견에 쓸 만한 굵기. */
  text: string;
  basis: HealthPointBasis;
  /** 근거 원문: chart=차트 인용, lab=항목=값(참고범위), image=파일명/검사명 + 판독 소견. */
  evidence: string;
  /** 들어갈 장기 섹션 키(circ·digest·endo·renal_uro·hepatobiliary·msk·dental·skin). 없을 수 있음. */
  organs: string[];
  /** 검사 섹션에도 들어간다면 어디. */
  examSections: HealthPointExamSection[];
  /** 종합 소견에 올릴 포인트인지. */
  inOverall: boolean;
}

export interface HealthPointsPayload {
  points: HealthPoint[];
  /** 확정 여부 — admin 이 검토를 마쳤는지. 확정 전에는 본문 생성을 막는다. */
  confirmed?: boolean;
}

const BASIS_SET = new Set<HealthPointBasis>(['chart', 'lab', 'image']);
const ORGAN_SET = new Set<string>(HEALTH_CHECKUP_ORGAN_ORDER);
const EXAM_SET = new Set<string>(HEALTH_POINT_EXAM_SECTIONS);

const BASIS_LABEL: Record<HealthPointBasis, string> = {
  chart: '차트 본문',
  lab: '검사결과',
  image: '이미지 판독(AI)',
};

export function healthPointBasisLabel(b: HealthPointBasis): string {
  return BASIS_LABEL[b] ?? b;
}

/** LLM 출력/DB 저장분을 안전한 형태로 정규화. 알 수 없는 키·섹션은 버린다. */
export function normalizeHealthPoints(raw: unknown): HealthPoint[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { points?: unknown } | null)?.points)
      ? ((raw as { points: unknown[] }).points)
      : [];
  const out: HealthPoint[] = [];
  arr.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const o = p as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    if (!text) return;
    const basisRaw = typeof o.basis === 'string' ? o.basis.trim() : '';
    const basis = (BASIS_SET.has(basisRaw as HealthPointBasis) ? basisRaw : 'chart') as HealthPointBasis;
    const organs = Array.isArray(o.organs)
      ? [...new Set(o.organs.map((x) => String(x ?? '').trim()).filter((x) => ORGAN_SET.has(x)))]
      : [];
    const examSections = Array.isArray(o.examSections)
      ? ([...new Set(o.examSections.map((x) => String(x ?? '').trim()).filter((x) => EXAM_SET.has(x)))] as HealthPointExamSection[])
      : [];
    out.push({
      id: typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `p${i + 1}`,
      text,
      basis,
      evidence: typeof o.evidence === 'string' ? o.evidence.trim() : '',
      organs,
      examSections,
      inOverall: o.inOverall !== false, // 기본 true — 포인트 자체가 종합 소견 굵기다
    });
  });
  return out;
}

export function parseHealthPointsPayload(raw: unknown): HealthPointsPayload {
  const o = (raw ?? {}) as Record<string, unknown>;
  return { points: normalizeHealthPoints(o.points ?? raw), confirmed: o.confirmed === true };
}

/**
 * 확정된 포인트를 리포트 생성 프롬프트에 넣는 블록.
 * section 을 주면 그 섹션에 배정된 포인트만(섹션 단위 재생성용). 없으면 전체.
 */
export function healthPointsPromptBlock(points: HealthPoint[], section?: string): string {
  if (!points.length) return '';
  const relevant = !section
    ? points
    : points.filter((p) => {
        if (section === 'overall' || section === 'followUp' || section === 'recheck') return p.inOverall || true;
        if (EXAM_SET.has(section)) return p.examSections.includes(section as HealthPointExamSection);
        // systems3 / systems3b — 장기 칸 섹션. 어떤 장기가 어느 페이지인지는 호출부가 organs 로 걸러 넘긴다.
        return true;
      });
  if (!relevant.length) return '';

  const lines = relevant.map((p) => {
    const organs = p.organs.map((k) => HEALTH_CHECKUP_ORGAN_SPECS[k]?.title ?? k).join(', ') || '해당 없음';
    const exams = p.examSections.join(', ') || '해당 없음';
    return [
      `- [${p.id}] ${p.text}`,
      `  · 근거(${BASIS_LABEL[p.basis]}): ${p.evidence || '(원문 없음)'}`,
      `  · 배치: 장기=${organs} / 검사 섹션=${exams}${p.inOverall ? ' / 종합 소견 포함' : ''}`,
    ].join('\n');
  });

  return [
    '========== 확정된 검진 포인트 (담당자 검토·확정 완료) ==========',
    '아래는 이번 검진에서 리포트에 반드시 다뤄야 할 소견 목록이다. 담당 수의사가 근거와 배치를 확인해 확정했다.',
    '',
    ...lines,
    '',
    '★ 이 포인트 목록에 대한 규칙 (다른 어떤 지시보다 우선):',
    '- 각 섹션은 그 섹션에 **배치된 포인트를 빠짐없이** 다룬다(장기 칸이면 organs, 검사 섹션이면 examSections 기준).',
    '- 포인트에 없는 **새로운 이상 소견·진단·수치를 만들어 쓰지 않는다.** 정상 소견 서술은 포인트가 없어도 무방하다.',
    '- 포인트의 근거를 벗어난 확대 해석을 하지 않는다. 근거가 "이미지 판독(AI)" 인 포인트는 관찰 소견으로만 서술한다(확정 진단 금지).',
  ].join('\n');
}

const SYS_HEALTH_POINTS = `당신은 반려동물 건강검진 리포트를 감수하는 수의사입니다.
차트 본문·검사 수치·이미지 판독 요약을 읽고, **이번 검진 리포트에서 언급할 소견**을 포인트(불릿) 목록으로 정리합니다.
아직 리포트 문장을 쓰는 단계가 아닙니다 — 무엇을 쓸지, 근거가 무엇인지, 어디에 넣을지만 정합니다.

# 무엇을 포인트로 뽑나
- **이상·특기 소견만.** 정상 소견은 포인트로 만들지 않는다(리포트 본문에서 따로 서술된다).
- 굵기는 "종합 소견에 한 줄로 쓸 만한 수준". 검사 수치 하나하나가 아니라, 의미 단위로 묶는다.
  (예: BUN·CREA·SDMA 동시 상승 → "신장 수치 상승, 초기 신장 기능 저하 의심" 하나로.)
- 보통 5~15개. 억지로 개수를 채우지 말 것.

# 포인트마다 반드시 채울 것
- text: 한 줄 서술(무엇이 확인되었고 무엇을 시사하는지). 수치가 있으면 괄호로 함께.
- basis: 근거 유형 하나.
  · chart — 차트 본문에 수의사가 적어 둔 내용(문진·신체검사·소견·진단·처치).
  · lab   — 검사 수치에서 나온 것(혈액·요검사 등).
  · image — 이미지 판독 요약에서 나온 것(방사선·초음파·치과·피부 등). **AI 가 본 것이므로 가장 검토가 필요한 유형.**
  근거가 섞이면, 그 소견을 성립시키는 **가장 직접적인** 근거 하나를 고른다.
- evidence: 실제 근거 원문. chart=차트 인용(원문 그대로 짧게), lab=항목=값(참고범위), image=검사명/파일 + 판독 문구.
  ★ 근거 없이 추측으로 만든 포인트는 절대 넣지 않는다.
- organs: 이 소견이 들어갈 장기 섹션 키 배열(0~2개).
- examSections: 검사 섹션에도 들어간다면 그 키 배열. lab=혈액검사 해석 / systems4=치과·피부 이미지 / systems5=방사선·초음파.
  (같은 소견이 장기 섹션과 검사 섹션 양쪽에 들어가는 것은 정상이다.)
- inOverall: 종합 소견에 올릴 만큼 중요하면 true.

# 출력 — JSON only
{
  "points": [
    {
      "id": "p1",
      "text": "…",
      "basis": "chart" | "lab" | "image",
      "evidence": "…",
      "organs": ["renal_uro"],
      "examSections": ["lab"],
      "inOverall": true
    }
  ]
}`;

/** 장기 키 목록을 프롬프트에 설명으로 렌더(어떤 키가 있는지 LLM 에 알려준다). */
function organKeyGuide(): string {
  return HEALTH_CHECKUP_ORGAN_ORDER.map((k) => `- ${k}: ${HEALTH_CHECKUP_ORGAN_SPECS[k]?.title ?? k}`).join('\n');
}

export async function generateHealthPoints(
  source: ReportSourceData,
  options?: { checkupDate?: string; mustInclude?: string; usageContext?: UsageContext },
): Promise<HealthPoint[]> {
  const mustInclude = options?.mustInclude?.trim() ?? '';
  const userContent = [
    '장기 섹션 키:',
    organKeyGuide(),
    '',
    '검사 섹션 키: lab(혈액검사 해석), systems4(치과·피부 이미지), systems5(방사선·초음파)',
    '',
    ...(mustInclude ? [`반드시 포함·강조해야 하는 내용(담당자 지시):\n${mustInclude}`, ''] : []),
    buildHealthCheckupSourceBlock(source, options?.checkupDate),
    '',
    '---',
    '위 데이터에서 이번 검진 리포트에 언급할 포인트를 정리해, 지정된 JSON 으로만 출력하세요.',
  ].join('\n');

  const raw = await geminiGenerateText(userContent, {
    systemInstruction: SYS_HEALTH_POINTS,
    thinkingBudget: 0,
    maxOutputTokens: 4096,
    usageContext: options?.usageContext,
  });
  const parsed = tryParseJsonObject(raw);
  const points = normalizeHealthPoints(parsed);
  if (!points.length) throw new Error('검진 포인트를 만들지 못했습니다. 다시 시도해 주세요.');
  return points;
}
