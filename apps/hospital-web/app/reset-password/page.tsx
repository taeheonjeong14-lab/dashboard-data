'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  // 클라이언트는 한 번만 생성 — 마운트 시 URL 해시(#access_token...&type=recovery)를 자동 감지해 복구 세션을 설정한다.
  const [supabase] = useState(() => createClient());
  const [phase, setPhase] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let resolved = false;
    const markReady = () => {
      if (resolved) return;
      resolved = true;
      setPhase('ready');
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) markReady();
    });

    const cleanUrl = () => {
      if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
    };

    // 복구 링크가 실어 오는 토큰 형식은 Supabase 설정/템플릿에 따라 3가지일 수 있다. 모두 처리한다.
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    const hp = new URLSearchParams(hash);
    const qp = typeof window !== 'undefined' ? new URL(window.location.href).searchParams : new URLSearchParams();

    const accessToken = hp.get('access_token');
    const refreshToken = hp.get('refresh_token');
    const code = qp.get('code');
    const tokenHash = qp.get('token_hash');
    const otpType = qp.get('type'); // 보통 'recovery'
    const errorDesc = hp.get('error_description') || qp.get('error_description');

    if (errorDesc) {
      setPhase('invalid');
    } else if (accessToken && refreshToken) {
      // implicit flow — 해시 토큰
      void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
        if (error) setPhase('invalid'); else markReady();
        cleanUrl();
      });
    } else if (tokenHash) {
      // SSR 템플릿(token_hash) — verifyOtp는 PKCE verifier가 필요 없어 메일 클라이언트가 달라도 동작
      void supabase.auth.verifyOtp({ type: (otpType as 'recovery') || 'recovery', token_hash: tokenHash }).then(({ error }) => {
        if (error) setPhase('invalid'); else markReady();
        cleanUrl();
      });
    } else if (code) {
      // PKCE code
      void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setPhase('invalid'); else markReady();
        cleanUrl();
      });
    } else {
      // 토큰 없음 — 이미 복구 세션이 있는지(자동 감지/새로고침) 확인
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session) markReady();
        else {
          setTimeout(async () => {
            if (resolved) return;
            const { data: d2 } = await supabase.auth.getSession();
            if (d2.session) markReady();
            else setPhase('invalid');
          }, 1200);
        }
      });
    }

    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (password.length < 6) {
      setMessage({ type: 'error', text: '비밀번호는 6자 이상이어야 합니다.' });
      return;
    }
    if (password !== confirm) {
      setMessage({ type: 'error', text: '비밀번호가 일치하지 않습니다.' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: error.message });
      return;
    }
    setPhase('done');
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoArea}>
          <Image src="/logo-login.png" alt="THEHAMM" width={158} height={166} priority style={styles.logoImg} />
          <p style={styles.subtitle}>비밀번호 재설정</p>
        </div>

        {phase === 'checking' && (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>링크 확인 중…</p>
        )}

        {phase === 'invalid' && (
          <>
            <div style={{ ...styles.messageBox, ...styles.messageError }}>
              링크가 만료되었거나 유효하지 않습니다. 비밀번호 재설정 메일을 다시 요청해 주세요.
            </div>
            <p style={styles.footerText}>
              <Link href="/login" style={styles.link}>로그인으로 돌아가기</Link>
            </p>
          </>
        )}

        {phase === 'done' && (
          <>
            <div style={{ ...styles.messageBox, ...styles.messageSuccess, marginBottom: '16px' }}>
              비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.
            </div>
            <button
              type="button"
              style={styles.submitBtn}
              onClick={() => {
                void supabase.auth.signOut();
                router.push('/login');
              }}
            >
              로그인하러 가기
            </button>
          </>
        )}

        {phase === 'ready' && (
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.field}>
              <label htmlFor="pw" style={styles.label}>새 비밀번호</label>
              <input
                id="pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6자 이상"
                required
                minLength={6}
                autoComplete="new-password"
                style={styles.input}
              />
            </div>
            <div style={styles.field}>
              <label htmlFor="pw2" style={styles.label}>새 비밀번호 확인</label>
              <input
                id="pw2"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="새 비밀번호 재입력"
                required
                minLength={6}
                autoComplete="new-password"
                style={styles.input}
              />
            </div>
            {message && (
              <div style={{ ...styles.messageBox, ...(message.type === 'success' ? styles.messageSuccess : styles.messageError) }}>
                {message.text}
              </div>
            )}
            <button
              type="submit"
              disabled={saving}
              style={{ ...styles.submitBtn, ...(saving ? styles.submitBtnDisabled : {}) }}
            >
              {saving ? '변경 중…' : '비밀번호 변경'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-subtle)',
    padding: '16px',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '32px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  logoArea: { textAlign: 'center', marginBottom: '28px' },
  logoImg: { display: 'block', width: '190px', height: 'auto', margin: '0 auto 12px' },
  subtitle: { margin: 0, fontSize: '13px', color: 'var(--text-muted)' },
  form: { display: 'grid', gap: '16px' },
  field: { display: 'grid', gap: '6px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' },
  input: {
    width: '100%',
    padding: '9px 12px',
    fontSize: '14px',
    background: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius)',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  messageBox: { padding: '10px 12px', borderRadius: 'var(--radius)', fontSize: '13px', lineHeight: 1.5 },
  messageError: { background: 'var(--danger-subtle)', color: 'var(--danger)', border: '1px solid var(--danger)' },
  messageSuccess: { background: 'var(--success-subtle)', color: 'var(--success)', border: '1px solid var(--success)' },
  submitBtn: {
    width: '100%',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 600,
    background: 'var(--accent)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    transition: 'background 0.15s',
    marginTop: '4px',
  },
  submitBtnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  footerText: { marginTop: '20px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' },
  link: { color: 'var(--accent)', fontWeight: 500 },
};
