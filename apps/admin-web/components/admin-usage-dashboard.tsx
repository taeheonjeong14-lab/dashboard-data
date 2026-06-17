'use client';

import { useCallback, useEffect, useState } from 'react';

const TOKEN_VALUE_USD = 0.001; // 1토큰 = $0.001 (환산 표시)
const KRW_PER_USD = 1380;

type HospitalRow = {
  hospitalId: string | null;
  hospitalName: string;
  tokenBalance: number;
  costUsd: number;
  calls: number;
  lastUsed: string | null;
};
type UsageItem = { feature: string; provider: string; costUsd: number; calls: number };
type UsageRun = {
  runId: string | null; friendlyId: string | null; patientName: string | null; ownerName: string | null;
  lastUsed: string | null; costUsd: number; calls: number; refunded: boolean; items: UsageItem[];
};
type UsageResponse = {
  days: number;
  totalUsd: number;
  hospitals: HospitalRow[];
  runs: UsageRun[];
  note?: string;
  error?: string;
};

const DAY_OPTIONS = [7, 30, 90];

// 기능 코드 → 한글 라벨 + 색
const FEATURE_LABEL: Record<string, string> = {
  extract: '추출',
  ocr: 'OCR',
  case_blog: '진료케이스',
  health_checkup: '건강검진',
  disease_intro: '질환소개',
  image_placement: '이미지배치',
  image_analysis: '이미지분석',
  assessment: 'AI평가',
  kakao_alimtalk: '알림톡',
};
// 진료케이스 블로그 단계(인과·진단치료세부·아웃라인·글)는 한 그룹 '진료케이스'로 합쳐 표시.
const CASE_BLOG_FEATURES = new Set(['blog_causal', 'blog_detail', 'blog_outline', 'blog_post']);
const normFeature = (f: string) => (CASE_BLOG_FEATURES.has(f) ? 'case_blog' : f);
const featureLabel = (f: string) => FEATURE_LABEL[normFeature(f)] ?? f;
// 세부 항목용 — blog 단계를 합치지 않고 단계명 그대로 보여준다(그룹 헤더만 '진료케이스'로 합침).
const ITEM_LABEL: Record<string, string> = {
  ...FEATURE_LABEL,
  blog_causal: '인과 흐름', blog_detail: '진단·치료 세부', blog_outline: '아웃라인', blog_post: '블로그 글', blog_images: '이미지 배정',
};
const itemLabel = (f: string) => ITEM_LABEL[f] ?? f;
// 한 건(run)의 기능들 → 대표 라벨.
const CASE_FEATS = new Set(['blog_causal', 'blog_detail', 'blog_outline', 'blog_post', 'blog_images']);
function groupLabel(feats: string[]): string {
  if (feats.some((x) => CASE_FEATS.has(x))) return '진료케이스';
  if (feats.some((x) => x === 'health_checkup' || x === 'disease_intro')) return '건강검진';
  if (feats.some((x) => x === 'image_analysis' || x === 'image_placement')) return '이미지분석';
  if (feats.some((x) => x === 'assessment')) return 'AI평가';
  if (feats.some((x) => x === 'extract' || x === 'ocr')) return '추출';
  return feats[0] ? featureLabel(feats[0]) : '사용';
}

// 진료케이스 작성 단계는 인건비 반영해 20배 과금(DB billing.token_charge_operation 와 동일).
// 사용내역 토큰 표시도 '청구 기준'으로 맞추기 위해 같은 배율을 적용한다(cost_usd 자체는 원가 그대로).
const CASE_BLOG_CHARGE_MULT = 20;
const CHARGE_MULT_FEATS = new Set(['blog_causal', 'blog_detail', 'blog_outline', 'blog_post']);
const chargeMult = (f: string) => (CHARGE_MULT_FEATS.has(f) ? CASE_BLOG_CHARGE_MULT : 1);
const tok = (usd: number) => usd / TOKEN_VALUE_USD;
const fmtTok = (v: number) => (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1));
const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
const krw = (v: number) => `₩${Math.round(v * KRW_PER_USD).toLocaleString()}`;
const num = (v: number) => v.toLocaleString();

