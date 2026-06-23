/**
 * config.json 의 hospitalPorts 에 등록된 병원을 순서대로 collect:all 실행.
 *
 * Usage:
 *   node scripts/collect-all-batch.js
 *   npm run collect:all:batch
 *
 * 특정 병원만(순서 지정):
 *   node scripts/collect-all-batch.js <id1> <id2> ...
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { shuffle } = require("./lib/human");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");

function loadHospitalIdsFromConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const cfg = JSON.parse(raw);
  const ports = cfg.hospitalPorts;
  if (!ports || typeof ports !== "object") {
    throw new Error("config.json 에 hospitalPorts 가 없습니다.");
  }
  return Object.keys(ports);
}

function main() {
  const fromArgs = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  // 인자로 순서를 지정하면 그대로, 기본 배치(config 로드)면 병원 순서를 섞어 패턴을 줄인다.
  const ids = fromArgs.length > 0 ? fromArgs : shuffle(loadHospitalIdsFromConfig());
  if (ids.length === 0) {
    console.error("실행할 hospital_id 가 없습니다. config.json hospitalPorts 또는 인자를 확인하세요.");
    process.exit(1);
  }

  console.log(`=== collect:all 배치: ${ids.length}개 병원 ===`);
  console.log(ids.join(", "));
  console.log("");

  const failedHospitals = [];

  for (let i = 0; i < ids.length; i++) {
    const hid = ids[i];
    console.log(`\n########## (${i + 1}/${ids.length}) hospital_id=${hid} ##########\n`);
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "collect-all.js"), hid], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    const exitCode = r.status ?? (r.signal ? 1 : 0);
    console.log(`[BATCH_HOSPITAL_DONE] ${JSON.stringify({ index: i + 1, total: ids.length, hospitalId: hid, exitCode })}`);
    if (exitCode !== 0) {
      console.error(`\n✖ 오류 발생: hospital_id=${hid} (exit ${exitCode}) — 다음 병원으로 계속 진행합니다.`);
      failedHospitals.push(hid);
    }
  }

  console.log(`\n=== collect:all 배치 전체 완료 (${ids.length}개) ===`);
  if (failedHospitals.length > 0) {
    console.error(`실패한 병원 (${failedHospitals.length}개): ${failedHospitals.join(", ")}`);
    process.exit(1);
  }
}

main();
