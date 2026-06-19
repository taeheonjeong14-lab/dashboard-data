'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const msg = searchParams.get('message');
    if (msg) setMessage({ type: 'error', text: decodeURIComponent(msg) });
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;

      const userId = authData.user?.id;
      if (userId) {
        const { data: coreUser } = await supabase
          .schema('core')
          .from('users')
          .select('approved')
          .eq('id', userId)
          .single();

        if (coreUser && coreUser.approved === false) {
          await supabase.auth.signOut();
          setMessage({
            type: 'warning',
            text: '승인 대기 중입니다. 관리자 승인 후 이용 가능합니다.',
          });
          setLoading(false);
          return;
        }
      }

      router.push('/home');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '오류가 발생했습니다.';
      setMessage({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoArea}>
          <Image src="/logo-login.png" alt="THEHAMM" width={158} height={166} priority style={styles.logoImg} />
          <p style={styles.subtitle}>동물병원 통합 관리 플랫폼</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label htmlFor="email" style={styles.label}>이메일</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              style={styles.input}
              onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, styles.input)}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="password" style={styles.label}>비밀번호</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete="current-password"
              style={styles.input}
              onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, styles.input)}
            />
          </div>

          {message && (
            <div
              style={{
                ...styles.messageBox,
                ...(message.type === 'success'
                  ? styles.messageSuccess
                  : message.type === 'warning'
                  ? styles.messageWarning
                  : styles.messageError),
              }}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ ...styles.submitBtn, ...(loading ? styles.submitBtnDisabled : {}) }}
          >
            {loading ? '처리 중...' : '로그인'}
          </button>
        </form>

        <p style={styles.footerText}>
          아직 회원이 아니신가요?{' '}
          <Link href="/signup" style={styles.link}>회원가입</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={styles.container}>
          <div style={styles.card}>
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>로딩 중...</p>
          </div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
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
  logoArea: {
    textAlign: 'center',
    marginBottom: '28px',
  },
  logoImg: {
    display: 'block',
    width: '190px',
    height: 'auto',
    margin: '0 auto 12px',
  },
  subtitle: {
    margin: 0,
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
  form: {
    display: 'grid',
    gap: '16px',
  },
  field: {
    display: 'grid',
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  input: {
    width: '100%',
    padding: '9px 2px',
    fontSize: '14px',
    background: 'transparent',
    color: 'var(--text)',
    border: 'none',
    borderBottom: '1px solid var(--border-strong)',
    borderRadius: 0,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  inputFocus: {
    width: '100%',
    padding: '9px 2px',
    fontSize: '14px',
    background: 'transparent',
    color: 'var(--text)',
    border: 'none',
    borderBottom: '1px solid var(--accent)',
    borderRadius: 0,
    outline: 'none',
    boxShadow: '0 0 0 3px rgba(37,99,235,0.1)',
  },
  messageBox: {
    padding: '10px 12px',
    borderRadius: 'var(--radius)',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  messageError: {
    background: 'var(--danger-subtle)',
    color: 'var(--danger)',
    border: '1px solid var(--danger)',
  },
  messageWarning: {
    background: '#fffbeb',
    color: '#92400e',
    border: '1px solid #fcd34d',
  },
  messageSuccess: {
    background: 'var(--success-subtle)',
    color: 'var(--success)',
    border: '1px solid var(--success)',
  },
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
  submitBtnDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
  },
  footerText: {
    marginTop: '20px',
    textAlign: 'center',
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
  link: {
    color: 'var(--accent)',
    fontWeight: 500,
  },
};
