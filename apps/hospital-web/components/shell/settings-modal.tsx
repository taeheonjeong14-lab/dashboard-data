'use client';

import { useState, useEffect, useMemo, useCallback, type FormEvent } from 'react';
import { X, User, CreditCard, KeyRound, Building2, BarChart3, Coins } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { createClient } from '@/lib/supabase/client';

type Tab = 'basic' | 'hospital' | 'usage' | 'tokens' | 'payment' | 'password';

// 1토큰=$0.01(원가 기준). 사용량 그래프는 원가를 토큰으로 환산해 표시.
const TOKEN_VALUE_USD = 0.01;
const FEATURE_LABEL: Record<string, string> = {
  extract: '추출', ocr: 'OCR', blog_causal: '블로그·인과', blog_outline: '블로그·아웃라인', blog_post: '블로그·글',
  health_checkup: '건강검진', disease_intro: '질환소개', image_placement: '이미지배치', image_analysis: '이미지분석', assessment: 'AI평가',
};
const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];
const KIND_LABEL: Record<string, string> = { charge: '사용', grant: '지급', adjust: '조정' };
const featLabel = (f: string) => FEATURE_LABEL[f] ?? f;
const fmtTok = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1));

type OverviewDaily = { date: string; feature: string; costUsd: number };
type OverviewLedger = { createdAt: string; kind: string; feature: string | null; tokens: number; balanceAfter: number | null };
type Overview = { balance: number | null; daily: OverviewDaily[]; ledger: OverviewLedger[] };

type HospitalSettings = {
  name: string;
  phone: string;
  address: string;
  chartType: string;
  vetCount: number | null;
};

const CHART_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '선택 안 함' },
  { value: 'woorien_pms', label: '우리엔PMS' },
  { value: 'intovet', label: '인투벳' },
  { value: 'efriends', label: '이프렌즈' },
];

type Profile = {
  name: string;
  phone: string;
  customHospitalName: string;
  hospital_address: string;
  hospital_address_detail: string;
  email: string;
};

const MENU: { key: Tab; label: string; icon: typeof User }[] = [
  { key: 'basic', label: '기본 정보', icon: User },
  { key: 'hospital', label: '병원 관리', icon: Building2 },
  { key: 'usage', label: '사용량', icon: BarChart3 },
  { key: 'tokens', label: '토큰 관리', icon: Coins },
  { key: 'payment', label: '결제수단', icon: CreditCard },
  { key: 'password', label: '비밀번호 변경', icon: KeyRound },
];

