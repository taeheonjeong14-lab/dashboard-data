'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { ddxPostPublic, ddxGetPublic } from '@/lib/ddx-api';

// 한국 전화번호 포맷 — 서울 02(2자리) / 그 외 지역번호·휴대폰(3자리) + 중간 3~4 + 끝 4.
function formatPhoneInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `02-${d.slice(2)}`;
    if (d.length <= 9) return `02-${d.slice(2, d.length - 4)}-${d.slice(d.length - 4)}`; // 02-XXX-XXXX
    return `02-${d.slice(2, 6)}-${d.slice(6, 10)}`; // 02-XXXX-XXXX
  }
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(d.length - 4)}`; // 0XX-XXX-XXXX
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`; // 010-XXXX-XXXX
}
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (s: string) => s.replace(/\D/g, '');

type DaumPostcodeInstance = { open: () => void };
type DaumNamespace = { Postcode: new (o: Record<string, unknown>) => DaumPostcodeInstance };
function loadDaumPostcode(): Promise<DaumNamespace> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { daum?: DaumNamespace };
    if (w.daum?.Postcode) return resolve(w.daum);
    const s = document.createElement('script');
    s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    s.onload = () => (w.daum ? resolve(w.daum) : reject(new Error('load fail')));
    s.onerror = () => reject(new Error('load fail'));
    document.head.appendChild(s);
  });
}

type Hospital = { id: string; name: string; address?: string | null };
type StepKey =
  | 'hIntro' | 'hName' | 'hPhone' | 'hAddr' | 'director' | 'bizCert' | 'vetCert'
  | 'masterIntro' | 'identity' | 'account' | 'review';

const NEW_STEPS: StepKey[] = ['hIntro', 'hName', 'hPhone', 'hAddr', 'director', 'bizCert', 'vetCert', 'masterIntro', 'identity', 'account', 'review'];
const STAFF_STEPS: StepKey[] = ['identity', 'account', 'review'];

