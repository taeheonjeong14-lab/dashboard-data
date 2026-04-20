/**
 * 원클릭 전체 수집 오케스트레이터
 *
 * Usage:
 *   node scripts/collect-all.js [hospitalId]
 *   npm run collect:all -- [hospitalId]
 */

const { spawn } = require("child_process");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const HOSPITAL_ID = (process.argv[2] || "").trim();

async function resolveHospital(hospitalId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
  }
  if (!hospitalId) {
    throw new Error("hospital_id를 인자로 전달해 주세요. 예: npm run collect:all -- <hospital_id>");
  }

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/hospitals?select=id,name,naver_blog_id&id=eq.${encodeURIComponent(
    hospitalId
  )}&limit=1`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Accept-Profile": "core",
      "Content-Profile": "core",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`core.hospitals 조회 실패: status=${res.status}, body=${body.slice(0, 300)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`core.hospitals에서 id=${hospitalId}를 찾을 수 없습니다.`);
  }
  const row = rows[0];
  const blogId = String(row.naver_blog_id || "").trim();
  if (!blogId) {
    throw new Error(`core.hospitals.id=${hospitalId}의 naver_blog_id가 비어 있습니다.`);
  }
  return {
    hospitalId: String(row.id),
    hospitalName: row.name || null,
    blogId,
  };
}

function runStep(stepName, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const prettyArgs = args.join(" ");
    console.log(`\n▶ [START] ${stepName}`);
    console.log(`    ${command} ${prettyArgs}`.trim());

    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: "inherit",
      shell: false,
      env: process.env,
      ...options,
    });

    child.on("error", (err) => {
      reject(new Error(`[${stepName}] 실행 실패: ${err.message || err}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`✔ [DONE] ${stepName}`);
        resolve();
        return;
      }
      reject(new Error(`[${stepName}] 종료 코드 ${code}`));
    });
  });
}

async function main() {
  const resolved = await resolveHospital(HOSPITAL_ID);
  const baseEnv = {
    ...process.env,
    COLLECT_HOSPITAL_ID: resolved.hospitalId,
  };

  const steps = [
    {
      name: "블로그 일별 지표 수집",
      command: process.execPath,
      args: [path.join(ROOT_DIR, "scripts", "collect-blog-metrics.js"), resolved.blogId],
      options: { env: baseEnv },
    },
    {
      name: "스마트플레이스 유입 수집",
      command: process.execPath,
      args: [path.join(ROOT_DIR, "scripts", "collect-smartplace-inflow.js"), resolved.blogId],
      options: { env: baseEnv },
    },
    {
      name: "블로그/플레이스 키워드 순위 수집",
      command: "python",
      args: [path.join(ROOT_DIR, "scripts", "naver-rank-main.py")],
      options: { env: baseEnv },
    },
    {
      name: "SearchAd 일별 성과 수집",
      command: "python",
      args: [path.join(ROOT_DIR, "scripts", "naver-searchad-main.py")],
      options: { env: baseEnv },
    },
  ];

  const startedAt = Date.now();
  console.log("=== collect:all 시작 ===");
  console.log(`hospital_id: ${resolved.hospitalId}`);
  console.log(`hospital_name: ${resolved.hospitalName || "-"}`);
  console.log(`naver_blog_id: ${resolved.blogId}`);

  for (const step of steps) {
    await runStep(step.name, step.command, step.args, step.options);
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== collect:all 완료 (${elapsedSec}s) ===`);
}

main().catch((err) => {
  console.error(`\n✖ collect:all 실패: ${err.message || err}`);
  process.exit(1);
});
