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
  const ids = fromArgs.length > 0 ? fromArgs : loadHospitalIdsFromConfig();
  if (ids.length === 0) {
    console.error("실행할 hospital_id 가 없습니다. config.json hospitalPorts 또는 인자를 확인하세요.");
    process.exit(1);
  }

  console.log(`=== collect:all 배치: ${ids.length}개 병원 ===`);
  console.log(ids.join(", "));
  console.log("");

  for (let i = 0; i < ids.length; i++) {
    const hid = ids[i];
    console.log(`\n########## (${i + 1}/${ids.length}) hospital_id=${hid} ##########\n`);
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "collect-all.js"), hid], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    if (r.status !== 0) {
      console.error(`\n✖ 배치 중단: hospital_id=${hid} (exit ${r.status ?? r.signal})`);
      process.exit(r.status ?? 1);
    }
  }

  console.log(`\n=== collect:all 배치 전체 완료 (${ids.length}개) ===`);
}

main();