export default function SignupPage() {
  const [mode, setMode] = useState<'search' | 'new' | 'staff'>('search');
  const [stepIdx, setStepIdx] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<null | 'new' | 'staff'>(null);

  // 검색
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hospital[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Hospital | null>(null);
  const [masterHint, setMasterHint] = useState<string | null>(null);

  // 병원
  const [hName, setHName] = useState('');
  const [hPhone, setHPhone] = useState('');
  const [addrBase, setAddrBase] = useState('');
  const [addrDetail, setAddrDetail] = useState('');
  const [directorName, setDirectorName] = useState('');
  const [directorPhone, setDirectorPhone] = useState('');
  const [bizFile, setBizFile] = useState<File | null>(null);
  const [vetFile, setVetFile] = useState<File | null>(null);

  // 가입자 본인 + 계정
  const [vName, setVName] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  // 인라인 이메일 인증(코드)
  const [emailVerified, setEmailVerified] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);

  const onEmailChange = (v: string) => { setEmail(v); setEmailVerified(false); setCodeSent(false); setCode(''); setCodeMsg(null); };
  const sendCode = async () => {
    if (!EMAIL_REGEX.test(email.trim())) { setCodeMsg('올바른 이메일을 입력해 주세요.'); return; }
    setCodeBusy(true); setCodeMsg(null);
    try {
      const r = await ddxPostPublic<{ success: boolean; error?: string }>('/api/email-verify/send', { email: email.trim() });
      if (!r.success) throw new Error(r.error ?? '인증번호 발송 실패');
      setCodeSent(true); setCodeMsg('인증번호를 이메일로 보냈습니다.');
    } catch (e) { setCodeMsg(e instanceof Error ? e.message : '발송 실패'); }
    finally { setCodeBusy(false); }
  };
  const checkCode = async () => {
    setCodeBusy(true); setCodeMsg(null);
    try {
      const r = await ddxPostPublic<{ success: boolean; error?: string }>('/api/email-verify/check', { email: email.trim(), code: code.trim() });
      if (!r.success) throw new Error(r.error ?? '인증 실패');
      setEmailVerified(true); setCodeMsg(null);
    } catch (e) { setCodeMsg(e instanceof Error ? e.message : '인증 실패'); }
    finally { setCodeBusy(false); }
  };

  const steps = mode === 'new' ? NEW_STEPS : STAFF_STEPS;
  const step = steps[stepIdx];

  const openDaum = async () => {
    try {
      const daum = await loadDaumPostcode();
      new daum.Postcode({
        oncomplete: (data: { roadAddress?: string; jibunAddress?: string }) => {
          setAddrBase(data.roadAddress || data.jibunAddress || '');
        },
      }).open();
    } catch {
      setMessage('주소 검색을 불러오지 못했습니다. 직접 입력해 주세요.');
    }
  };

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true); setMessage(null);
    try {
      const res = await ddxGetPublic<{ hospitals?: Hospital[] }>(`/api/hospitals/search?q=${encodeURIComponent(q)}`);
      setResults(res.hospitals ?? []);
      setSearched(true);
    } catch {
      setResults([]); setSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const pickHospital = async (h: Hospital) => {
    setSelected(h); setMasterHint(null); setMode('staff'); setStepIdx(0); setMessage(null);
    try {
      const res = await ddxGetPublic<{ masterEmail?: string | null }>(`/api/hospitals/master-hint?hospitalId=${encodeURIComponent(h.id)}`);
      setMasterHint(res.masterEmail ?? null);
    } catch { /* ignore */ }
  };
  const startNewHospital = () => { setHName(query.trim()); setMode('new'); setStepIdx(0); setMessage(null); };

  const canProceed = (): boolean => {
    switch (step) {
      case 'hIntro': return true;
      case 'masterIntro': return true;
      case 'hName': return hName.trim().length > 0;
      case 'hPhone': return digits(hPhone).length >= 8;
      case 'hAddr': return addrBase.trim().length > 0;
      case 'director': return directorName.trim().length > 0 && digits(directorPhone).length >= 10;
      case 'bizCert': return !!bizFile;
      case 'vetCert': return !!vetFile;
      case 'identity': return vName.trim().length > 0 && digits(vPhone).length >= 10;
      case 'account': return EMAIL_REGEX.test(email.trim()) && emailVerified && password.length >= 6 && password === passwordConfirm;
      case 'review': return true;
    }
  };

  const next = () => {
    if (!canProceed()) { setMessage('입력값을 확인해 주세요.'); return; }
    setMessage(null);
    if (stepIdx < steps.length - 1) setStepIdx((i) => i + 1);
  };
  const back = () => {
    setMessage(null);
    if (stepIdx === 0) { setMode('search'); return; }
    setStepIdx((i) => i - 1);
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
      email: email.trim(), password, options: { data: { name: vName.trim(), phone: vPhone.trim() } },
    });
    if (error) throw new Error(error.message);
    const userId = data.user?.id;
    if (!userId) throw new Error('가입 처리됐지만 사용자 ID를 받지 못했습니다.');
    await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return userId;
  }

  const submit = async () => {
    setLoading(true); setMessage(null);
    try {
      if (mode === 'new') {
        const supabase = createClient();
        const userId = await createAuthAndSignIn();
        const [bizCertPath, vetLicensePath] = await Promise.all([
          uploadDoc(supabase, 'biz', bizFile as File),
          uploadDoc(supabase, 'vet', vetFile as File),
        ]);
        const res = await ddxPostPublic<{ success: boolean; error?: string }>('/api/registrations', {
          userId, email: email.trim(),
          hospital: {
            name: hName.trim(), phone: hPhone.trim(), address: `${addrBase} ${addrDetail}`.trim(),
            directorName: directorName.trim(), directorPhone: directorPhone.trim(), bizCertPath, vetLicensePath,
          },
          verify: { phone: vPhone.trim(), name: vName.trim() },
        });
        if (!res.success) throw new Error(res.error ?? '신청 처리에 실패했습니다.');
        setSubmitted('new');
      } else if (mode === 'staff' && selected) {
        const userId = await createAuthAndSignIn();
        const res = await ddxPostPublic<{ success: boolean; error?: string }>('/api/registrations/staff', {
          userId, email: email.trim(), hospitalId: selected.id, verify: { phone: vPhone.trim(), name: vName.trim() },
        });
        if (!res.success) throw new Error(res.error ?? '가입 처리에 실패했습니다.');
        setSubmitted('staff');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // ── 완료 화면 ──
  if (submitted) {
    return (
      <Shell>
        <div style={{ ...box.msg, ...box.msgOk }}>
          {submitted === 'new'
            ? '병원 등록 신청이 접수되었습니다. 1~2일 내 심사 후 대표원장 휴대폰으로 결과를 알려드립니다. 승인되면 바로 로그인하실 수 있어요.'
            : '가입 신청이 접수되었습니다. 병원 관리자(Master)의 승인 후 이용하실 수 있습니다.'}
        </div>
        <p style={box.footer}><Link href="/login" style={box.link}>로그인으로</Link></p>
      </Shell>
    );
  }

  // ── 1단계: 병원 검색 ──
  if (mode === 'search') {
    return (
      <Shell subtitle="회원가입">
        <div style={{ display: 'grid', gap: 14 }}>
          <StepHead title="소속 병원을 검색해 주세요" desc="이미 등록된 병원이면 선택해 스태프로 가입하고, 없으면 새 병원으로 등록(대표원장/관리자)합니다." />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...box.input, flex: 1 }} value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }} placeholder="병원명 입력" autoFocus />
            <button type="button" onClick={() => void doSearch()} disabled={searching} style={{ ...box.btn, width: 'auto', padding: '11px 16px' }}>
              {searching ? '검색…' : '검색'}
            </button>
          </div>
          {searched && (
            <div style={{ display: 'grid', gap: 6 }}>
              {results.length > 0 ? results.map((h) => (
                <button key={h.id} type="button" onClick={() => void pickHospital(h)}
                  style={{ textAlign: 'left', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', cursor: 'pointer' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{h.name}</div>
                  {h.address && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{h.address}</div>}
                </button>
              )) : <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>검색 결과가 없습니다.</p>}
              <button type="button" onClick={startNewHospital}
                style={{ marginTop: 4, padding: '12px', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                + 내 병원이 없어요 — 새 병원 등록
              </button>
            </div>
          )}
        </div>
        <p style={box.footer}>이미 회원이신가요? <Link href="/login" style={box.link}>로그인</Link></p>
      </Shell>
    );
  }

  // ── 단계별 위저드 ──
  const progress = steps.length > 1 ? stepIdx / (steps.length - 1) : 0;
  const isLast = step === 'review';

  return (
    <Shell>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--accent)', transition: 'width .25s' }} />
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '10px 0 18px' }}>
        {mode === 'new' ? '새 병원 등록' : `${selected?.name ?? ''} · 스태프 가입`} · {stepIdx + 1} / {steps.length}
      </div>

      <div key={step} className="stepFade" style={{ display: 'grid', gap: 12, alignContent: 'start', minHeight: 180 }}>
        {step === 'hIntro' && (
          <Info title="반갑습니다 👋">
            더함의료마케팅의 동물병원 관리 솔루션에 오신 것을 환영합니다.<br /><br />
            현재 찾으시는 <b style={{ color: 'var(--text)' }}>{hName || '동물병원'}</b>은 아직 저희 시스템에 등록되어 있지 않습니다.<br /><br />
            먼저 병원 정보를 입력해 주시고, 직후에는 병원의 <b style={{ color: 'var(--text)' }}>마스터 계정</b>이 될 사용자의 정보를 수집할 예정입니다.
          </Info>
        )}
        {step === 'hName' && (<><StepHead title="병원명" /><input autoFocus style={box.input} value={hName} onChange={(e) => setHName(e.target.value)} placeholder="○○동물병원" /></>)}
        {step === 'hPhone' && (<><StepHead title="병원 전화번호" desc="대표 전화번호를 입력해 주세요." /><input autoFocus style={box.input} type="tel" value={hPhone} onChange={(e) => setHPhone(formatPhoneInput(e.target.value))} placeholder="02-000-0000" /></>)}
        {step === 'hAddr' && (
          <>
            <StepHead title="병원 주소" desc="주소 검색 후 상세주소를 입력해 주세요." />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...box.input, flex: 1 }} value={addrBase} readOnly placeholder="주소 검색을 눌러주세요" />
              <button type="button" onClick={() => void openDaum()} style={{ ...box.btn, width: 'auto', padding: '11px 16px' }}>주소 검색</button>
            </div>
            <input style={box.input} value={addrDetail} onChange={(e) => setAddrDetail(e.target.value)} placeholder="상세주소 (동/호 등)" />
          </>
        )}
        {step === 'director' && (
          <>
            <StepHead title="대표원장 정보" desc="대표원장님 성함과 휴대폰 번호를 입력해 주세요." />
            <input autoFocus style={box.input} value={directorName} onChange={(e) => setDirectorName(e.target.value)} placeholder="대표원장 성함" />
            <input style={box.input} type="tel" value={directorPhone} onChange={(e) => setDirectorPhone(formatPhoneInput(e.target.value))} placeholder="010-0000-0000" />
          </>
        )}
        {step === 'bizCert' && (<><StepHead title="사업자등록증" desc="PDF 또는 이미지 파일을 첨부해 주세요." /><FileDrop file={bizFile} onFile={setBizFile} accept=".pdf,image/*" /></>)}
        {step === 'vetCert' && (<><StepHead title="수의사 신고필증" desc="PDF 또는 이미지 파일을 첨부해 주세요." /><FileDrop file={vetFile} onFile={setVetFile} accept=".pdf,image/*" /></>)}
        {step === 'masterIntro' && (
          <Info title="마스터 계정 안내">
            이번에는 <b style={{ color: 'var(--text)' }}>{hName || '병원'}</b>의 <b style={{ color: 'var(--accent)' }}>마스터 계정</b> 생성을 위한 정보를 수집합니다.<br /><br />
            마스터 계정은 스태프 계정 초대·수락을 비롯해 병원 관련 모든 정보를 열람할 수 있는 계정이며, 병원을 최초 등록할 경우 마스터 계정을 반드시 함께 생성해야 합니다.
          </Info>
        )}
        {step === 'identity' && (
          <>
            <StepHead title={mode === 'new' ? '마스터 유저 정보' : '가입자 본인 정보'} desc={mode === 'new' ? '이 계정이 병원의 관리자(Master)가 됩니다. 가입 후 이메일 인증으로 본인 확인합니다.' : '가입 후 이메일 인증으로 본인 확인합니다.'} />
            <input autoFocus style={box.input} value={vName} onChange={(e) => setVName(e.target.value)} placeholder="이름" />
            <input style={box.input} type="tel" value={vPhone} onChange={(e) => setVPhone(formatPhoneInput(e.target.value))} placeholder="010-0000-0000" />
          </>
        )}
        {step === 'account' && (
          <>
            <StepHead title={mode === 'new' ? '마스터 유저 로그인 계정' : '로그인 계정'} desc="이메일 인증 후 비밀번호를 설정해 주세요." />
            <div style={{ display: 'flex', gap: 8 }}>
              <input autoFocus style={{ ...box.input, flex: 1 }} type="email" value={email} onChange={(e) => onEmailChange(e.target.value)} placeholder="you@example.com" disabled={emailVerified} />
              {emailVerified ? (
                <span style={{ alignSelf: 'center', fontSize: 13, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap' }}>✓ 인증됨</span>
              ) : (
                <button type="button" onClick={() => void sendCode()} disabled={codeBusy} style={{ ...box.btn, width: 'auto', padding: '11px 14px', whiteSpace: 'nowrap' }}>
                  {codeSent ? '재발송' : '인증하기'}
                </button>
              )}
            </div>
            {codeSent && !emailVerified && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...box.input, flex: 1 }} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="인증번호 6자리" />
                <button type="button" onClick={() => void checkCode()} disabled={codeBusy || code.length !== 6} style={{ ...box.btn, width: 'auto', padding: '11px 14px' }}>확인</button>
              </div>
            )}
            {codeMsg && <p style={{ margin: 0, fontSize: 12, color: emailVerified ? 'var(--success)' : 'var(--danger)' }}>{codeMsg}</p>}
            <input style={box.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 (6자 이상)" />
            <input style={box.input} type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} placeholder="비밀번호 확인" />
          </>
        )}
        {step === 'review' && (
          <>
            <StepHead title="입력 내용 확인" desc={mode === 'new' ? '아래 내용으로 병원 등록을 신청합니다.' : '아래 내용으로 가입을 신청합니다.'} />
            <div style={{ display: 'grid', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
              {mode === 'new' ? (
                <>
                  <Row k="병원" v={hName} /><Row k="전화" v={hPhone} /><Row k="주소" v={`${addrBase} ${addrDetail}`.trim()} />
                  <Row k="대표원장" v={`${directorName} (${directorPhone})`} />
                  <Row k="서류" v={`${bizFile ? '사업자등록증 ✓' : ''} ${vetFile ? '수의사신고필증 ✓' : ''}`} />
                  <Row k="관리자" v={`${vName} · ${email}`} />
                </>
              ) : (
                <><Row k="병원" v={selected?.name ?? ''} /><Row k="가입자" v={`${vName} · ${email}`} />{masterHint && <Row k="관리자(Master)" v={`${masterHint} · 승인 후 이용`} />}</>
              )}
            </div>
          </>
        )}
      </div>

      {message && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '12px 0 0' }}>{message}</p>}

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button type="button" onClick={back} style={box.btnSecondary}>이전</button>
        {isLast ? (
          <button type="button" onClick={() => void submit()} disabled={loading} style={{ ...box.btn, flex: 1, opacity: loading ? 0.6 : 1 }}>
            {loading ? '신청 중…' : (mode === 'new' ? '병원 등록 신청' : '스태프로 가입 신청')}
          </button>
        ) : (
          <button type="button" onClick={next} style={{ ...box.btn, flex: 1 }}>다음</button>
        )}
      </div>
    </Shell>
  );
}

