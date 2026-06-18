'use client';

import { useCallback, useEffect, useState } from 'react';

const KRW_PER_USD = 1380;

type HospitalRow = {
  hospitalId: string | null;
  hospitalName: string;
  address: string | null;
  tokenBalance: number;
  costUsd: number;
  calls: number;
  lastUsed: string | null;
};
type UsageItem = { feature: string; provider: string; costUsd: number; calls: number; tokens: number };
type UsageRun = {
  runId: string | null; friendlyId: string | null; patientName: string | null; ownerName: string | null;
  lastUsed: string | null; costUsd: number; calls: number; tokens: number; refunded: boolean; items: UsageItem[];
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

// 토큰 사용량은 ledger 의 실제 차감 정수값을 그대로 표시(operation 단위 ceil + ×20 + 환불 반영).
const fmtTok = (v: number) => Math.round(v).toLocaleString();
const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
const krw = (v: number) => `₩${Math.round(v * KRW_PER_USD).toLocaleString()}`;
// 잔액도 정수 표시. (과거 round(.,2) 차감 시절의 소수 잔액 잔재가 있어 표시는 반올림 — 실제 정리는 SQL 백필 권장)
const num = (v: number) => Math.round(v).toLocaleString();
// 주소는 시/도 + 시/군/구 까지만 (예: "서울특별시 은평구", "경기도 성남시") — 레일에서 한 줄 유지.
const shortAddress = (addr: string | null) =>
  (addr ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join(' ');

export default function AdminUsageDashboard() {
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hospitalQuery, setHospitalQuery] = useState('');

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
  const hospitalsFiltered = (() => {
    const q = hospitalQuery.trim().toLowerCase();
    const all = data?.hospitals ?? [];
    if (!q) return all;
    return all.filter((h) => `${h.hospitalName} ${h.address ?? ''}`.toLowerCase().includes(q));
  })();
  const toggleRun = (key: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div className="adminLayout2WithMain">
      {/* 좌측 레일: 병원 목록 (full-bleed, 라인 구분) */}
      <aside className="adminLayoutSecondaryRail" aria-label="병원 목록">
        <div className="adminRailToolbar">
          <input
            type="search"
            value={hospitalQuery}
            onChange={(e) => setHospitalQuery(e.target.value)}
            placeholder="병원명·주소 검색"
            aria-label="병원 검색"
            style={{ flex: 1, minWidth: 0, padding: '8px 0', background: 'transparent', border: 0, borderRadius: 0, outline: 'none', font: 'inherit', fontSize: 13 }}
            disabled={loading}
          />
          {(data?.hospitals.length ?? 0) > 0 ? (
            <span style={{ flexShrink: 0, fontSize: 11.5, color: 'var(--text-muted)' }}>
              {hospitalQuery.trim() ? `${hospitalsFiltered.length} / ${data?.hospitals.length}` : `${data?.hospitals.length}`}곳
            </span>
          ) : null}
        </div>
        <div style={{ maxHeight: 'calc(100vh - var(--topbar-height) - 48px)', overflowY: 'auto' }}>
          {hospitalsFiltered.map((h) => {
            const active = h.hospitalId === selected;
            return (
              <div
                key={h.hospitalId ?? 'none'}
                onClick={() => h.hospitalId && setSelected(h.hospitalId)}
                style={{
                  padding: '10px 12px',
                  cursor: h.hospitalId ? 'pointer' : 'default',
                  borderBottom: '1px solid var(--border)',
                  background: active ? 'var(--accent-subtle)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h.hospitalName}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: h.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    {num(h.tokenBalance)}
                  </span>
                </div>
                {shortAddress(h.address) ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shortAddress(h.address)}
                  </div>
                ) : null}
              </div>
            );
          })}
          {(data?.hospitals.length ?? 0) === 0 && !loading ? (
            <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>병원이 없습니다.</div>
          ) : hospitalsFiltered.length === 0 ? (
            <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>검색 결과 없음</div>
          ) : null}
        </div>
      </aside>

      {/* 우측 메인: 선택 병원 사용 내역 */}
      <div className="adminLayoutMainPane">
        <div className="adminLayoutMainColumnInset">
          {/* 헤더 + 기간 선택 */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{selectedHospital?.hospitalName ?? '사용량'}</div>
              {selectedHospital ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  잔액 <b style={{ color: selectedHospital.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text)' }}>{num(selectedHospital.tokenBalance)}</b> 토큰
                  {' · '}최근 {days}일 {usd(selectedHospital.costUsd)} (≈{krw(selectedHospital.costUsd)})
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  병원을 고르면 작업(건)별 토큰 사용 내역을 봅니다. 각 건을 누르면 세부 항목이 펼쳐집니다.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
              {selectedHospital?.hospitalId ? (
                <button
                  type="button"
                  onClick={() => void grant(selectedHospital.hospitalId as string, selectedHospital.hospitalName, selectedHospital.tokenBalance)}
                  style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff' }}
                >
                  토큰 지급
                </button>
              ) : null}
            </div>
          </div>

          {data?.note ? (
            <div style={banner('var(--warning-subtle, #fef9c3)', 'var(--text-secondary)')}>{data.note}</div>
          ) : null}
          {error ? <div style={banner('var(--danger-subtle)', 'var(--danger)')}>{error}</div> : null}
          {anyZero ? (
            <div style={banner('var(--warning-subtle, #fef9c3)', 'var(--text-secondary)')}>
              잔액이 0 이하인 병원은 AI 작업이 차단됩니다. 해당 병원을 선택한 뒤 <b>토큰 지급</b> 으로 충전하세요.
            </div>
          ) : null}

          {/* 사용 내역 — 외곽 박스 없이 라인 구분만 */}
          {runs.length === 0 ? (
            <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {loading ? '불러오는 중…' : selectedHospital ? '이 기간 사용 내역이 없습니다.' : '병원을 선택하세요.'}
            </div>
          ) : (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {runs.map((run) => {
                const key = run.runId ?? 'none';
                const open = expanded.has(key);
                const label = groupLabel(run.items.map((i) => i.feature));
                const who = [run.patientName, run.ownerName].filter(Boolean).join(' / ');
                return (
                  <div key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                    <div
                      onClick={() => toggleRun(key)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 2px', cursor: 'pointer', background: open ? 'var(--bg-subtle, #f8fafc)' : 'transparent' }}
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
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {run.lastUsed ? new Date(run.lastUsed).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : ''} · {run.items.length}개 항목 · {run.calls}회 호출
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{fmtTok(run.tokens)} 토큰</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{usd(run.costUsd)}</div>
                      </div>
                    </div>
                    {open ? (
                      <div style={{ padding: '4px 2px 10px 24px', background: 'var(--bg-subtle, #f8fafc)' }}>
                        {run.items.map((it, ii) => (
                          <div key={ii} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 12.5, borderTop: ii ? '1px dashed var(--border)' : 'none' }}>
                            <div style={{ color: 'var(--text-secondary)' }}>
                              {itemLabel(it.feature)}
                              <span style={{ color: 'var(--text-muted)' }}>
                                {[it.provider, it.calls ? `${it.calls}회` : ''].filter(Boolean).map((s) => ` · ${s}`).join('')}
                              </span>
                            </div>
                            <div style={{ whiteSpace: 'nowrap', color: 'var(--text)' }}>
                              {fmtTok(it.tokens)} 토큰 <span style={{ color: 'var(--text-muted)' }}>({usd(it.costUsd)})</span>
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
