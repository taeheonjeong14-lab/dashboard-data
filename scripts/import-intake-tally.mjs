// Tally(구글시트, CP949) 초진 접수증 → intake.submissions + submission_pets 임포트.
//
//   node scripts/import-intake-tally.mjs <csv경로>            # dry-run: 리뷰 리포트만 생성, DB 변경 없음
//   node scripts/import-intake-tally.mjs <csv경로> --commit   # 실제 insert (service role)
//
// env: NEXT_PUBLIC_SUPABASE_URL(또는 SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const HOSPITAL_ID = '9cb53e94-41bf-44de-8058-f1f2df0c501c'; // 정든동물병원
const COMMIT = process.argv.includes('--commit');
const CSV = process.argv.find((a) => a.endsWith('.csv')) || 'data-migration/정든_초진접수증.csv';

// ── 컬럼 인덱스 (58컬럼 고정 레이아웃) ──
const C = {
  tallyId: 0, submittedAt: 2, ownerName: 3, ownerPhone: 4,
  addr: [5, 6, 7, 8],
  channel: 44, media: { naver: 46, google: 47, daum: 48, instagram: 49, danggeun: 50 }, acqDetail: 51,
  consentReq: 53, consentMkt: 55, consentContent: 57,
};
// 펫 블록(1·2·3) 컬럼
const PETS = [
  { name: 9, species: 10, breed: 11, ageM: 12, dateN: 13, ageUnknown: 15, sex: 16, neuter: 17, symptom: 18, detail: 19 },
  { name: 21, species: 22, breed: 23, ageM: 24, dateN: 25, ageUnknown: 27, sex: 28, neuter: 29, symptom: 30, detail: 31 },
  { name: 33, species: 34, breed: 35, ageM: 36, dateN: 37, ageUnknown: 39, sex: 40, neuter: 41, symptom: 42, detail: 43 },
];

const SYMPTOM_MAP = [
  ['skin', '피부가이상해요'], ['eye', '눈이아픈것같아요'], ['ear', '귀가아픈것같아요'], ['nose', '코가아픈것같아요'],
  ['oral', '구강상태가이상해요'], ['breathing', '숨소리가이상해요'], ['leg', '다리가이상해요'], ['behavior', '행동이이상해요'],
  ['eating', '음식섭취에문제가있어요'], ['genital', '생식기가아픈것같아요'], ['urine', '소변에문제가있어요'],
  ['digestion', '소화에문제가있어요'], ['checkup', '건강검진'], ['vaccine', '예방접종'], ['registration', '동물등록'],
  ['parasite', '기생충약'], ['other', '기타'],
];

const s = (v) => String(v ?? '').trim();
const isTrue = (v) => s(v).toUpperCase() === 'TRUE';