function FileDrop({ file, onFile, accept }: { file: File | null; onFile: (f: File | null) => void; accept: string }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      style={{
        border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius)', background: drag ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
        padding: '28px 16px', textAlign: 'center', cursor: 'pointer', transition: 'background .15s, border-color .15s',
      }}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--success)' }}>✓ {file.name}</div>
          <button type="button" onClick={(e) => { e.stopPropagation(); onFile(null); }}
            style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            다른 파일 선택
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', fontWeight: 600 }}>파일을 끌어다 놓거나 클릭하여 선택</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>PDF 또는 이미지</div>
        </>
      )}
    </div>
  );
}

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</h2>
      <p style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{children}</p>
    </div>
  );
}

function StepHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</h2>
      {desc && <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{desc}</p>}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: 'flex', gap: 8 }}><span style={{ color: 'var(--text-muted)', minWidth: 84 }}>{k}</span><span style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{v || '—'}</span></div>;
}
function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div style={box.container}>
      <div style={box.card}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Image src="/logo-login.png" alt="THEHAMM" width={158} height={166} priority style={{ display: 'block', width: 170, height: 'auto', margin: '0 auto 10px' }} />
          {subtitle && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

const box: Record<string, React.CSSProperties> = {
  container: { display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-subtle)', padding: 16 },
  card: { width: '100%', maxWidth: 440, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 32, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', margin: '16px 0' },
  input: { width: '100%', padding: '11px 12px', fontSize: 15, background: 'var(--bg-subtle)', color: 'var(--text)', border: 'none', borderBottom: '2px solid var(--border-strong)', borderRadius: '8px 8px 0 0', outline: 'none', boxSizing: 'border-box' },
  btn: { padding: '12px 16px', fontSize: 14, fontWeight: 700, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer' },
  btnSecondary: { padding: '12px 16px', fontSize: 14, fontWeight: 600, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', cursor: 'pointer' },
  msg: { padding: '12px 14px', borderRadius: 'var(--radius)', fontSize: 13.5, lineHeight: 1.6 },
  msgOk: { background: 'var(--success-subtle)', color: 'var(--success)', border: '1px solid var(--success)' },
  footer: { marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' },
  link: { color: 'var(--accent)', fontWeight: 500 },
};
