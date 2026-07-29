/**
 * 전사(Gemini/텍스트레이어) 줄에 OCR 행의 페이지 위치(page, y)를 되붙이는 인덱스.
 *
 * 왜 필요한가 — 전사는 "페이지에 보이는 글자"를 읽으므로, 차트에 삽입된 **사진 속 물체에
 * 인쇄된 글자**(요검사 스틱 봉투, 굴절계 눈금 등)까지 본문 줄로 뱉는다. 게다가 전사 순서는
 * 시각 순서와 어긋날 수 있어, 페이지 위쪽 사진의 글자가 아래쪽 Plan 표 헤더 뒤에 끼어든다.
 * 전사 줄 자체에는 좌표가 없지만 OCR 행에는 있으므로, 텍스트로 짝지어 위치를 복원한다.
 *
 * 짝이 없으면 null — 호출부는 "위치를 모르면 건드리지 않는다"(fail-open)로 쓴다.
 */

import type { OcrRow } from '@/lib/google-vision';

export type LinePosition = { page: number; y: number };

export type OcrPositionIndex = {
  /** 같은 텍스트가 여러 번 나오면 page 힌트에 맞는 것을 우선한다. 못 찾으면 null. */
  lookup(text: string, pageHint?: number): LinePosition | null;
  size: number;
};

/** 공백 차이만 있는 줄을 같은 키로 (전사와 OCR 은 띄어쓰기가 자주 다르다). */
function normalKey(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 공백을 아예 무시한 느슨한 키 — 전사가 토큰을 다르게 끊었을 때의 2차 시도. */
function looseKey(s: string): string {
  return (s ?? '').replace(/\s+/g, '').toLowerCase();
}

function pickPosition(candidates: LinePosition[], pageHint?: number): LinePosition | null {
  if (candidates.length === 0) return null;
  if (pageHint != null) {
    const onPage = candidates.filter((c) => c.page === pageHint);
    if (onPage.length > 0) return onPage[0]!;
  }
  return candidates[0]!;
}

export function buildOcrPositionIndex(rows: ReadonlyArray<OcrRow>): OcrPositionIndex {
  const exact = new Map<string, LinePosition[]>();
  const loose = new Map<string, LinePosition[]>();

  for (const row of rows) {
    const text = row?.text ?? '';
    if (!text.trim()) continue;
    // yMin 이 있으면 그것이 줄의 윗변. 없으면 대표 y 로 대신한다.
    const y = row.yMin ?? row.y;
    if (!Number.isFinite(y)) continue;
    const pos: LinePosition = { page: row.page, y };

    const k1 = normalKey(text);
    if (k1) {
      const list = exact.get(k1) ?? [];
      list.push(pos);
      exact.set(k1, list);
    }
    const k2 = looseKey(text);
    if (k2) {
      const list = loose.get(k2) ?? [];
      list.push(pos);
      loose.set(k2, list);
    }
  }

  return {
    size: exact.size,
    lookup(text: string, pageHint?: number): LinePosition | null {
      const k1 = normalKey(text);
      if (!k1) return null;
      const hit = pickPosition(exact.get(k1) ?? [], pageHint);
      if (hit) return hit;
      return pickPosition(loose.get(looseKey(text)) ?? [], pageHint);
    },
  };
}

/**
 * `p` 가 `anchor` 보다 페이지 위쪽인가. 같은 페이지면 y 로 비교하되, 같은 줄이 미세하게
 * 어긋나 걸리지 않도록 `yTolerance` 만큼 봐준다.
 */
export function isAbove(p: LinePosition, anchor: LinePosition, yTolerance = 4): boolean {
  if (p.page !== anchor.page) return p.page < anchor.page;
  return p.y < anchor.y - yTolerance;
}

/**
 * PlusVet Plan 구간에서 "표보다 페이지 위쪽에 있는 줄"을 걷어낸다.
 *
 * 전사는 페이지에 보이는 글자를 읽으므로 차트에 삽입된 **사진 속 인쇄 글자**(요검사 스틱 봉투,
 * 굴절계 눈금 등)까지 줄로 뱉는다. 게다가 전사 순서가 시각 순서와 어긋나, 페이지 위쪽 사진의
 * 글자가 맨 아래 Plan 헤더 뒤에 끼어드는 일이 있다. 그대로 두면 parsePlusVetPlanRows 가
 * 토큰 스트림으로 평탄화하면서 가짜 행을 만들고 **진짜 처방 행까지 두 동강** 낸다.
 *
 * Plan 표의 행은 반드시 헤더보다 아래(같은 페이지의 더 큰 y, 또는 다음 페이지)에 있다.
 * 위치를 못 찾은 줄은 건드리지 않는다(fail-open) — OCR 미동작이면 통째로 no-op.
 *
 * @param planLines Plan 구간 줄들. 0번이 `Plan`, 1번이 컬럼 헤더인 것이 보통.
 * @param planPages `planLines` 와 같은 길이의 페이지 번호 배열(동명 줄 구분용 힌트).
 */
export function dropPlanLinesAboveHeader(
  planLines: string[],
  planPages: number[],
  pos: OcrPositionIndex | null,
): { kept: string[]; dropped: string[] } {
  if (!pos || pos.size === 0 || planLines.length < 2) return { kept: planLines, dropped: [] };

  // 표의 윗변은 컬럼 헤더 줄. 그게 안 잡히면 `Plan` 줄로 대신한다.
  let anchor: LinePosition | null = null;
  for (let i = 0; i < Math.min(2, planLines.length); i += 1) {
    const p = pos.lookup(planLines[i] ?? '', planPages[i]);
    if (p) anchor = p; // 뒤쪽(컬럼 헤더)이 잡히면 그것을 우선
  }
  if (!anchor) return { kept: planLines, dropped: [] };

  const dropped: string[] = [];
  const kept = planLines.filter((line, i) => {
    if (i < 2) return true; // `Plan` + 컬럼 헤더는 그대로 둔다(파서가 알아서 건너뛴다)
    const p = pos.lookup(line, planPages[i]);
    if (!p || !isAbove(p, anchor)) return true;
    dropped.push(line);
    return false;
  });

  return { kept, dropped };
}
