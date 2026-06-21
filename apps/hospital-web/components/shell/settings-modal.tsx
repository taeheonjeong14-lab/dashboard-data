'use client';

import { useState, useEffect, useMemo, useCallback, type FormEvent } from 'react';
import { X, User, CreditCard, KeyRound, Coins, Users, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { createClient } from '@/lib/supabase/client';
import { inputStyle, primaryPillStyle, SegmentedToggle } from '@/lib/form-styles';
import { MembersPanel } from './members-panel';
import { SubscriptionPanel } from './subscription-panel';

type Tab = 'basic' | 'usage' | 'members' | 'payment' | 'payment_method' | 'password';

const FEATURE_LABEL: Record<string, string> = {
  extract: '추출', ocr: 'OCR', case_blog: '진료케이스',
  health_checkup: '건강검진', disease_intro: '질환소개', image_placement: '이미지배치', image_analysis: '이미지분석', assessment: 'AI평가', kakao_alimtalk: '알림톡',
  subscription: '운영 패키지',
};
// 진료케이스 블로그 단계(인과·진단치료세부·아웃라인·글)는 한 그룹 '진료케이스'로 합쳐 표시.
const CASE_BLOG_FEATURES = new Set(['blog_causal', 'blog_detail', 'blog_outline', 'blog_post']);
const normFeature = (f: string) => (CASE_BLOG_FEATURES.has(f) ? 'case_blog' : f);
const KIND_LABEL: Record<string, string> = { charge: '사용', grant: '관리자 지급', adjust: '조정' };
const featLabel = (f: string) => FEATURE_LABEL[normFeature(f)] ?? f;

// 사용량 그래프 — RPC(my_usage_overview)가 상품 "코드"(case_blog/health_report/survey/etc)를
// daily.feature 에 담아준다. 코드 → 한글 라벨·색 매핑. 새 상품 추가 시 여기에 한 줄만 추가하면 됨.
const PRODUCT: Record<string, { label: string; color: string }> = {
  case_blog: { label: '진료케이스', color: '#6366f1' },
  health_report: { label: '건강검진 리포트', color: '#10b981' },
  survey: { label: '사전문진', color: '#f59e0b' },
  ops_bundle: { label: '운영 패키지', color: '#3b82f6' },
  etc: { label: '기타', color: '#94a3b8' },
};
const productLabel = (c: string) => PRODUCT[c]?.label ?? c;
const productColor = (c: string) => PRODUCT[c]?.color ?? '#94a3b8';
// 토큰은 ledger 의 실제 차감 정수값을 그대로 표시(잔액·사용량·내역 전부 정수).
const fmtTok = (v: number) => Math.round(v).toLocaleString();
// 전액 환불되어 net 0 인 차감(진료케이스) 그룹은 '-0'(=차감 안 됨)으로 표기.
const isZeroCharge = (kind: string, tokens: number) => kind === 'charge' && Math.round(tokens) === 0;
const fmtGroupTokens = (kind: string, tokens: number) =>
  isZeroCharge(kind, tokens) ? '-0' : `${tokens > 0 ? '+' : ''}${fmtTok(tokens)}`;

// 한 작업(run) 안의 기능들 → 대표 라벨. 진료케이스(블로그 4단계) > 건강검진 > 이미지 > 평가 > 추출 순.
const CASE_FEATS = new Set(['blog_causal', 'blog_detail', 'blog_outline', 'blog_post', 'blog_images']);
function groupLabel(feats: Set<string>): string {
  const f = [...feats];
  if (f.some((x) => CASE_FEATS.has(x))) return '진료케이스';
  if (f.some((x) => x === 'health_checkup' || x === 'disease_intro')) return '건강검진';
  if (f.some((x) => x === 'image_analysis' || x === 'image_placement')) return '이미지분석';
  if (f.some((x) => x === 'assessment')) return 'AI평가';
  if (f.some((x) => x === 'extract' || x === 'ocr')) return '추출';
  return f[0] ? featLabel(f[0]) : '사용';
}

type OverviewDaily = { date: string; feature: string; tokens: number };
type OverviewLedger = { createdAt: string; kind: string; feature: string | null; tokens: number; balanceAfter: number | null; runId?: string | null; ownerName?: string | null; patientName?: string | null };
type Overview = { balance: number | null; daily: OverviewDaily[]; ledger: OverviewLedger[] };
// 내역을 작업(run) 단위로 묶은 행. charge 는 run_id 로 합산, grant/adjust·추출(run 없음)은 개별.
type LedgerGroup = { key: string; kind: string; label: string; createdAt: string; tokens: number; balanceAfter: number | null; steps: number; ownerName: string | null; patientName: string | null };

type HospitalSettings = {
  name: string;
  phone: string;
  address: string;
  addressDetail: string;
};

type Profile = {
  name: string;
  phone: string;
  customHospitalName: string;
  hospital_address: string;
  hospital_address_detail: string;
  email: string;
};

const MENU: { key: Tab; label: string; icon: typeof User; masterOnly?: boolean }[] = [
  { key: 'basic', label: '기본 정보', icon: User },
  { key: 'members', label: '조직 관리', icon: Users, masterOnly: true },
  { key: 'password', label: '비밀번호 변경', icon: KeyRound },
  { key: 'usage', label: '토큰 관리', icon: Coins, masterOnly: true },
  { key: 'payment', label: '이용권 구매', icon: CreditCard, masterOnly: true },
  { key: 'payment_method', label: '결제수단', icon: Wallet, masterOnly: true },
];

export function SettingsModal({ open, onClose, initialTab }: { open: boolean; onClose: () => void; tokenBalance?: number; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>('basic');
  const [isMaster, setIsMaster] = useState(false);

  // 모달이 열릴 때 요청한 탭으로 진입 (예: 상단바 토큰 박스 → '토큰 사용량')
  useEffect(() => {
    if (open) setTab(initialTab ?? 'basic');
  }, [open, initialTab]);

  const [profile, setProfile] = useState<Profile>({
    name: '', phone: '', customHospitalName: '', hospital_address: '', hospital_address_detail: '', email: '',
  });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 병원 레코드(병원명/주소 등) — 기본 정보 탭에서 읽기 전용으로 표시.
  const [hospital, setHospital] = useState<HospitalSettings | null>(null);

  const [usageDays, setUsageDays] = useState(30);
  const [usageSub, setUsageSub] = useState<'buy' | 'history'>('history');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [showLedger, setShowLedger] = useState(false); // '상세 내역 보기' 토글

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
        .select('name, phone, customHospitalName, hospital_address, hospital_address_detail, hospital_role')
        .eq('id', user.id)
        .single();
      const row = data as (Partial<Profile> & { hospital_role?: string | null }) | null;
      setIsMaster(row?.hospital_role === 'master');
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

  // 병원 레코드 로드 (기본 정보 탭의 읽기 전용 병원명/주소 표시용)
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch('/api/settings/hospital');
        const data = await res.json() as { ok?: boolean; hospital?: HospitalSettings | null };
        setHospital(data.hospital ?? null);
      } catch {
        setHospital(null);
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
    if (tab === 'usage') void loadOverview(usageDays);
  }, [open, tab, usageDays, loadOverview]);

  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const r of overview?.daily ?? []) {
      const row = byDate.get(r.date) ?? { date: r.date };
      const fk = r.feature || '기타'; // RPC 가 이미 상품명으로 집계해 줌
      row[fk] = ((row[fk] as number) ?? 0) + (Number(r.tokens) || 0);
      byDate.set(r.date, row);
    }
    return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  }, [overview]);
  const featureKeys = useMemo(() => [...new Set((overview?.daily ?? []).map((d) => d.feature || '기타'))], [overview]);

  // 사용·충전 내역을 작업(run) 단위로 그룹핑 — 건강검진/진료케이스 1건이 한 줄로 합쳐짐.
  const groupedLedger = useMemo<LedgerGroup[]>(() => {
    const out: LedgerGroup[] = [];
    const byRun = new Map<string, { g: LedgerGroup; feats: Set<string> }>();
    const byFeat = new Map<string, LedgerGroup>();
    for (const r of overview?.ledger ?? []) {
      const t = Number(r.tokens);
      // 같은 run 의 charge(차감)와 adjust(바른플랜 환불)를 한 그룹으로 묶어 net 만 보여준다.
      if ((r.kind === 'charge' || r.kind === 'adjust') && r.runId) {
        const hit = byRun.get(r.runId);
        if (hit) {
          // 행은 최신순 — 그룹의 날짜/잔액은 가장 최근(첫 등장) 값을 유지하고 토큰만 합산(net).
          hit.g.tokens += t;
          if (r.kind === 'charge') hit.g.steps += 1; // 단계 수는 실제 사용(charge)만 카운트
          if (r.feature) hit.feats.add(r.feature);
        } else {
          const g: LedgerGroup = { key: `run:${r.runId}`, kind: 'charge', label: '', createdAt: r.createdAt, tokens: t, balanceAfter: r.balanceAfter, steps: r.kind === 'charge' ? 1 : 0, ownerName: r.ownerName ?? null, patientName: r.patientName ?? null };
          byRun.set(r.runId, { g, feats: new Set(r.feature ? [r.feature] : []) });
          out.push(g);
        }
      } else if ((r.kind === 'charge' || r.kind === 'adjust') && r.feature) {
        // runId 없는 차감/환불(구독 월정액·알림톡 등)은 같은 날·같은 기능끼리 한 줄로 net 합산.
        // → 차감과 (바른플랜/번들) 환불이 항상 한 줄(-0)로 묶인다. '조정' 별도 줄을 만들지 않는다.
        const feat = normFeature(r.feature);
        const key = `feat:${feat}:${(r.createdAt || '').slice(0, 10)}`;
        const hit = byFeat.get(key);
        if (hit) {
          hit.tokens += t;
          if (r.kind === 'charge') hit.steps += 1;
        } else {
          const g: LedgerGroup = { key, kind: 'charge', label: featLabel(feat), createdAt: r.createdAt, tokens: t, balanceAfter: r.balanceAfter, steps: r.kind === 'charge' ? 1 : 0, ownerName: null, patientName: null };
          byFeat.set(key, g);
          out.push(g);
        }
      } else {
        out.push({
          key: `${r.kind}:${r.createdAt}:${out.length}`,
          kind: r.kind,
          label: r.kind === 'charge' ? featLabel(r.feature ?? '') : (KIND_LABEL[r.kind] ?? r.kind),
          createdAt: r.createdAt, tokens: t, balanceAfter: r.balanceAfter, steps: 1,
          ownerName: r.ownerName ?? null, patientName: r.patientName ?? null,
        });
      }
    }
    for (const { g, feats } of byRun.values()) g.label = groupLabel(feats);
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [overview]);

  if (!open) return null;

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    if (!profile.phone.trim()) {
      setProfileMsg({ type: 'error', text: '연락처를 입력해 주세요.' });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      // 병원명/주소/상세주소는 병원 레코드 기준(읽기 전용)이라 저장하지 않음 — 이름/연락처만 저장.
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profile.name,
          phone: profile.phone,
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

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (!currentPassword) { setPwMsg({ type: 'error', text: '현재 비밀번호를 입력해 주세요.' }); return; }
    if (newPassword.length < 6) { setPwMsg({ type: 'error', text: '새 비밀번호는 최소 6자 이상이어야 합니다.' }); return; }
    if (newPassword !== newPasswordConfirm) { setPwMsg({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' }); return; }
    setSavingPw(true);
    try {
      const supabase = createClient();
      // 현재 비밀번호 검증 — 같은 계정 이메일로 재인증해 본다. 틀리면 에러.
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email;
      if (!email) throw new Error('로그인 정보를 확인할 수 없습니다.');
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInErr) { setPwMsg({ type: 'error', text: '현재 비밀번호가 올바르지 않습니다.' }); setSavingPw(false); return; }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPwMsg({ type: 'success', text: '비밀번호가 변경되었습니다.' });
      setCurrentPassword('');
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
            {MENU.filter((m) => !m.masterOnly || isMaster).map(({ key, label, icon: Icon }) => {
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
            {tab === 'members' && isMaster && <MembersPanel />}
            {tab === 'basic' && (
              loadingProfile ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
              ) : (
                <form onSubmit={(e) => void handleProfileSubmit(e)} style={formStyle}>
                  <Field label="이메일" hint="변경 불가">
                    <input value={profile.email} disabled style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'not-allowed', borderBottomColor: 'var(--border)' }} />
                  </Field>
                  <Field label="이름" required>
                    <input value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} style={inputStyle} placeholder="홍길동" />
                  </Field>
                  <Field label="연락처" required>
                    <input value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} style={inputStyle} placeholder="010-0000-0000" required />
                  </Field>
                  <Field label="병원명" hint="관리자만 수정 가능">
                    <input value={hospital?.name ?? ''} disabled style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'not-allowed', borderBottomColor: 'var(--border)' }} />
                  </Field>
                  <Field label="병원 주소" hint="관리자만 수정 가능">
                    <input value={hospital?.address ?? ''} disabled style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'not-allowed', borderBottomColor: 'var(--border)' }} />
                  </Field>
                  <Field label="병원 상세 주소" hint="관리자만 수정 가능">
                    <input value={hospital?.addressDetail ?? ''} disabled style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'not-allowed', borderBottomColor: 'var(--border)' }} />
                  </Field>
                  {profileMsg && <Msg type={profileMsg.type} text={profileMsg.text} />}
                  <button type="submit" disabled={savingProfile} style={primaryBtn(savingProfile)}>
                    {savingProfile ? '저장 중…' : '저장'}
                  </button>
                </form>
              )
            )}

            {tab === 'usage' && isMaster && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 서브탭: 토큰 구매 | 사용 내역 */}
                <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
                  {([['buy', '토큰 구매'], ['history', '사용 내역']] as const).map(([k, lbl]) => (
                    <button key={k} type="button" onClick={() => setUsageSub(k)}
                      style={{ padding: '8px 12px', fontSize: 13.5, fontWeight: usageSub === k ? 700 : 500, color: usageSub === k ? 'var(--accent)' : 'var(--text-muted)', background: 'transparent', border: 'none', borderBottom: `2px solid ${usageSub === k ? 'var(--accent)' : 'transparent'}`, marginBottom: -1, cursor: 'pointer' }}>
                      {lbl}
                    </button>
                  ))}
                </div>

                {usageSub === 'buy' && (
                  <div style={{ minHeight: '32vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex', width: 48, height: 48, borderRadius: 14, background: 'var(--bg-raised)', alignItems: 'center', justifyContent: 'center' }}>
                      <Coins size={22} style={{ color: 'var(--text-muted)' }} />
                    </span>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>준비 중입니다</div>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      토큰 구매(충전)는 결제 연동(PG) 후 제공됩니다.
                    </p>
                  </div>
                )}

                {usageSub === 'history' && (
                <>
                {/* 1) 잔여 토큰 */}
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

                {/* 2) 날짜별/카테고리별 사용량 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <SegmentedToggle
                    options={['7일', '30일', '90일']}
                    value={`${usageDays}일`}
                    onChange={(v) => setUsageDays(Number(v.replace('일', '')))}
                    padX={16}
                  />
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
                        {featureKeys.map((fk) => (
                          <Bar key={fk} dataKey={fk} stackId="u" fill={productColor(fk)} name={productLabel(fk)} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                    기능별로 사용한 토큰을 날짜별로 보여줍니다. (알림톡 발송 토큰 포함)
                  </p>
                </div>

                {/* 3) 상세 내역 보기 토글 */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowLedger((v) => !v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', width: '100%',
                      border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)',
                      color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', justifyContent: 'space-between',
                    }}
                  >
                    <span>사용·충전 상세 내역</span>
                    <span style={{ color: 'var(--text-muted)' }}>{showLedger ? '접기 ▲' : '보기 ▼'}</span>
                  </button>
                  {showLedger && (
                    <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {groupedLedger.length === 0 ? (
                        <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                          {loadingOverview ? '불러오는 중…' : '내역이 없습니다.'}
                        </div>
                      ) : (
                        groupedLedger.map((g, i) => (
                          <div key={g.key} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                            padding: '8px 12px', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: 12.5,
                          }}>
                            <div style={{ minWidth: 0 }}>
                              <span style={{ fontWeight: 700, color: g.kind === 'charge' ? 'var(--text)' : 'var(--success)' }}>
                                {g.kind === 'charge' ? g.label : (KIND_LABEL[g.kind] ?? g.kind)}
                              </span>
                              {g.patientName || g.ownerName ? (
                                <span style={{ color: 'var(--text-secondary)' }}> · {[g.patientName, g.ownerName].filter(Boolean).join(' / ')}</span>
                              ) : null}
                              {g.kind === 'charge' && g.steps > 1 ? <span style={{ color: 'var(--text-muted)' }}> · {g.steps}단계</span> : null}
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {new Date(g.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: 700, color: isZeroCharge(g.kind, g.tokens) ? 'var(--danger)' : (g.tokens < 0 ? 'var(--danger)' : 'var(--success)') }}>
                                {fmtGroupTokens(g.kind, g.tokens)}
                              </div>
                              {g.balanceAfter != null ? (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>잔액 {fmtTok(Number(g.balanceAfter))}</div>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                </>
                )}
              </div>
            )}

            {tab === 'payment' && isMaster && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>구독</div>
                <SubscriptionPanel />
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  * 구독료는 보유 토큰에서 차감됩니다. 카드 등록·토큰 충전은 결제 연동(PG) 후 제공됩니다.
                </p>
              </div>
            )}

            {tab === 'payment_method' && isMaster && (
              <div style={{ minHeight: '40vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', width: 48, height: 48, borderRadius: 14, background: 'var(--bg-raised)', alignItems: 'center', justifyContent: 'center' }}>
                  <Wallet size={22} style={{ color: 'var(--text-muted)' }} />
                </span>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>준비 중입니다</div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  결제수단 등록 기능은 결제 연동(PG) 후 제공됩니다.
                </p>
              </div>
            )}

            {tab === 'password' && (
              <form onSubmit={(e) => void handlePasswordSubmit(e)} style={formStyle}>
                <Field label="현재 비밀번호" required>
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={inputStyle} placeholder="현재 비밀번호" autoComplete="current-password" />
                </Field>
                <Field label="새 비밀번호" required>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} placeholder="6자 이상" autoComplete="new-password" />
                </Field>
                <Field label="새 비밀번호 확인" required>
                  <input type="password" value={newPasswordConfirm} onChange={(e) => setNewPasswordConfirm(e.target.value)} style={inputStyle} placeholder="새 비밀번호 재입력" autoComplete="new-password" />
                </Field>
                {pwMsg && <Msg type={pwMsg.type} text={pwMsg.text} />}
                <button type="submit" disabled={savingPw || !currentPassword || !newPassword} style={primaryBtn(savingPw || !currentPassword || !newPassword)}>
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
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  ...primaryPillStyle(disabled),
  alignSelf: 'flex-start',
});
