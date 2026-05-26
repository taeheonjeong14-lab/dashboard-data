'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { ddxPostPublic } from '@/lib/ddx-api';

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

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [hospitalName, setHospitalName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!EMAIL_REGEX.test(email.trim())) {
      setMessage({ type: 'error', text: '올바른 이메일 형식이 아닙니다.' });
      return;
    }
    if (password.length < 6) {
      setMessage({ type: 'error', text: '비밀번호는 최소 6자 이상이어야 합니다.' });
      return;
    }
    if (password !== passwordConfirm) {
      setMessage({ type: 'error', text: '비밀번호가 일치하지 않습니다.' });
      return;
    }
    if (!hospitalName.trim()) {
      setMessage({ type: 'error', text: '병원명을 입력해주세요.' });
      return;
    }
    if (!phone.trim()) {
      setMessage({ type: 'error', text: '연락처를 입력해주세요.' });
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data: signUpData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            hospital_name: hospitalName.trim(),
            phone: phone.trim(),
          },
        },
      });
      if (authError) throw authError;

      // Supabase 가입만으로는 core.users row 가 안 만들어지고 인증 메일도 안 나간다.
      // ddx-api /api/users/profile 가 (1) core.users upsert(approved=false, emailVerified=false)
      // (2) Resend 로 인증 메일 발송 둘 다 담당하므로 반드시 함께 호출한다.
      const newUserId = signUpData.user?.id;
      if (!newUserId) {
        throw new Error('가입은 처리됐지만 사용자 ID를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
      // 가입 직후엔 supabase 세션이 확립되지 않을 수 있어 /api/ddx(인증 필요)는 401 로 막힘.
      // /api/ddx-public 공개 프록시로 호출 — ddx-api 의 /api/users/profile 로 transparent 전달된다.
      await ddxPostPublic('/api/users/profile', {
        userId: newUserId,
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim(),
        customHospitalName: hospitalName.trim(),
      });

      setSubmitted(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '오류가 발생했습니다.';
      setMessage({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.logoArea}>
            <Image src="/logo-login.png" alt="THEHAMM" width={158} height={166} priority style={styles.logoImg} />
          </div>
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '36px', marginBottom: '16px' }}>📧</div>
            <h2 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
              이메일 인증 링크를 보냈습니다
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong>{email}</strong>로 전송된 인증 링크를 클릭해 가입을 완료해 주세요.
              이메일 인증 후 관리자 승인이 완료되면 로그인할 수 있습니다.
            </p>
            <Link href="/login" style={styles.submitBtnLink}>
              로그인 페이지로
            </Link>
          </div>
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

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label htmlFor="name" style={styles.label}>이름 <Required /></label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="홍길동"
              required
              style={styles.input}
              onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, styles.input)}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="email" style={styles.label}>이메일 <Required /></label>
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
            <label htmlFor="password" style={styles.label}>비밀번호 <Required /></label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete="new-password"
              style={styles.input}
              onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, styles.input)}
            />
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>최소 6자 이상</span>
          </div>

          <div style={styles.field}>
            <label htmlFor="passwordConfirm" style={styles.label}>비밀번호 확인 <Required /></label>
            <input
              id="passwordConfirm"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete="new-password"
              style={styles.input}
              onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, styles.input)}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="hospitalName" style={styles.label}>병원명 <Required /></label>
            <input
              id="hospitalName"
              type="text"
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              placeholder="○○동물병원"
              required
              style={styles.input}
              onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, styles.input)}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="phone" style={styles.label}>연락처 <Required /></label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="010-0000-0000"
              required
              style={styles.input}
              onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, styles.input)}
            />
          </div>

          {message && (
            <div
              style={{
                ...styles.messageBox,
                ...(message.type === 'success' ? styles.messageSuccess : styles.messageError),
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
            {loading ? '처리 중...' : '회원가입'}
          </button>
        </form>

        <p style={styles.footerText}>
          이미 회원이신가요?{' '}
          <Link href="/login" style={styles.link}>로그인</Link>
        </p>
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
    marginTop: '16px',
    marginBottom: '16px',
  },
  logoArea: {
    textAlign: 'center',
    marginBottom: '24px',
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
    gap: '14px',
  },
  field: {
    display: 'grid',
    gap: '5px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
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
  inputFocus: {
    width: '100%',
    padding: '9px 12px',
    fontSize: '14px',
    background: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius)',
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
  submitBtnLink: {
    display: 'inline-block',
    padding: '9px 20px',
    fontSize: '14px',
    fontWeight: 600,
    background: 'var(--accent)',
    color: '#ffffff',
    borderRadius: 'var(--radius)',
    textDecoration: 'none',
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
