/**
 * 과거 초진접수증 엑셀 → intake.submissions + intake.submission_pets 백필.
 *
 * '초진' 시트(행당 1마리). 같은 (전화번호 + 내원날짜) = 한 보호자의 한 제출(다견은 여러 행).
 * 컬럼: A 날짜 / B 전화 / C 보호자 / D 주소 / E 동물이름 / F 종 / G 품종 / H 생년월일(serial)
 *       I 만나이 / J 성별 / K 등록 / L 보험 / M 내원이유 / N 상세증상 / O 인지경로 / P 상세경로 / Q 필수동의 / R 마케팅동의
 *
 * 매핑 코드는 apps/hospital-web/lib/intake/form-spec.ts 의 코드와 동일.
 *
 * Usage:
 *   node scripts/backfill-intake-xlsx.js <hospital_id> <xlsx경로> [--dry]
 *   (--dry: 파싱/그룹핑/매핑만 보여주고 DB에 안 씀)
 */

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const C = { date:0, phone:1, owner:2, addr:3, petName:4, species:5, breed:6, birth:7, age:8, sex:9, reg:10, ins:11, reason:12, detail:13, referral:14, refDetail:15, consentReq:16, consentMkt:17 };

const str = (v) => (v == null ? "" : String(v)).trim();

