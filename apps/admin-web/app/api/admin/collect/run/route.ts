import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

// 로컬 실행 전용 — collect-all.js / collect-all-batch.js 스폰 후 완료 대기
export const maxDuration = 300;

export type CollectStepResult = {
  index: number;
  total: number;
  name: string;
  durationSec: number;
};

export type CollectUpsertItem = {
  label: string;
  count: number;
};

export type CollectRunResult = {
  ok: boolean;
  output: string;
  steps: CollectStepResult[];
  upserts: CollectUpsertItem[];
};

function parseCollectOutput(output: string): {
  steps: CollectStepResult[];
  upserts: CollectUpsertItem[];
} {
  const steps: CollectStepResult[] = [];
  const upserts: CollectUpsertItem[] = [];

  // ✓ 1/4 완료 (12.3s) — 블로그 일별 지표 수집
  const stepRe = /✓\s+(\d+)\/(\d+)\s+완료\s+\(([0-9.]+)s\)\s+[—\-]\s+(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = stepRe.exec(output)) !== null) {
    steps.push({
      index: parseInt(m[1], 10),
      total: parseInt(m[2], 10),
      durationSec: parseFloat(m[3]),
      name: m[4].trim(),
    });
  }

  // ✅ blog_daily_metrics 업서트 완료: 7건
  const blogM = /blog_daily_metrics\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (blogM) upserts.push({ label: '블로그 일별 지표', count: parseInt(blogM[1], 10) });

  // ✅ smartplace_daily_metrics 업서트 완료: 7건
  const spM = /smartplace_daily_metrics\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (spM) upserts.push({ label: '스마트플레이스 유입', count: parseInt(spM[1], 10) });

  // ✅ Supabase 업서트 완료: N건  (블로그 키워드 순위)
  const rankM = /Supabase\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (rankM) upserts.push({ label: '블로그 키워드 순위', count: parseInt(rankM[1], 10) });

  // ✅ Supabase 플레이스 업서트 완료: N건
  const placeRankM = /Supabase\s+플레이스\s+업서트\s+완료:\s*(\d+)건/.exec(output);
  if (placeRankM) upserts.push({ label: '플레이스 키워드 순위', count: parseInt(placeRankM[1], 10) });

  // ✅ SearchAd 전체 처리 완료: total_upsert_rows=N
  const searchadM = /SearchAd\s+전체\s+처리\s+완료:\s*total_upsert_rows=(\d+)/.exec(output);
  if (searchadM) upserts.push({ label: 'SearchAd 광고 성과', count: parseInt(searchadM[1], 10) });

  return { steps, upserts };
}

function spawnAndCapture(
  execPath: string,
  scriptPath: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    const child = spawn(execPath, [scriptPath, ...args], {
      cwd,
      shell: false,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => chunks.push(c));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => chunks.push(c));
    child.on('error', (err: Error) => {
      chunks.push(`[spawn 오류] ${err.message}\n`);
      resolve({ code: 1, output: chunks.join('') });
    });
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? 1, output: chunks.join('') });
    });
  });
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  let body: { hospitalId?: string } = {};
  try {
    body = (await request.json()) as { hospitalId?: string };
  } catch {
    // body 없음 = 전체 병원 배치
  }

  const hospitalId = (body.hospitalId ?? '').trim();
  if (hospitalId && !/^[0-9a-f-]{8,36}$/i.test(hospitalId)) {
    return NextResponse.json({ error: '유효하지 않은 hospital_id입니다.' }, { status: 400 });
  }

  // 원격 Worker가 설정된 경우 프록시 (배포 환경)
  const workerUrl = process.env.COLLECT_WORKER_URL?.trim();
  if (workerUrl) {
    const workerApiKey = process.env.COLLECT_WORKER_API_KEY?.trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
    };
    if (workerApiKey) headers['Authorization'] = `Bearer ${workerApiKey}`;
    try {
      const workerRes = await fetch(`${workerUrl.replace(/\/$/, '')}/collect/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ hospitalId }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = await workerRes.json() as CollectRunResult;
      return NextResponse.json(data);
    } catch (e) {
      return NextResponse.json({
        ok: false,
        output: `[Worker 연결 실패] ${e instanceof Error ? e.message : String(e)}`,
        steps: [],
        upserts: [],
      } satisfies CollectRunResult);
    }
  }

  // admin-web은 apps/admin-web/ 에서 실행되므로 두 단계 위가 프로젝트 루트
  const projectRoot = path.resolve(process.cwd(), '..', '..');
  const isBatch = !hospitalId;
  const scriptName = isBatch ? 'collect-all-batch.js' : 'collect-all.js';
  const scriptPath = path.join(projectRoot, 'scripts', scriptName);

  if (!existsSync(scriptPath)) {
    return NextResponse.json(
      { error: `수집 스크립트를 찾을 수 없습니다: ${scriptPath}` },
      { status: 503 },
    );
  }

  // COLLECT_ALL_NO_FILE_LOG=1 → 자식 stdout을 콘솔(=pipe)으로 출력해 캡처 가능하게 함
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COLLECT_ALL_NO_FILE_LOG: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };

  const { code, output } = await spawnAndCapture(
    process.execPath,
    scriptPath,
    isBatch ? [] : [hospitalId],
    projectRoot,
    env,
  );

  const { steps, upserts } = parseCollectOutput(output);

  return NextResponse.json({
    ok: code === 0,
    output,
    steps,
    upserts,
  } satisfies CollectRunResult);
}
