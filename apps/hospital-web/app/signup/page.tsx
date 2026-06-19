'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { ddxPostPublic, ddxGetPublic } from '@/lib/ddx-api';

function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.startsWith('010')) {
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const Required = () => <span style={{ color: 'var(--danger)' }}>*</span>;

type Hospital = { id: string; name: string; address?: string | null };
type Step = 'search' | 'new' | 'staff';

export default function SignupPage() {
  const [step, setStep] = useState<Step>('search');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<null | 'new' | 'staff'>(null);

  // 1단계: 병원 검색
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hospital[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // 선택(스태프) / 새 병원(마스터)
  const [selected, setSelected] = useState<Hospital | null>(null);
  const [masterHint, setMasterHint] = useState<string | null>(null);

  // 가입자 본인 이름·휴대폰 (현재 검증은 이메일 인증으로 — 휴대폰 본인인증은 PortOne 연동 후 적용)
  const [vName, setVName] = useState('');
  const [vPhone, setVPhone] = useState('');

  // 계정
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  // 새 병원 정보 (마스터)
  const [hName, setHName] = useState('');
  const [hPhone, setHPhone] = useState('');
  const [hAddress, setHAddress] = useState('');
  const [hEmail, setHEmail] = useState('');
  const [directorName, setDirectorName] = useState('');
  const [directorPhone, setDirectorPhone] = useState('');
  const [bizFile, setBizFile] = useState<File | null>(null);
  const [vetFile, setVetFile] = useState<File | null>(null);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setMessage(null);
    try {
      const res = await ddxGetPublic<{ hospitals?: Hospital[] }>(`/api/hospitals/search?q=${encodeURIComponent(q)}`);
      setResults(res.hospitals ?? []);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const pickHospital = async (h: Hospital) => {
    setSelected(h);
    setMasterHint(null);
    setStep('staff');
    try {
      const res = await ddxGetPublic<{ masterEmail?: string | null }>(`/api/hospitals/master-hint?hospitalId=${encodeURIComponent(h.id)}`);
      setMasterHint(res.masterEmail ?? null);
    } catch { /* hint 없으면 무시 */ }
  };

  const startNewHospital = () => {
    setHName(query.trim());
    setStep('new');
    setMessage(null);
  };

  async function uploadDoc(supabase: ReturnType<typeof createClient>, kind: 'biz' | 'vet', file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
    const signRes = await fetch('/api/registration-docs/sign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ext }),
    });
    const sign = (await signRes.json()) as { path?: string; token?: string; error?: string };
    if (!signRes.ok || !sign.path || !sign.token) throw new Error(sign.error ?? '파일 업로드 URL 발급 실패');
    const { error } = await supabase.storage.from('hospital-docs').uploadToSignedUrl(sign.path, sign.token, file);
    if (error) throw new Error(`파일 업로드 실패: ${error.message}`);
    return sign.path;
  }

  async function createAuthAndSignIn(): Promise<string> {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { name: vName.trim(), phone: vPhone.trim() } },
    });
    if (error) throw new Error(error.message);
    const userId = data.user?.id;
    if (!userId) throw new Error('가입 처리됐지만 사용자 ID를 받지 못했습니다.');
    // 파일 업로드/세션 필요 → 즉시 로그인(이메일 확인 비활성 전제)
    await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return userId;
  }

  const validAccount = () => {
    if (!EMAIL_REGEX.test(email.trim())) { setMessage({ type: 'error', text: '올바른 이메일 형식이 아닙니다.' }); return false; }
    if (password.length < 6) { setMessage({ type: 'error', text: '비밀번호는 최소 6자 이상이어야 합니다.' }); return false; }
    if (password !== passwordConfirm) { setMessage({ type: 'error', text: '비밀번호가 일치하지 않습니다.' }); return false; }
    if (!vName.trim() || vPhone.replace(/\D/g, '').length < 10) { setMessage({ type: 'error', text: '이름과 휴대폰 번호를 입력해 주세요.' }); return false; }
    return true;
  };

  const submitNew = async () => {
    setMessage(null);
    if (!hName.trim()) { setMessage({ type: 'error', text: '병원명을 입력해 주세요.' }); return; }
    if (!hEmail.trim()) { setMessage({ type: 'error', text: '병원 이메일을 입력해 주세요(심사 결과 통지용).' }); return; }
    if (!directorName.trim() || directorPhone.replace(/\D/g, '').length < 10) { setMessage({ type: 'error', text: '대표원장 성함과 휴대폰을 입력해 주세요.' }); return; }
    if (!bizFile || !vetFile) { setMessage({ type: 'error', text: '사업자등록증과 수의사신고필증을 모두 첨부해 주세요.' }); return; }
    if (!validAccount()) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const userId = await createAuthAndSignIn();
      const [bizCertPath, vetLicensePath] = await Promise.all([
        uploadDoc(supabase, 'biz', bizFile),
        uploadDoc(supabase, 'vet', vetFile),
      ]);
      const res = await ddxPostPublic<{ success: boolean; error?: string }>('/api/registrations', {
        userId, email: email.trim(),
        hospital: {
          name: hName.trim(), phone: hPhone.trim(), address: hAddress.trim(), email: hEmail.trim(),
          directorName: directorName.trim(), directorPhone: directorPhone.trim(), bizCertPath, vetLicensePath,
        },
        verify: { phone: vPhone.trim(), name: vName.trim() },
      });
      if (!res.success) throw new Error(res.error ?? '신청 처리에 실패했습니다.');
      setSubmitted('new');
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : '오류가 발생했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  const submitStaff = async () => {
    setMessage(null);
    if (!selected) return;
    if (!validAccount()) return;
    setLoading(true);
    try {
      const userId = await createAuthAndSignIn();
      const res = await ddxPostPublic<{ success: boolean; error?: string; code?: string }>('/api/registrations/staff', {
        userId, email: email.trim(), hospitalId: selected.id, verify: { phone: vPhone.trim(), name: vName.trim() },
      });
      if (!res.success) throw new Error(res.error ?? '가입 처리에 실패했습니다.');
      setSubmitted('staff');
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : '오류가 발생했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  // ── 완료 화면 ──
  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.logoArea}>
            <Image src="/logo-login.png" alt="THEHAMM" width={158} height={166} priority style={styles.logoImg} />
          </div>
          <div style={{ ...styles.messageBox, ...styles.messageSuccess }}>
            <b>가입하신 이메일로 인증 메일을 보냈습니다.</b> 메일의 링크를 눌러 인증을 완료해 주세요.
            <br /><br />
            {submitted === 'new'
              ? '또한 병원 등록 신청이 접수되었습니다. 1~2일 내 심사 후 병원 이메일과 대표원장 휴대폰으로 결과를 알려드립니다. 이메일 인증 + 병원 승인이 완료되면 로그인해 이용하실 수 있어요.'
              : '또한 병원 관리자(Master)의 승인이 필요합니다. 이메일 인증 + Master 승인이 완료되면 이용하실 수 있습니다.'}
          </div>
          <p style={styles.footerText}><Link href="/login" style={styles.link}>로그인으로</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoArea}>
          <Image src="/logo-login.png" alt="THEHAMM" width={158} height={166} priority style={styles.logoImg} />
          <p style={styles.subtitle}>회원가입</p>
        </div>

        {message && (
          <div style={{ ...styles.messageBox, ...(message.type === 'success' ? styles.messageSuccess : styles.messageError), marginBottom: 14 }}>
            {message.text}
          </div>
        )}

        {/* ── 1단계: 병원 검색 ── */}
        {step === 'search' && (
          <div style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>소속 병원 검색 <Required /></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...styles.input, flex: 1 }} value={query} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }} placeholder="병원명 입력" />
                <button type="button" onClick={() => void doSearch()} disabled={searching}
                  style={{ ...styles.submitBtn, width: 'auto', marginTop: 0, padding: '9px 16px' }}>
                  {searching ? '검색…' : '검색'}
                </button>
              </div>
            </div>

            {searched && (
              <div style={{ display: 'grid', gap: 6 }}>
                {results.length > 0 ? results.map((h) => (
                  <button key={h.id} type="button" onClick={() => void pickHospital(h)}
                    style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', cursor: 'pointer' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{h.name}</div>
                    {h.address && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{h.address}</div>}
                  </button>
                )) : (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0' }}>검색 결과가 없습니다.</p>
                )}
                <button type="button" onClick={startNewHospital}
                  style={{ marginTop: 4, padding: '10px', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  + 내 병원이 없어요 — 새 병원 등록(대표원장/관리자)
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 경로 A: 새 병원 + 마스터 ── */}
        {step === 'new' && (
          <div style={styles.form}>
            <SectionTitle>병원 정보 (심사 대상)</SectionTitle>
            <Field label="병원명" req><input style={styles.input} value={hName} onChange={(e) => setHName(e.target.value)} placeholder="○○동물병원" /></Field>
            <Field label="병원 전화"><input style={styles.input} value={hPhone} onChange={(e) => setHPhone(formatPhoneInput(e.target.value))} placeholder="02-000-0000" /></Field>
            <Field label="병원 주소"><input style={styles.input} value={hAddress} onChange={(e) => setHAddress(e.target.value)} placeholder="도로명 주소" /></Field>
            <Field label="병원 이메일" req><input style={styles.input} type="email" value={hEmail} onChange={(e) => setHEmail(e.target.value)} placeholder="hospital@example.com" /></Field>
            <Field label="대표원장 성함" req><input style={styles.input} value={directorName} onChange={(e) => setDirectorName(e.target.value)} placeholder="홍길동" /></Field>
            <Field label="대표원장 휴대폰" req><input style={styles.input} type="tel" value={directorPhone} onChange={(e) => setDirectorPhone(formatPhoneInput(e.target.value))} placeholder="010-0000-0000" /></Field>
            <Field label="사업자등록증" req><input type="file" accept=".pdf,image/*" onChange={(e) => setBizFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} /></Field>
            <Field label="수의사신고필증" req><input type="file" accept=".pdf,image/*" onChange={(e) => setVetFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} /></Field>

            <SectionTitle>관리자(Master) 계정</SectionTitle>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6 }}>이 계정이 병원의 <b style={{ color: 'var(--accent)' }}>마스터</b>가 됩니다.</div>
            {renderVerify()}
            <Field label="이메일(로그인)" req><input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
            <Field label="비밀번호" req><input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6자 이상" /></Field>
            <Field label="비밀번호 확인" req><input style={styles.input} type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} /></Field>

            <button type="button" onClick={() => void submitNew()} disabled={loading} style={{ ...styles.submitBtn, ...(loading ? styles.submitBtnDisabled : {}) }}>
              {loading ? '신청 중…' : '병원 등록 신청'}
            </button>
            <button type="button" onClick={() => setStep('search')} style={ghostLink}>← 병원 다시 검색</button>
          </div>
        )}

        {/* ── 경로 B: 스태프 ── */}
        {step === 'staff' && selected && (
          <div style={styles.form}>
            <div style={{ ...styles.messageBox, background: 'var(--bg-subtle)', color: 'var(--text)' }}>
              <b>{selected.name}</b>에 <b style={{ color: 'var(--accent)' }}>스태프</b>로 가입합니다.
              {masterHint && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>관리자(Master): {masterHint} · 승인 후 이용 가능</div>}
            </div>
            {renderVerify()}
            <Field label="이메일(로그인)" req><input style={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
            <Field label="비밀번호" req><input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6자 이상" /></Field>
            <Field label="비밀번호 확인" req><input style={styles.input} type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} /></Field>
            <button type="button" onClick={() => void submitStaff()} disabled={loading} style={{ ...styles.submitBtn, ...(loading ? styles.submitBtnDisabled : {}) }}>
              {loading ? '가입 중…' : '스태프로 가입 신청'}
            </button>
            <button type="button" onClick={() => setStep('search')} style={ghostLink}>← 병원 다시 검색</button>
          </div>
        )}

        <p style={styles.footerText}>이미 회원이신가요? <Link href="/login" style={styles.link}>로그인</Link></p>
      </div>
    </div>
  );

  // 가입자 본인 정보 (검증은 가입 후 이메일 인증으로)
  function renderVerify() {
    return (
      <div style={{ display: 'grid', gap: 8, padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-subtle)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>가입자 본인 정보 <Required /></div>
        <input style={styles.input} value={vName} onChange={(e) => setVName(e.target.value)} placeholder="이름" />
        <input style={styles.input} type="tel" value={vPhone} onChange={(e) => setVPhone(formatPhoneInput(e.target.value))} placeholder="010-0000-0000" />
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>※ 가입 후 이메일 인증으로 본인 확인합니다. (휴대폰 본인인증은 추후 적용)</div>
      </div>
    );
  }
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label} {req && <Required />}</label>
      {children}
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>{children}</div>;
}
const ghostLink: React.CSSProperties = { border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '4px' };

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-subtle)', padding: '16px' },
  card: { width: '100%', maxWidth: '400px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '32px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginTop: '16px', marginBottom: '16px' },
  logoArea: { textAlign: 'center', marginBottom: '24px' },
  logoImg: { display: 'block', width: '190px', height: 'auto', margin: '0 auto 12px' },
  subtitle: { margin: 0, fontSize: '13px', color: 'var(--text-muted)' },
  form: { display: 'grid', gap: '14px' },
  field: { display: 'grid', gap: '5px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' },
  input: { width: '100%', padding: '9px 2px', fontSize: '14px', background: 'transparent', color: 'var(--text)', border: 'none', borderBottom: '1px solid var(--border-strong)', borderRadius: 0, outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' },
  messageBox: { padding: '10px 12px', borderRadius: 'var(--radius)', fontSize: '13px', lineHeight: 1.5 },
  messageError: { background: 'var(--danger-subtle)', color: 'var(--danger)', border: '1px solid var(--danger)' },
  messageSuccess: { background: 'var(--success-subtle)', color: 'var(--success)', border: '1px solid var(--success)' },
  submitBtn: { width: '100%', padding: '10px 16px', fontSize: '14px', fontWeight: 600, background: 'var(--accent)', color: '#ffffff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', transition: 'background 0.15s', marginTop: '4px' },
  submitBtnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  footerText: { marginTop: '20px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' },
  link: { color: 'var(--accent)', fontWeight: 500 },
};