function mapSpecies(v) { const t = str(v); if (t.includes("강아지") || t.includes("개")) return "dog"; if (t.includes("고양이") || t.includes("묘") || t.includes("코숏")) return "cat"; if (!t) return ""; return "other"; }
function mapSex(v) { const t = str(v).replace(/\s/g, ""); const neut = t.includes("중성화"); if (t.includes("남")) return neut ? "male_neutered" : "male_intact"; if (t.includes("여")) return neut ? "female_neutered" : "female_intact"; return ""; }
function mapRegistration(v) { const t = str(v); if (t.includes("내장")) return "internal"; if (t.includes("외장")) return "external"; if (t.includes("등록하지")) return "none"; return ""; }
function mapInsurance(v) { const t = str(v); if (t === "예") return "yes"; if (t === "아니오") return "no"; return ""; }
const SYMPTOM_KW = [["소화","digestion"],["예방접종","vaccine"],["피부","skin"],["다리","leg"],["눈이","eye"],["건강검진","checkup"],["숨소리","breathing"],["귀가","ear"],["행동","behavior"],["음식 섭취","eating"],["소변","urine"],["기생충","parasite"],["구강","oral"],["생식기","genital"],["코가","nose"],["동물등록","registration"],["기타","other"]];
function mapSymptomCode(v) { const t = str(v); if (!t || t === "0") return null; for (const [kw, code] of SYMPTOM_KW) if (t.includes(kw)) return code; return "other"; }
function mapReferral(v) { const t = str(v); let channel = ""; if (t.includes("온라인")) channel = "online"; else if (t.includes("옥외") || t.includes("간판")) channel = "outdoor"; else if (t.includes("지인")) channel = "acquaintance"; else if (t) channel = "other"; return { channel, raw: t || null }; }
function mapBool(v) { return v === true || str(v).toUpperCase() === "TRUE" || str(v) === "1"; }
function serialToDate(v) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return null; const d = XLSX.SSF.parse_date_code(n); if (!d || !d.y) return null; return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`; }

function buildPet(r, idx) {
  const birth = serialToDate(r[C.birth]);
  const code = mapSymptomCode(r[C.reason]);
  return {
    pet_index: idx,
    name: str(r[C.petName]) || null,
    species: mapSpecies(r[C.species]) || null,
    breed: str(r[C.breed]) || null,
    breed_other: null,
    birth_date: birth,
    age_unknown: !birth,
    age_text: str(r[C.age]) || null,
    sex: mapSex(r[C.sex]) || null,
    registration: mapRegistration(r[C.reg]) || null,
    insurance: mapInsurance(r[C.ins]) || null,
    symptoms: code ? [code] : [],
    symptom_detail: str(r[C.detail]) || null,
    survey_linked: false,
    survey_session_id: null,
  };
}
// pets jsonb(라이브 폼과 동일 camelCase)
function petToJsonb(p) { return { name: p.name, species: p.species, breed: p.breed, breedOther: p.breed_other, birthDate: p.birth_date, ageUnknown: p.age_unknown, ageText: p.age_text, sex: p.sex, registration: p.registration, insurance: p.insurance, symptoms: p.symptoms, symptomDetail: p.symptom_detail }; }

function getSupabase() { const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) return null; return createClient(url, key, { auth: { persistSession: false } }); }

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const [hospitalId, xlsxPath] = args.filter((a) => a !== "--dry");
  if (!hospitalId || !xlsxPath) { console.error("Usage: node scripts/backfill-intake-xlsx.js <hospital_id> <xlsx경로> [--dry]"); process.exit(1); }

  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets["초진"];
  if (!ws) { console.error("'초진' 시트를 못 찾았어요."); process.exit(1); }
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }).slice(1).filter((r) => str(r[C.phone]));

  // (전화번호 + 날짜)로 그룹핑 → 한 제출
  const groups = new Map();
  let noDate = 0;
  for (const r of all) {
    const phone = str(r[C.phone]);
    const date = serialToDate(r[C.date]);
    if (!date) noDate++;
    const key = `${phone}|${date || ""}`;
    if (!groups.has(key)) groups.set(key, { phone, date, owner: str(r[C.owner]), addr: str(r[C.addr]), rows: [] });
    groups.get(key).rows.push(r);
  }

  const submissions = [...groups.values()].map((g) => {
    const pets = g.rows.map((r, i) => buildPet(r, i));
    const firstRef = g.rows.map((r) => r[C.referral]).find((x) => str(x)) ?? "";
    return {
      hospital_id: hospitalId,
      owner_name: g.owner || null,
      owner_phone: g.phone || null,
      owner_address: g.addr || null,
      pet_count: pets.length,
      referral: mapReferral(firstRef),
      consent_required: mapBool(g.rows[0][C.consentReq]),
      consent_marketing: mapBool(g.rows[0][C.consentMkt]),
      // submissions 엔 pets 컬럼이 없고(정규화됨) 원본은 answers 에 보관 — 라이브 API 와 동일.
      answers: { source: "xlsx_backfill", pets: pets.map(petToJsonb) },
      status: "archived",
      created_at: g.date ? `${g.date}T09:00:00+09:00` : null,
      _pets: pets,
    };
  });

  const totalPets = submissions.reduce((s, x) => s + x._pets.length, 0);
  const multi = submissions.filter((x) => x.pet_count >= 2).length;
  console.log(`그룹(제출)=${submissions.length}, 마리=${totalPets}, 다견 제출=${multi}, 날짜없는행=${noDate}`);

  if (dry) {
    console.log("\n=== 다견 샘플 3건 ===");
    for (const s of submissions.filter((x) => x.pet_count >= 2).slice(0, 3)) {
      console.log(`\n● ${s.owner_name} / ${s.owner_phone} / ${s.created_at?.slice(0,10)} / pet_count=${s.pet_count} / 동의(필수=${s.consent_required},마케팅=${s.consent_marketing}) / 경로=${JSON.stringify(s.referral)}`);
      for (const p of s._pets) console.log(`   - [${p.pet_index}] ${p.name} / ${p.species} / ${p.breed} / 생일=${p.birth_date||"-"}(${p.age_text||"-"}) / ${p.sex} / 등록=${p.registration} / 보험=${p.insurance||"-"} / 증상=${JSON.stringify(p.symptoms)} / 상세=${(p.symptom_detail||"").slice(0,20)}`);
    }
    // 매핑 점검: 빈 코드 통계
    const badSpecies = submissions.flatMap((s)=>s._pets).filter((p)=>!p.species).length;
    const otherSpecies = submissions.flatMap((s)=>s._pets).filter((p)=>p.species==="other").length;
    const badSex = submissions.flatMap((s)=>s._pets).filter((p)=>!p.sex).length;
    console.log(`\n=== 매핑 점검 ===\n species 빈값=${badSpecies}, other=${otherSpecies} / sex 빈값=${badSex}`);
    console.log("--dry 모드 — DB에 쓰지 않았습니다.");
    return;
  }

  const supabase = getSupabase();
  if (!supabase) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 없음(.env)"); process.exit(1); }

  // 중복 실행 방지: 이미 이 병원에 xlsx_backfill 로 넣은 게 있으면 중단(insert라 재실행 시 중복됨).
  const { count: existing } = await supabase.schema("intake").from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("hospital_id", hospitalId).filter("answers->>source", "eq", "xlsx_backfill");
  if (existing && existing > 0) {
    console.error(`⛔ 이미 백필된 것으로 보입니다(이 병원 xlsx_backfill ${existing}건). 중복 방지를 위해 중단합니다.\n   재실행하려면 먼저 기존 백필분을 삭제하세요(SQL Editor): delete from intake.submissions where hospital_id='${hospitalId}' and answers->>'source'='xlsx_backfill';`);
    process.exit(1);
  }

  let okSub = 0, okPet = 0;
  for (const s of submissions) {
    const { _pets, ...subRow } = s;
    const { data: ins, error } = await supabase.schema("intake").from("submissions").insert(subRow).select("id").single();
    if (error) { console.error("submission insert 실패:", error.message, "| owner:", s.owner_name); continue; }
    okSub++;
    const petRows = _pets.map((p) => ({ submission_id: ins.id, hospital_id: hospitalId, ...p }));
    const { error: pe } = await supabase.schema("intake").from("submission_pets").insert(petRows);
    if (pe) { console.error("pets insert 실패:", pe.message, "| owner:", s.owner_name); continue; }
    okPet += petRows.length;
    if (okSub % 50 === 0) console.log(`  ...${okSub}/${submissions.length} submissions`);
  }
  console.log(`✅ 백필 완료: submissions ${okSub}건, submission_pets ${okPet}건`);
}

main().catch((e) => { console.error("실패:", e.message); process.exit(1); });