function normPhone(v) {
  let d = s(v).replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('10')) d = '0' + d;
  if (d.length === 11 && d.startsWith('010')) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return d || null;
}
function mapSpecies(v) {
  const t = s(v);
  if (t.includes('강아지') || t === 'dog') return 'dog';
  if (t.includes('고양이') || t === 'cat') return 'cat';
  return t ? 'other' : '';
}
function mapSex(sexV, neuterV) {
  const sex = s(sexV), nt = s(neuterV);
  const male = sex.includes('남'), female = sex.includes('여');
  const intact = nt.includes('미완료'), neutered = nt.includes('완료') && !intact;
  if (male && neutered) return 'male_neutered';
  if (male && intact) return 'male_intact';
  if (female && neutered) return 'female_neutered';
  if (female && intact) return 'female_intact';
  return '';
}
function mapSymptom(cell) {
  const raw = s(cell);
  if (!raw || raw === '0') return { codes: [], unmapped: '' };
  const norm = raw.replace(/\s/g, '');
  const codes = SYMPTOM_MAP.filter(([, kw]) => norm.includes(kw)).map(([code]) => code);
  return { codes, unmapped: codes.length ? '' : raw };
}
function mapReferral(row) {
  const ch = s(row[C.channel]);
  const n = ch.replace(/\s/g, '');
  const media = Object.entries(C.media).filter(([, idx]) => isTrue(row[idx])).map(([k]) => k);
  if (n.includes('온라인')) return { channel: 'online', onlineMedia: media, acquaintanceDetail: '', otherDetail: '' };
  if (n.includes('옥외')) return { channel: 'outdoor', onlineMedia: [], acquaintanceDetail: '', otherDetail: '' };
  if (n.includes('지인')) return { channel: 'acquaintance', onlineMedia: [], acquaintanceDetail: s(row[C.acqDetail]), otherDetail: '' };
  if (!ch || n === '기타') return { channel: ch ? 'other' : '', onlineMedia: [], acquaintanceDetail: '', otherDetail: '' };
  return { channel: 'other', onlineMedia: [], acquaintanceDetail: '', otherDetail: ch }; // 자유텍스트 원문 보존
}
function pad2(n) { return String(n).padStart(2, '0'); }
// "2026-03-30 2:12:47"(UTC, 시 한자리 가능) → "2026-03-30 02:12:47+00"
function toCreatedAt(v) {
  const m = s(v).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${pad2(m[4])}:${m[5]}:${m[6]}+00`;
}
function validDate(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d)); // 실제 달력 검증 (11/31, 2/30 등 거부)
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// 수동 결정값 (모호한 원본 M → 날짜 or null). 사용자가 하나씩 확인해준 것.
const BIRTH_OVERRIDES = {
  '201119': '2020-11-19',
  '2019101': '2019-10-01',
  '2009~2010': '2010-01-01',
  '20240000': '2024-01-01',
  '2102': '2021-02-01',
  '골든리트리버': null,      // 품종 오입력 → 빈칸
  '11년': '2015-01-01',     // 접수 2026 - 11살
  '180524': '2018-05-24',
  '20241131': '2024-11-30', // 11/31은 없는 날 → 월말로 보정
};
// 생일 coalesce + 파싱. sub = {y, m} 접수 연/월. return { date|null, flag }
function parseBirth(nVal, mVal, sub) {
  const n = s(nVal);
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return { date: n, flag: '' };
  let m = s(mVal);
  if (!m) return { date: null, flag: '' };
  if (Object.prototype.hasOwnProperty.call(BIRTH_OVERRIDES, m)) return { date: BIRTH_OVERRIDES[m], flag: '' };
  m = m.replace(/추정|말일|쯤|경|약|\?/g, '').replace(/생$/, '').trim();
  if (!m) return { date: null, flag: '' };

  // N개월 / N달 → 접수일에서 N개월 전, 그 달 1일
  let mo = m.match(/^(\d{1,2})\s*(개월|달)$/);
  if (mo) { let y = sub.y, mm = sub.m - Number(mo[1]); while (mm <= 0) { mm += 12; y -= 1; } return { date: `${y}-${pad2(mm)}-01`, flag: '' }; }
  // N살 / N세 / N설(오타) / 순수 1~2자리 → 나이
  let ag = m.match(/^(\d{1,2})\s*(?:살|세|설)$/) || m.match(/^(\d{1,2})$/);
  if (ag) return { date: `${sub.y - Number(ag[1])}-01-01`, flag: '' };
  // 한글 YYYY년[ M월][ D일]
  let kor = m.match(/^(\d{4})\s*년\s*(?:(\d{1,2})\s*월)?\s*(?:(\d{1,2})\s*일)?$/);
  if (kor) {
    const y = +kor[1], mm = kor[2] ? +kor[2] : null, d = kor[3] ? +kor[3] : null;
    if (mm && d && validDate(y, mm, d)) return { date: `${y}-${pad2(mm)}-${pad2(d)}`, flag: '' };
    if (mm && mm >= 1 && mm <= 12) return { date: `${y}-${pad2(mm)}-01`, flag: '' };
    if (y >= 1900 && y <= 2100) return { date: `${y}-01-01`, flag: '' };
  }
  // 연도만 4자리
  if (/^\d{4}$/.test(m)) { const y = +m; if (y >= 1900 && y <= 2100) return { date: `${y}-01-01`, flag: '' }; }
  // 8자리 YYYYMMDD (일=00 → 1일)
  if (/^\d{8}$/.test(m)) { const y = +m.slice(0, 4), mm = +m.slice(4, 6), d = +m.slice(6, 8); if (y >= 1900 && y <= 2100 && mm >= 1 && mm <= 12) return { date: `${y}-${pad2(mm)}-${pad2(d >= 1 && d <= 31 ? d : 1)}`, flag: '' }; }
  // 6자리 YYYYMM
  if (/^\d{6}$/.test(m)) { const y = +m.slice(0, 4), mm = +m.slice(4, 6); if (y >= 1900 && y <= 2100 && mm >= 1 && mm <= 12) return { date: `${y}-${pad2(mm)}-01`, flag: '' }; }
  // 구분자(. / 공백 , ') → -
  const parts = m.replace(/[./ ,'~]+/g, '-').split('-').filter(Boolean);
  if (parts.length === 3) { let y = +parts[0]; if (parts[0].length === 2 && y <= 99) y += 2000; const mm = +parts[1], d = +parts[2]; if (validDate(y, mm, d)) return { date: `${y}-${pad2(mm)}-${pad2(d)}`, flag: '' }; }
  if (parts.length === 2) {
    let y = +parts[0]; if (parts[0].length === 2 && y <= 99) y += 2000;
    if (/^\d{4}$/.test(parts[0]) && /^\d{4}$/.test(parts[1])) { const mm = +parts[1].slice(0, 2), d = +parts[1].slice(2); if (validDate(+parts[0], mm, d)) return { date: `${parts[0]}-${pad2(mm)}-${pad2(d)}`, flag: '' }; }
    const mm = +parts[1]; if (y >= 1900 && y <= 2100 && mm >= 1 && mm <= 12) return { date: `${y}-${pad2(mm)}-01`, flag: '' };
  }
  return { date: null, flag: '⚠️생일모호' };
}

// ── CSV 로드 ──
const buf = fs.readFileSync(CSV);
const wb = XLSX.read(iconv.decode(buf, 'cp949'), { type: 'string', raw: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
const allRows = rows.slice(1);

// Tally가 멀티펫 접수를 같은 Submission ID로 여러 행(반복그룹 아티팩트)으로 export한다.
// → 같은 ID는 "펫 이름이 가장 많이 채워진 행(=wide 컬럼 완성본)" 하나만 남긴다.
const byId = new Map();
for (const row of allRows) {
  const id = s(row[C.tallyId]);
  if (!id) continue;
  const filled = PETS.filter((p) => s(row[p.name])).length;
  const prev = byId.get(id);
  if (!prev || filled > prev.filled) byId.set(id, { row, filled });
}
const data = [...byId.values()].map((x) => x.row);

// ── 변환 ──
const submissions = [];
const report = [['tally_id', 'owner', 'pet#', 'pet_name', 'raw_birth(N|M)', 'birth_date', 'age_unknown', 'sex', 'symptoms', 'unmapped_symptom', 'channel', 'flags']];
let flagged = 0, otherCh = 0, unmappedSym = 0;

for (const row of data) {
  const tallyId = s(row[C.tallyId]);
  if (!tallyId) continue;
  const submittedAt = s(row[C.submittedAt]);
  const sm = submittedAt.match(/^(\d{4})-(\d{2})/);
  const sub = { y: sm ? +sm[1] : new Date().getFullYear(), m: sm ? +sm[2] : 1 };
  const referral = mapReferral(row);
  if (referral.channel === 'other') otherCh++;

  const pets = [];
  PETS.forEach((p, idx) => {
    const name = s(row[p.name]);
    if (!name) return;
    const birth = parseBirth(row[p.dateN], row[p.ageM], sub);
    const sym = mapSymptom(row[p.symptom]);
    if (birth.flag) flagged++;
    if (sym.unmapped) unmappedSym++;
    const ageUnknown = isTrue(row[p.ageUnknown]);
    const sex = mapSex(row[p.sex], row[p.neuter]);
    const detail = [s(row[p.detail]), sym.unmapped].filter(Boolean).join(' / ') || null;
    pets.push({
      pet_index: idx, hospital_id: HOSPITAL_ID,
      name, species: mapSpecies(row[p.species]), breed: s(row[p.breed]) || null, breed_other: null,
      birth_date: birth.date, age_unknown: ageUnknown && !birth.date, age_text: null,
      sex: sex || null, registration: null, insurance: null,
      symptoms: sym.codes, symptom_detail: detail, survey_linked: false, survey_session_id: null,
    });
    report.push([tallyId, s(row[C.ownerName]), idx + 1, name, `${s(row[p.dateN])}|${s(row[p.ageM])}`, birth.date ?? '', String(pets[pets.length - 1].age_unknown), sex, sym.codes.join('+'), sym.unmapped, referral.channel, birth.flag]);
  });
  if (pets.length === 0) continue;

  const answers = { _tallyId: tallyId, _respondentId: s(row[1]), _source: 'tally', raw: row };
  submissions.push({
    sub: {
      hospital_id: HOSPITAL_ID,
      created_at: toCreatedAt(submittedAt),
      owner_name: s(row[C.ownerName]) || null,
      owner_phone: normPhone(row[C.ownerPhone]),
      owner_address: C.addr.map((i) => s(row[i])).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || null,
      pet_count: pets.length,
      referral,
      consent_required: isTrue(row[C.consentReq]),
      consent_marketing: isTrue(row[C.consentMkt]),
      consent_content: isTrue(row[C.consentContent]),
      answers,
      status: 'submitted',
    },
    pets,
    tallyId,
  });
}

// ── 리뷰 리포트 출력 ──
const csvEscape = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const reportPath = path.join('data-migration', '_import-report.csv');
fs.writeFileSync(reportPath, '﻿' + report.map((r) => r.map(csvEscape).join(',')).join('\n'), 'utf8');

console.log(`\n읽은 접수: ${submissions.length}건 / 펫: ${submissions.reduce((a, x) => a + x.pets.length, 0)}마리`);
console.log(`⚠️ 생일 모호(빈칸 처리): ${flagged} · 매핑 안 된 증상: ${unmappedSym} · 경로 other(자유텍스트): ${otherCh}`);
console.log(`리뷰 리포트: ${reportPath}`);

if (!COMMIT) {
  console.log('\n[dry-run] DB 변경 없음. 실제 입력하려면 --commit 추가.');
  process.exit(0);
}

// ── 실제 insert ──
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false } });

// 중복 방지: 기존 _tallyId 수집
const { data: existing, error: exErr } = await supabase.schema('intake').from('submissions').select('answers').eq('hospital_id', HOSPITAL_ID);
if (exErr) { console.error('기존 조회 실패:', exErr.message); process.exit(1); }
const seen = new Set((existing ?? []).map((r) => r.answers?._tallyId).filter(Boolean));

let inserted = 0, skipped = 0;
for (const { sub, pets, tallyId } of submissions) {
  if (seen.has(tallyId)) { skipped++; continue; }
  const { data: ins, error } = await supabase.schema('intake').from('submissions').insert(sub).select('id').single();
  if (error) { console.error(`insert 실패 ${tallyId}:`, error.message); continue; }
  const petRows = pets.map((p) => ({ ...p, submission_id: ins.id }));
  const { error: pErr } = await supabase.schema('intake').from('submission_pets').insert(petRows);
  if (pErr) { console.error(`pets insert 실패 ${tallyId}:`, pErr.message); continue; }
  inserted++;
}
console.log(`\n완료 — 입력 ${inserted}건, 중복 스킵 ${skipped}건.`);
