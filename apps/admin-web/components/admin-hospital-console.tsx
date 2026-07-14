'use client';

/**
 * 병원 관리 콘솔 — 기존 '병원 심사' · '병원 관리' · '토큰 관리' 세 메뉴를 하나로 합친 화면.
 *
 * 구조: 좌측에 하나의 목록(심사 대기 신청서 + 병원), 우측에 선택 대상별 화면.
 *  - 심사 대기 신청서 선택 → 심사 패널(승인/거절). 신청서는 아직 병원 레코드가 아니라 탭에 못 넣는다.
 *  - 병원 선택 → 탭: 정보·설정(AdminHospitalsManager) / 토큰(AdminUsageDashboard)
 * 두 하위 화면은 embedded 모드로 자기 좌측 목록을 그리지 않고, 선택 병원만 prop 으로 받는다.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import AdminHospitalsManager from '@/components/admin-hospitals-manager';
import AdminUsageDashboard from '@/components/admin-usage-dashboard';
import { RegistrationDetailPanel } from '@/components/admin-registrations';

type HospitalRow = { hospitalId: string | null; hospitalName: string; address?: string | null; tokenBalance: number };
type UsageResponse = { hospitals?: HospitalRow[]; error?: string };
type Registration = { id: string; hospital_name: string; director_name: string | null; di_conflict: boolean; created_at: string };
type Order = { id: string; hospital_id: string; status: string };

type Selection =
  | { kind: 'registration'; id: string }
  | { kind: 'hospital'; id: string }
  | { kind: 'new-hospital' }
  | null;

const num = (n: number) => Math.round(n).toLocaleString();

function shortAddress(a?: string | null): string {
  const t = (a ?? '').trim();
  if (!t) return '';
  return t.split(/\s+/).slice(0, 3).join(' ');
}

function badge(bg: string, color: string): CSSProperties {
  return { flexShrink: 0, fontSize: 11, fontWeight: 800, color, background: bg, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' };
}

export default function AdminHospitalConsole() {
  const [hospitals, setHospitals] = useState<HospitalRow[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection>(null);
  // 토큰 화면은 탭이 아니라 우측 상단 버튼 → 모달로 연다(설정 화면 안에 탭이 또 있어 2중 탭이 되던 문제).
  const [tokensOpen, setTokensOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [uRes, rRes, oRes] = await Promise.all([
        fetch('/api/admin/usage?days=30', { credentials: 'include' }),
        fetch('/api/admin/registrations?status=pending', { credentials: 'include' }),
        fetch('/api/admin/token-orders', { credentials: 'include' }),
      ]);
      const usage = (await uRes.json()) as UsageResponse;
      if (!uRes.ok) throw new Error(usage.error || '병원 목록을 불러오지 못했습니다.');
      setHospitals((usage.hospitals ?? []).filter((h) => h.hospitalId));

      const regs = (await rRes.json()) as { registrations?: Registration[] };
      setRegistrations(rRes.ok ? regs.registrations ?? [] : []);

      const ords = (await oRes.json()) as { orders?: Order[] };
      setOrders(oRes.ok ? ords.orders ?? [] : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const pendingOrdersByHospital = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) if (o.status === 'pending') m.set(o.hospital_id, (m.get(o.hospital_id) ?? 0) + 1);
    return m;
  }, [orders]);

  const filteredHospitals = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hospitals;
    return hospitals.filter((h) => `${h.hospitalName} ${h.address ?? ''}`.toLowerCase().includes(q));
  }, [hospitals, query]);

  const filteredRegistrations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return registrations;
    return registrations.filter((r) => `${r.hospital_name} ${r.director_name ?? ''}`.toLowerCase().includes(q));
  }, [registrations, query]);

  const selectedHospital =
    selection?.kind === 'hospital' ? hospitals.find((h) => h.hospitalId === selection.id) ?? null : null;

  return (
    <div className="adminLayout2WithMain">
      {/* 좌측: 심사 대기 + 병원 하나의 목록. 레일 고정·스크롤·검색창 모양은 공통 CSS(.adminLayoutSecondaryRail). */}
      <aside className="adminLayoutSecondaryRail" aria-label="병원 목록">
        <div className="adminRailToolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="병원 검색"
            aria-label="병원 검색"
          />
          {query.trim() ? (
            <button
              type="button"
              className="adminBtnFree"
              onClick={() => setQuery('')}
              aria-label="검색어 지우기"
              style={{ flexShrink: 0, display: 'flex', padding: 0, border: 0, background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={14} strokeWidth={2.4} />
            </button>
          ) : (
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-muted)' }}>
              {filteredHospitals.length + filteredRegistrations.length}곳
            </span>
          )}
        </div>

        {/* 남는 공간 전부를 목록에 주고 여기서만 스크롤 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          {/* 로딩·실패 상태를 레일에도 보여준다(목록이 말없이 텅 비면 원인을 알 수 없다). */}
          {loading ? (
            <p style={{ margin: 12, fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중…</p>
          ) : error ? (
            <div style={{ margin: 12, fontSize: 14, color: 'var(--danger)', lineHeight: 1.6 }}>
              목록을 불러오지 못했습니다.
              <div style={{ marginTop: 4, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{error}</div>
              <button
                type="button"
                className="adminLegacySmallBtn"
                onClick={() => void loadAll()}
                style={{ marginTop: 8 }}
              >
                다시 시도
              </button>
            </div>
          ) : null}

          {/* 심사 대기 신청서 — 섹션을 나누지 않고 같은 목록 맨 위에, '심사 대기' 스티커로 구분한다. */}
          {filteredRegistrations.map((r) => {
            const active = selection?.kind === 'registration' && selection.id === r.id;
            return (
              <div
                key={r.id}
                onClick={() => setSelection({ kind: 'registration', id: r.id })}
                style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: active ? 'var(--accent-subtle)' : 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.hospital_name}
                  </span>
                  {r.di_conflict ? <span style={badge('#fee2e2', '#b91c1c')}>DI중복</span> : null}
                  <span style={badge('#fef3c7', '#b45309')}>심사 대기</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.director_name || '원장 미입력'}
                </div>
              </div>
            );
          })}

          {filteredHospitals.map((h) => {
            const id = h.hospitalId!;
            const active = selection?.kind === 'hospital' && selection.id === id;
            const pending = pendingOrdersByHospital.get(id) ?? 0;
            return (
              <div
                key={id}
                onClick={() => setSelection({ kind: 'hospital', id })}
                style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: active ? 'var(--accent-subtle)' : 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h.hospitalName}
                  </span>
                  {pending > 0 ? <span style={badge('#fef3c7', '#b45309')}>입금대기 {pending}</span> : null}
                  <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: h.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
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
          {!loading && !error && filteredHospitals.length === 0 && filteredRegistrations.length === 0 ? (
            <div style={{ padding: 14, fontSize: 14, color: 'var(--text-muted)' }}>
              {query.trim() ? '검색 결과 없음' : '병원이 없습니다.'}
            </div>
          ) : null}
        </div>

        <div style={{ flexShrink: 0, padding: 10, borderTop: '1px solid var(--border)', background: '#fff' }}>
          <button
            type="button"
            className="adminLegacyPrimaryBtn"
            onClick={() => {
              setSelection({ kind: 'new-hospital' });
              setTokensOpen(false);
            }}
            style={{ width: '100%' }}
          >
            신규 병원 추가
          </button>
        </div>
      </aside>

      {/* 우측 */}
      <div className="adminLayoutMainPane">
        <div className="adminLayoutMainColumnInset">
          {/* 상단 요약 — 흩어져 있던 대기 건수를 한곳에서 */}
          {error ? <p style={{ fontSize: 14, color: 'var(--danger)', paddingTop: 16 }}>{error}</p> : null}

          {!selection ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)', paddingTop: 16 }}>
              좌측에서 병원 또는 심사 대기 신청을 선택하세요.
            </p>
          ) : selection.kind === 'registration' ? (
            <div style={{ display: 'grid', gap: 12, paddingTop: 16 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                  {registrations.find((r) => r.id === selection.id)?.hospital_name ?? '신청 상세'}
                </h1>
                <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                  심사 대기 신청 — 승인하면 병원이 생성됩니다.
                </p>
              </div>
              <RegistrationDetailPanel
                registrationId={selection.id}
                onProcessed={() => {
                  setSelection(null);
                  void loadAll();
                }}
              />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {/* 병원 헤더 — 이름·주소 + (우측) 토큰 버튼 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingTop: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                    {selection.kind === 'new-hospital' ? '신규 병원' : selectedHospital?.hospitalName ?? '(이름 없음)'}
                  </h1>
                  <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
                    {selection.kind === 'new-hospital' ? (
                      '정보를 입력하고 저장하세요.'
                    ) : (
                      <>
                        {selectedHospital?.address?.trim() || '주소 미입력'}
                        {selectedHospital ? (
                          <>
                            {' · 토큰 '}
                            <b style={{ color: selectedHospital.tokenBalance <= 0 ? 'var(--danger)' : 'var(--text)' }}>
                              {num(selectedHospital.tokenBalance)}
                            </b>
                          </>
                        ) : null}
                      </>
                    )}
                  </p>
                </div>

                {selection.kind === 'hospital' && selectedHospital ? (
                  <button
                    type="button"
                    className="adminLegacyPrimaryBtn"
                    onClick={() => setTokensOpen(true)}
                    title="토큰 사용 내역·지급·입금 확인"
                    style={{ flexShrink: 0 }}
                  >
                    토큰 관리
                  </button>
                ) : null}
              </div>

              <AdminHospitalsManager
                embedded
                hospitalId={selection.kind === 'hospital' ? selection.id : ''}
                onHospitalsChanged={() => void loadAll()}
              />
            </div>
          )}
        </div>
      </div>

      {/* 토큰 모달 — 사용 내역·지급·입금 확인 */}
      {tokensOpen && selection?.kind === 'hospital' ? (
        <div
          role="presentation"
          onClick={() => {
            setTokensOpen(false);
            void loadAll(); // 지급·입금확인으로 잔액이 바뀌었을 수 있다
          }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="토큰 내역"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(96vw, 980px)', background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 20, fontWeight: 800 }}>
                토큰 — {selectedHospital?.hospitalName ?? ''}
              </span>
              <button
                type="button"
                className="adminLegacySmallBtn"
                onClick={() => {
                  setTokensOpen(false);
                  void loadAll();
                }}
              >
                닫기
              </button>
            </div>
            <div style={{ padding: 16, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
              <AdminUsageDashboard embedded hospitalId={selection.id} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
