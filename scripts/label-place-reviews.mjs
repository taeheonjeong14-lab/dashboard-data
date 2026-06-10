/**
 * 플레이스 리뷰 감성 레이블링 잡 (Gemini)
 *
 * analytics.analytics_place_reviews 에서 sentiment 가 null 이고 본문이 있는 리뷰를
 * 배치로 묶어 Gemini 로 positive/negative/neutral 분류 후 기록한다.
 * - 수집 스크래퍼(naver-place-reviews-main.py)가 sentiment=null 로 적재 → 이 잡이 채움.
 * - 재실행해도 이미 레이블된 건 건너뜀(부분 인덱스 idx_place_reviews_unlabeled 활용).
 *
 * env(루트 .env + apps/admin-web/.env.local 에서 자동 로드):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (필수)
 *   GEMINI_API_KEY (필수, admin-web/.env.local 에 있음)
 *   GEMINI_MODEL (선택, 기본 gemini-2.0-flash)
 *   LABEL_BATCH (선택, 기본 25) — 한 번에 Gemini 로 보낼 리뷰 수
 *
 * 실행: node scripts/label-place-reviews.mjs [hospital_id]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GEMINI_API_KEY 가 루트 .env 에 없으면 admin-web/.env.local 에서 읽어온다.
function loadGeminiKeyFallback() {
  if (process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY) return;
  const candidates = [
    path.join(__dirname, '..', 'apps', 'admin-web', '.env.local'),
    path.join(__dirname, '..', 'chart-api', '.env.local'),
  ];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^(GEMINI_API_KEY|GEMINI_MODEL|NEXT_PUBLIC_GEMINI_API_KEY)\s*=\s*(.+)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
}
loadGeminiKeyFallback();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = (process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
const BATCH = Number(process.env.LABEL_BATCH || '25');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  process.exit(1);
}
if (!GEMINI_KEY) {
  console.error('❌ GEMINI_API_KEY 필요 (apps/admin-web/.env.local 확인)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'analytics' },
});

const VALID = new Set(['strong_positive', 'positive', 'neutral', 'negative', 'strong_negative']);

const PROMPT_HEADER = `당신은 동물병원 네이버 리뷰의 감성을 5단계로 분류하는 분석가입니다.
각 리뷰를 정확히 하나로 분류하세요:
- strong_positive: 강한 만족·극찬
- positive: 일반적인 만족·칭찬 (짧고 담백한 긍정)
- neutral: 뚜렷한 긍·부정 없이 단순 사실/방문 기록만
- negative: 가벼운 불만·아쉬움
- strong_negative: 강한 불만·심각한 비판 (오진, 사고, 큰 실망 등)

[strong(강함) 판정 신호 — 긍정·부정 모두에 적용]
1) 강조 표현이 있으면 strong: "정말, 너무, 완전, 최고, 최악, 강력 추천, 진짜, 매우, 절대" 등
2) 리뷰가 길고 구체적이면 strong (구체적 사례·상세 설명이 많을수록 강함)
→ 짧고 담백하면 positive/negative, 강조어가 있거나 길고 구체적이면 strong_positive/strong_negative.

아래 번호가 매겨진 리뷰들을 분류해, 각 항목을
{"n": 번호, "label": "strong_positive|positive|neutral|negative|strong_negative", "confidence": 0과 1 사이 숫자}
형태로 만들고, 전체를 JSON 배열로만 출력하세요.
설명·코드펜스(\`\`\`) 없이 JSON 배열만 출력합니다.

리뷰:`;

async function geminiClassify(reviews) {
  const numbered = reviews.map((r, i) => `${i + 1}. ${(r.content || '').replace(/\s+/g, ' ').trim()}`).join('\n');
  const prompt = `${PROMPT_HEADER}\n${numbered}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const generationConfig = { temperature: 0, maxOutputTokens: 4096 };
  if (/2\.5-flash/i.test(GEMINI_MODEL)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`Gemini 빈 응답 (finishReason=${data.candidates?.[0]?.finishReason})`);

  // JSON 배열 추출(코드펜스 제거 + 첫 [ ... ] 슬라이스)
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  let parsed;
  try {
    parsed = JSON.parse(s);
  } catch {
    throw new Error(`Gemini JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('Gemini 응답이 배열이 아님');
  return parsed;
}

async function main() {
  const hospitalId = (process.argv[2] || '').trim();
  console.log(`🤖 감성 레이블링 시작 (model=${GEMINI_MODEL}, batch=${BATCH}${hospitalId ? `, hospital=${hospitalId}` : ''})`);

  // LABEL_RELABEL=1 → 기존 라벨을 모두 null 로 초기화 후 전체 재분류(3→5단계 전환용)
  if (process.env.LABEL_RELABEL === '1') {
    let rq = supabase
      .from('analytics_place_reviews')
      .update({ sentiment: null, sentiment_score: null, sentiment_model: null, sentiment_labeled_at: null })
      .not('sentiment', 'is', null);
    if (hospitalId) rq = rq.eq('hospital_id', hospitalId);
    const { error } = await rq;
    if (error) console.error('  ⚠️ 재레이블 초기화 실패:', error.message);
    else console.log('  (LABEL_RELABEL=1 → 기존 라벨 초기화 후 전체 재분류)');
  }

  let totalLabeled = 0;
  let round = 0;
  for (;;) {
    round += 1;
    let q = supabase
      .from('analytics_place_reviews')
      .select('review_id, content')
      .is('sentiment', null)
      .not('content', 'is', null)
      .is('competitor_slot', null) // 경쟁병원 리뷰는 감성 분석 제외(우리 병원만)
      .order('review_date', { ascending: false })
      .limit(BATCH);
    if (hospitalId) q = q.eq('hospital_id', hospitalId);
    const { data: rows, error } = await q;
    if (error) {
      console.error('❌ 조회 실패:', error.message);
      break;
    }
    const batch = (rows || []).filter((r) => (r.content || '').trim().length > 0);
    if (batch.length === 0) {
      console.log('  더 분류할 리뷰 없음.');
      break;
    }

    let labels;
    try {
      labels = await geminiClassify(batch);
    } catch (e) {
      console.error(`  ⚠️ Gemini 호출 실패(라운드 ${round}):`, e.message);
      break;
    }

    // n(1-based) → 결과 매핑 후 업데이트
    const labeledAt = new Date().toISOString();
    const byN = new Map();
    for (const item of labels) {
      const n = Number(item?.n);
      const label = String(item?.label || '').toLowerCase();
      if (n >= 1 && n <= batch.length && VALID.has(label)) {
        byN.set(n, { label, conf: typeof item.confidence === 'number' ? item.confidence : null });
      }
    }

    let updated = 0;
    await Promise.all(
      batch.map(async (r, i) => {
        const res = byN.get(i + 1);
        if (!res) return; // 누락 → 다음 라운드에 재시도
        const { error: upErr } = await supabase
          .from('analytics_place_reviews')
          .update({
            sentiment: res.label,
            sentiment_score: res.conf,
            sentiment_model: GEMINI_MODEL,
            sentiment_labeled_at: labeledAt,
          })
          .eq('review_id', r.review_id);
        if (!upErr) updated += 1;
      }),
    );

    totalLabeled += updated;
    console.log(`  라운드 ${round}: ${updated}/${batch.length}건 레이블 (누적 ${totalLabeled})`);

    // 모델이 일부를 빠뜨려 진전이 없으면 무한루프 방지
    if (updated === 0) {
      console.warn('  진전 없음 → 중단(모델 응답 확인 필요)');
      break;
    }
    if (process.env.LABEL_ONCE === '1') {
      console.log('  (LABEL_ONCE=1 → 한 배치만 실행하고 종료)');
      break;
    }
  }

  console.log(`\n완료 — 총 ${totalLabeled}건 레이블링`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
