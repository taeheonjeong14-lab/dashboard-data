import type pg from 'pg';

/** 긴 접미사부터 제거해 한 번에 하나씩만 잘라 나감 */
const HOSPITAL_SUFFIXES = ['동물메디컬센터', '동물의료센터', '동물병원'] as const;

const FALLBACK_SLUG = '병원명없음';

/**
 * 병원 표기용 슬러그: 동물병원/의료센터 등 접미사 제거 후 공백 제거.
 * friendly_id 구간 구분자(-)와 충돌하지 않도록 하이픈도 제거합니다.
 */
export function normalizeHospitalSlug(raw: string | null | undefined): string {
  let t = (raw ?? '').trim();
  if (!t) return FALLBACK_SLUG;

  let prev = '';
  while (prev !== t) {
    prev = t;
    for (const suf of HOSPITAL_SUFFIXES) {
      if (t.endsWith(suf)) {
        t = t.slice(0, -suf.length).trim();
        break;
      }
    }
  }

  t = t.replace(/\s+/g, '').replace(/-/g, '');
  return t.length > 0 ? t : FALLBACK_SLUG;
}

/** Asia/Seoul 달력 기준 yymmdd */
export function formatKstYymmdd(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  const yy = y.slice(-2);
  return `${yy}${m}${d}`;
}

/** instant이 속한 Asia/Seoul 날짜의 [start, end) UTC ISO 구간 */
export function kstDayUtcRangeContaining(instant: Date): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? 1);
  const d = Number(parts.find((p) => p.type === 'day')?.value ?? 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

type CohortRunRow = {
  id: string;
  created_at: string;
  hospital_id: string | null;
};

function compareRunOrder(a: CohortRunRow, b: CohortRunRow): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  return typeof err.message === 'string' && /duplicate key|unique constraint/i.test(err.message);
}

/**
 * 같은 병원(hospital_id) + 같은 KST 날짜 안에서 created_at·id 순으로 순번을 매겨 parse_runs.friendly_id를 설정합니다.
 * `hospitalSlug`는 hospitals.slug(ASCII)를 그대로 씁니다.
 */
export async function assignFriendlyIdToParseRun(
  client: pg.PoolClient,
  runId: string,
  createdAtIso: string,
  params: { hospitalId: string; hospitalSlug: string },
): Promise<string> {
  const slug = params.hospitalSlug.trim();
  if (!slug) {
    throw new Error('friendly_id: hospital slug is empty');
  }
  const created = new Date(createdAtIso);
  const yymmdd = formatKstYymmdd(created);
  const { start, end } = kstDayUtcRangeContaining(created);
  const runShort = runId.replace(/-/g, '').slice(0, 8);

  for (let attempt = 0; attempt < 8; attempt++) {
    const { rows } = await client.query<CohortRunRow>(
      `SELECT id, created_at, hospital_id
       FROM chart_pdf.parse_runs
       WHERE created_at >= $1 AND created_at < $2
         AND hospital_id = $3::uuid
       ORDER BY created_at ASC, id ASC`,
      [start, end, params.hospitalId],
    );

    const matches = [...rows].sort(compareRunOrder);

    const idx = matches.findIndex((r) => r.id === runId);
    if (idx < 0) {
      throw new Error('friendly_id: current run not found in KST-day cohort');
    }

    const seq = idx + 1;
    const seqStr = String(seq).padStart(2, '0');
    let friendlyId: string;
    if (attempt === 0) {
      friendlyId = `${slug}-${yymmdd}-${seqStr}`;
    } else if (attempt === 1) {
      friendlyId = `${slug}-${yymmdd}-${seqStr}-${runShort}`;
    } else {
      friendlyId = `${slug}-${yymmdd}-${seqStr}-${runShort}-${attempt}`;
    }

    try {
      await client.query(
        `UPDATE chart_pdf.parse_runs SET friendly_id = $1 WHERE id = $2::uuid`,
        [friendlyId, runId],
      );
      return friendlyId;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (!isUniqueViolation(err)) {
        throw new Error(`friendly_id update failed: ${err.message ?? String(e)}`);
      }
    }
  }

  throw new Error('friendly_id: unique constraint retries exhausted');
}