export function SettingsModal({ open, onClose, tokenBalance = 0 }: { open: boolean; onClose: () => void; tokenBalance?: number }) {
  const [tab, setTab] = useState<Tab>('basic');

  const [profile, setProfile] = useState<Profile>({
    name: '', phone: '', customHospitalName: '', hospital_address: '', hospital_address_detail: '', email: '',
  });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [hospital, setHospital] = useState<HospitalSettings | null>(null);
  const [loadingHospital, setLoadingHospital] = useState(true);
  const [savingHospital, setSavingHospital] = useState(false);
  const [hospitalMsg, setHospitalMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [usageDays, setUsageDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  const loadOverview = useCallback(async (days: number) => {
    setLoadingOverview(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.schema('core').rpc('my_usage_overview', { p_days: days });
      if (error) throw error;
      const o = (data ?? {}) as Partial<Overview>;
      setOverview({
        balance: o.balance == null ? null : Number(o.balance),
        daily: Array.isArray(o.daily) ? (o.daily as OverviewDaily[]) : [],
        ledger: Array.isArray(o.ledger) ? (o.ledger as OverviewLedger[]) : [],
      });
    } catch {
      setOverview({ balance: null, daily: [], ledger: [] });
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // 모달이 열릴 때 프로필 로드 + Esc 닫기
  useEffect(() => {
    if (!open) return;
    setProfileMsg(null);
    setPwMsg(null);
    (async () => {
      setLoadingProfile(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoadingProfile(false); return; }
      const { data } = await supabase
        .schema('core')
        .from('users')
        .select('name, phone, customHospitalName, hospital_address, hospital_address_detail')
        .eq('id', user.id)
        .single();
      const row = data as Partial<Profile> | null;
      setProfile({
        name: row?.name ?? '',
        phone: row?.phone ?? '',
        customHospitalName: row?.customHospitalName ?? '',
        hospital_address: row?.hospital_address ?? '',
        hospital_address_detail: row?.hospital_address_detail ?? '',
        email: user.email ?? '',
      });
      setLoadingProfile(false);
    })();
  }, [open]);

  // 병원 관리 정보 로드
  useEffect(() => {
    if (!open) return;
    setHospitalMsg(null);
    (async () => {
      setLoadingHospital(true);
      try {
        const res = await fetch('/api/settings/hospital');
        const data = await res.json() as { ok?: boolean; hospital?: HospitalSettings | null };
        setHospital(data.hospital ?? null);
      } catch {
        setHospital(null);
      } finally {
        setLoadingHospital(false);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 사용량/토큰 탭 데이터 — 열릴 때 + 기간 변경 시 로드
  useEffect(() => {
    if (!open) return;
    if (tab === 'usage' || tab === 'tokens') void loadOverview(usageDays);
  }, [open, tab, usageDays, loadOverview]);

  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const r of overview?.daily ?? []) {
      const row = byDate.get(r.date) ?? { date: r.date };
      row[r.feature] = ((row[r.feature] as number) ?? 0) + r.costUsd / TOKEN_VALUE_USD;
      byDate.set(r.date, row);
    }
    return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  }, [overview]);
  const featureKeys = useMemo(() => [...new Set((overview?.daily ?? []).map((d) => d.feature))], [overview]);

  if (!open) return null;

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profile.name,
          phone: profile.phone,
          customHospitalName: profile.customHospitalName,
          hospital_address: profile.hospital_address,
          hospital_address_detail: profile.hospital_address_detail,
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '저장 실패');
      setProfileMsg({ type: 'success', text: '저장되었습니다.' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err instanceof Error ? err.message : '저장 실패' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleHospitalSubmit(e: FormEvent) {
    e.preventDefault();
    if (!hospital) return;
    setSavingHospital(true);
    setHospitalMsg(null);
    try {
      const res = await fetch('/api/settings/hospital', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chartType: hospital.chartType, vetCount: hospital.vetCount }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '저장 실패');
      setHospitalMsg({ type: 'success', text: '저장되었습니다.' });
    } catch (err) {
      setHospitalMsg({ type: 'error', text: err instanceof Error ? err.message : '저장 실패' });
    } finally {
      setSavingHospital(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword.length < 6) { setPwMsg({ type: 'error', text: '새 비밀번호는 최소 6자 이상이어야 합니다.' }); return; }
    if (newPassword !== newPasswordConfirm) { setPwMsg({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' }); return; }
    setSavingPw(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPwMsg({ type: 'success', text: '비밀번호가 변경되었습니다.' });
      setNewPassword('');
      setNewPasswordConfirm('');
    } catch (err) {
      setPwMsg({ type: 'error', text: err instanceof Error ? err.message : '변경 실패' });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={dialog} role="dialog" aria-modal="true">
        {/* Header */}
        <div style={dialogHeader}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>설정</span>
          <button onClick={onClose} title="닫기" style={closeBtn}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left menu */}
          <nav style={leftMenu}>
            {MENU.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    ...menuItem,
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <Icon size={15} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                  {label}
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <section style={content}>
            {tab === 'basic' && (
              loadingProfile ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
              ) : (
                <form onSubmit={(e) => void handleProfileSubmit(e)} style={formStyle}>
                  <Field label="이메일" hint="변경 불가">
                    <input value={profile.email} disabled style={{ ...inputStyle, background: 'var(--bg-raised)', color: 'var(--text-muted)', cursor: 'not-allowed' }} />
                  </Field>
                  <Field label="이름" required>
                    <input value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} style={inputStyle} placeholder="홍길동" />
                  </Field>
                  <Field label="연락처">
                    <input value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} style={inputStyle} placeholder="010-0000-0000" />
                  </Field>
                  <Field label="병원명 (커스텀)" hint="비워두면 등록된 병원명 사용">
                    <input value={profile.customHospitalName} onChange={(e) => setProfile((p) => ({ ...p, customHospitalName: e.target.value }))} style={inputStyle} placeholder="뉴엘동물의료센터" />
                  </Field>
                  <Field label="병원 주소">
                    <input value={profile.hospital_address} onChange={(e) => setProfile((p) => ({ ...p, hospital_address: e.target.value }))} style={inputStyle} placeholder="서울특별시 강남구 …" />
                  </Field>
                  <Field label="병원 상세 주소">
                    <input value={profile.hospital_address_detail} onChange={(e) => setProfile((p) => ({ ...p, hospital_address_detail: e.target.value }))} style={inputStyle} placeholder="2층 201호" />
                  </Field>
                  {profileMsg && <Msg type={profileMsg.type} text={profileMsg.text} />}
                  <button type="submit" disabled={savingProfile} style={primaryBtn(savingProfile)}>
                    {savingProfile ? '저장 중…' : '저장'}
                  </button>
                </form>
              )
            )}

            {tab === 'hospital' && (
              loadingHospital ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
              ) : !hospital ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                  배정된 병원이 없습니다. 관리자에게 문의하세요.
                </p>
              ) : (
                <form onSubmit={(e) => void handleHospitalSubmit(e)} style={formStyle}>
                  <Field label="병원명" hint="관리자만 수정 가능">
                    <input value={hospital.name} disabled style={{ ...inputStyle, background: 'var(--bg-raised)', color: 'var(--text-muted)', cursor: 'not-allowed' }} />
                  </Field>
                  <Field label="병원 전화번호" hint="관리자만 수정 가능">
                    <input value={hospital.phone || '-'} disabled style={{ ...inputStyle, background: 'var(--bg-raised)', color: 'var(--text-muted)', cursor: 'not-allowed' }} />
                  </Field>
                  <Field label="병원 주소" hint="관리자만 수정 가능">
                    <input value={hospital.address || '-'} disabled style={{ ...inputStyle, background: 'var(--bg-raised)', color: 'var(--text-muted)', cursor: 'not-allowed' }} />
                  </Field>
                  <Field label="차트 종류">
                    <select
                      value={hospital.chartType}
                      onChange={(e) => setHospital((h) => (h ? { ...h, chartType: e.target.value } : h))}
                      style={inputStyle}
                    >
                      {CHART_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="수의사 수">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={hospital.vetCount ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setHospital((h) => (h ? { ...h, vetCount: v === '' ? null : Number(v) } : h));
                      }}
                      style={{ ...inputStyle, maxWidth: 140 }}
                      placeholder="예: 3"
                    />
                  </Field>
                  {hospitalMsg && <Msg type={hospitalMsg.type} text={hospitalMsg.text} />}
                  <button type="submit" disabled={savingHospital} style={primaryBtn(savingHospital)}>
                    {savingHospital ? '저장 중…' : '저장'}
                  </button>
                </form>
              )
            )}

            {tab === 'usage' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[7, 30, 90].map((d) => {
                    const active = usageDays === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setUsageDays(d)}
                        style={{
                          padding: '6px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                          background: active ? 'var(--accent-subtle)' : 'var(--bg)',
                          color: active ? 'var(--accent)' : 'var(--text-secondary)',
                        }}
                      >
                        최근 {d}일
                      </button>
                    );
                  })}
                </div>
                {loadingOverview && !overview ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
                ) : chartData.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>이 기간 사용 내역이 없습니다.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 11 }} width={40} label={{ value: '토큰', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                      <Tooltip formatter={(v) => `${fmtTok(Number(v))} 토큰`} contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {featureKeys.map((fk, i) => (
                        <Bar key={fk} dataKey={fk} stackId="u" fill={PALETTE[i % PALETTE.length]} name={featLabel(fk)} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                  기능별로 사용한 토큰을 날짜별로 보여줍니다.
                </p>
              </div>
            )}

            {tab === 'tokens' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  padding: '14px 16px', borderRadius: 'var(--radius)', background: 'var(--bg-raised)',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>현재 보유 토큰</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>
                    {overview?.balance == null ? '-' : fmtTok(overview.balance)}{' '}
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>토큰</span>
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  토큰은 AI 작업(차트 추출·리포트 생성·이미지 분석 등)에 사용한 만큼 차감됩니다.
                  충전·결제 연동은 추후 제공됩니다.
                </p>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>최근 내역</div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    {(overview?.ledger ?? []).length === 0 ? (
                      <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                        {loadingOverview ? '불러오는 중…' : '내역이 없습니다.'}
                      </div>
                    ) : (
                      overview!.ledger.map((l, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                          padding: '8px 12px', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: 12.5,
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 700, color: l.kind === 'charge' ? 'var(--text)' : 'var(--success)' }}>
                              {KIND_LABEL[l.kind] ?? l.kind}
                            </span>
                            {l.feature ? <span style={{ color: 'var(--text-muted)' }}> · {featLabel(l.feature)}</span> : null}
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {new Date(l.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 700, color: Number(l.tokens) < 0 ? 'var(--danger)' : 'var(--success)' }}>
                              {Number(l.tokens) > 0 ? '+' : ''}{fmtTok(Number(l.tokens))}
                            </div>
                            {l.balanceAfter != null ? (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>잔액 {fmtTok(Number(l.balanceAfter))}</div>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'payment' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  padding: '14px 16px', borderRadius: 'var(--radius)', background: 'var(--bg-raised)',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>현재 보유 토큰</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                    {tokenBalance.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>토큰</span>
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  보유 토큰·사용 내역은 <b>토큰 관리</b> 메뉴에서 확인할 수 있습니다.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>등록된 결제수단이 없습니다.</p>
                  <button disabled style={primaryBtn(true)}>결제수단 등록 / 토큰 충전 (준비 중)</button>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                    * 결제수단 등록 및 토큰 충전은 결제 연동(PG) 후 제공됩니다.
                  </p>
                </div>
              </div>
            )}

            {tab === 'password' && (
              <form onSubmit={(e) => void handlePasswordSubmit(e)} style={formStyle}>
                <Field label="새 비밀번호" required>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} placeholder="6자 이상" />
                </Field>
                <Field label="새 비밀번호 확인" required>
                  <input type="password" value={newPasswordConfirm} onChange={(e) => setNewPasswordConfirm(e.target.value)} style={inputStyle} placeholder="새 비밀번호 재입력" />
                </Field>
                {pwMsg && <Msg type={pwMsg.type} text={pwMsg.text} />}
                <button type="submit" disabled={savingPw || !newPassword} style={primaryBtn(savingPw || !newPassword)}>
                  {savingPw ? '변경 중…' : '비밀번호 변경'}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
        </label>
        {hint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Msg({ type, text }: { type: 'success' | 'error'; text: string }) {
  return (
    <p style={{
      margin: 0, fontSize: 13, padding: '8px 12px', borderRadius: 'var(--radius)',
      background: type === 'success' ? 'var(--success-subtle)' : 'var(--danger-subtle)',
      color: type === 'success' ? 'var(--success)' : 'var(--danger)',
      border: `1px solid ${type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
    }}>{text}</p>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const dialog: React.CSSProperties = {
  width: '100%', maxWidth: 720, height: 'min(600px, 85vh)', overflow: 'hidden',
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
};
const dialogHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 18px', borderBottom: '1px solid var(--border)',
};
const closeBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius)',
};
const leftMenu: React.CSSProperties = {
  width: 170, flexShrink: 0, borderRight: '1px solid var(--border)',
  padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2,
};
const menuItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
  border: 'none', borderRadius: 'var(--radius)', fontSize: 13, textAlign: 'left',
  cursor: 'pointer', width: '100%',
};
const content: React.CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, padding: '20px 22px', overflowY: 'auto' };
const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  alignSelf: 'flex-start', padding: '9px 20px',
  background: disabled ? 'var(--bg-raised)' : 'var(--accent)',
  color: disabled ? 'var(--text-muted)' : '#fff',
  border: 'none', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
});