export default function AdminUsageDashboard() {
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (d: number, hospitalId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days: String(d) });
      if (hospitalId) qs.set('hospitalId', hospitalId);
      const res = await fetch(`/api/admin/usage?${qs.toString()}`, { credentials: 'include' });
      const json = (await res.json()) as UsageResponse;
      if (!res.ok) throw new Error(json.error || '불러오기 실패');
      setData(json);
      // 선택이 없으면 비용 1위 병원 자동 선택
      if (!hospitalId && json.hospitals.length > 0) {
        setSelected(json.hospitals[0].hospitalId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days, selected);
  }, [days, selected, load]);

  const grant = useCallback(
    async (hospitalId: string, name: string, current: number) => {
      const input = window.prompt(`"${name}" 에 지급할 토큰 수 (음수면 차감). 현재 잔액 ${current.toLocaleString()}`, '1000');
      if (input == null) return;
      const tokens = Math.trunc(Number(input));
      if (!Number.isFinite(tokens) || tokens === 0) return;
      try {
        const res = await fetch('/api/admin/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ hospitalId, tokens }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error || '지급 실패');
        await load(days, selected);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : '지급 실패');
      }
    },
    [days, selected, load],
  );

  const runs = data?.runs ?? [];
  const selectedHospital = (data?.hospitals ?? []).find((h) => h.hospitalId === selected) ?? null;
  const anyZero = (data?.hospitals ?? []).some((h) => h.tokenBalance <= 0);
  const toggleRun = (key: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div style={{ padding: '4px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>사용량</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            병원을 고르면 작업(건)별 토큰 사용 내역을 목록으로 봅니다. 각 건을 누르면 세부 항목이 펼쳐집니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              style={{
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: 700,
                borderRadius: 8,
                cursor: 'pointer',
                border: `1px solid ${days === d ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: days === d ? 'var(--accent-subtle)' : '#fff',
                color: days === d ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              최근 {d}일
            </button>
          ))}
        </div>
      </div>

      {data?.note ? (
        <div style={banner('var(--warning-subtle, #fef9c3)', 'var(--text-secondary)')}>{data.note}</div>
      ) : null}
      {error ? <div style={banner('var(--danger-subtle)', 'var(--danger)')}>{error}</div> : null}
      {anyZero ? (
        <div style={banner('var(--warning-subtle, #fef9c3)', 'var(--text-secondary)')}>
          잔액이 0 이하인 병원은 AI 작업이 차단됩니다. 아래 목록의 <b>지급</b> 으로 충전하세요.
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 14, alignItems: 'start' }}>
        {/* 병원 목록 */}
        <div style={cardBox}>
          <div style={{ ...sectionTitle, padding: '8px 12px 4px' }}>병원 ({data?.hospitals.length ?? 0})</div>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            {(data?.hospitals ?? []).map((h) => {
              const active = h.hospitalId === selected;
              return (
                <div
                  key={h.hospitalId ?? 'none'}
                  onClick={() => h.hospitalId && setSelected(h.hospitalId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '9px 12px',
                    cursor: h.hospitalId ? 'pointer' : 'default',
                    borderTop: '1px solid var(--border)',
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.hospitalName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      잔액 <span style={{ color: h.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: 700 }}>{num(h.tokenBalance)}</span> · {usd(h.costUsd)}
                    </div>
                  </div>
                  {h.hospitalId ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void grant(h.hospitalId as string, h.hospitalName, h.tokenBalance);
                      }}
                      style={{ flexShrink: 0, padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--accent)', background: '#fff', color: 'var(--accent)' }}
                    >
                      지급
                    </button>
                  ) : null}
                </div>
              );
            })}
            {(data?.hospitals.length ?? 0) === 0 && !loading ? (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>병원이 없습니다.</div>
            ) : null}
          </div>
        </div>

        {/* 선택 병원 그래프 */}
        <div style={{ ...cardBox, padding: '12px 14px', minHeight: 420 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{selectedHospital?.hospitalName ?? '병원을 선택하세요'}</div>
            {selectedHospital ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                잔액 <b style={{ color: selectedHospital.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text)' }}>{num(selectedHospital.tokenBalance)}</b> 토큰
                {' · '}최근 {days}일 {usd(selectedHospital.costUsd)} (≈{krw(selectedHospital.costUsd)})
              </div>
            ) : null}
          </div>

          {runs.length === 0 ? (
            <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {loading ? '불러오는 중…' : selectedHospital ? '이 기간 사용 내역이 없습니다.' : '병원을 선택하세요.'}
            </div>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {runs.map((run, ri) => {
                const key = run.runId ?? 'none';
                const open = expanded.has(key);
                const label = groupLabel(run.items.map((i) => i.feature));
                const chargedTok = run.items.reduce((s, it) => s + tok(it.costUsd) * chargeMult(it.feature), 0);
                const who = [run.patientName, run.ownerName].filter(Boolean).join(' / ');
                return (
                  <div key={key} style={{ borderTop: ri ? '1px solid var(--border)' : 'none' }}>
                    <div
                      onClick={() => toggleRun(key)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 12px', cursor: 'pointer', background: open ? 'var(--bg-subtle, #f8fafc)' : '#fff' }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: 4 }}>{open ? '▼' : '▶'}</span>
                          {label}
                          {run.refunded ? <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-subtle)', padding: '1px 6px', borderRadius: 999 }}>바른플랜 환불</span> : null}
                          {run.friendlyId ? <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · #{run.friendlyId}</span> : null}
                          {who ? <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}> · {who}</span> : null}
                          {run.runId == null ? <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · (건 미귀속)</span> : null}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {run.lastUsed ? new Date(run.lastUsed).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : ''} · {run.items.length}개 항목 · {run.calls}회 호출
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{fmtTok(chargedTok)} 토큰</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{usd(run.costUsd)}</div>
                      </div>
                    </div>
                    {open ? (
                      <div style={{ padding: '4px 12px 10px 28px', background: 'var(--bg-subtle, #f8fafc)' }}>
                        {run.items.map((it, ii) => (
                          <div key={ii} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 12.5, borderTop: ii ? '1px dashed var(--border)' : 'none' }}>
                            <div style={{ color: 'var(--text-secondary)' }}>
                              {itemLabel(it.feature)}
                              <span style={{ color: 'var(--text-muted)' }}> · {it.provider} · {it.calls}회</span>
                            </div>
                            <div style={{ whiteSpace: 'nowrap', color: 'var(--text)' }}>
                              {fmtTok(tok(it.costUsd) * chargeMult(it.feature))} 토큰 <span style={{ color: 'var(--text-muted)' }}>({usd(it.costUsd)})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function banner(bg: string, color: string): React.CSSProperties {
  return { padding: 12, marginBottom: 12, fontSize: 12.5, background: bg, borderRadius: 8, color };
}
const cardBox: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 0, overflow: 'hidden' };
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' };
