'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { signInWithPasswordAction } from './actions';
import { PasswordInput } from '@/components/password-input';

function supabaseEnv(): { url: string; anon: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return null;
  return { url, anon };
}

type Props = { forbidden?: boolean };

const labelStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary)',
};

const inputBase: CSSProperties = {
  padding: '11px 2px',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border-strong)',
  borderRadius: 0,
  fontSize: 14,
  color: 'var(--text)',
  outline: 'none',
  transition: 'border-color 0.15s',
};

const noticeBase: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  padding: '10px 12px',
  borderRadius: 'var(--radius)',
  marginBottom: 16,
};

export function AdminLoginForm({ forbidden }: Props) {
  const configured = supabaseEnv();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabaseEnv()) {
      setMessage('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 를 설정하세요.');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const result = await signInWithPasswordAction(email, password);
      if (!result.ok) setMessage(result.error);
      /* 성공 시 서버 액션에서 redirect('/admin') — 클라이언트는 리다이렉트 응답으로 이동 */
    } finally {
      setLoading(false);
    }
  }

  function inputStyle(name: string): CSSProperties {
    if (focused !== name) return inputBase;
    return {
      ...inputBase,
      borderBottomColor: 'var(--accent)',
    };
  }

  return (
    <>
      {forbidden ? (
        <p
          role="status"
          style={{ ...noticeBase, color: 'var(--danger)', background: 'var(--danger-subtle)' }}
        >
          관리자만 이용할 수 있습니다. 다른 계정으로 로그인하거나 로그아웃 후 다시 시도하세요.{' '}
          <a href="/auth/signout" style={{ fontWeight: 700, textDecoration: 'underline' }}>
            로그아웃
          </a>
        </p>
      ) : null}
      {!configured ? (
        <p role="status" style={{ ...noticeBase, color: '#8a6d3b', background: '#fcf3d9' }}>
          빌드·실행 환경에 Supabase 공개 환경변수가 없습니다. Vercel 또는 <code>.env.local</code>을 확인하세요.
        </p>
      ) : null}
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
        <label style={labelStyle}>
          <span>이메일</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            onFocus={() => setFocused('email')}
            onBlur={() => setFocused(null)}
            required
            style={inputStyle('email')}
          />
        </label>
        <label style={labelStyle}>
          <span>비밀번호</span>
          <PasswordInput
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            onFocus={() => setFocused('password')}
            onBlur={() => setFocused(null)}
            required
            style={inputStyle('password')}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            padding: '12px',
            marginTop: 4,
            background: loading ? 'var(--accent)' : hover ? 'var(--accent-hover)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontWeight: 700,
            fontSize: 14,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.65 : 1,
            transition: 'background 0.15s, opacity 0.15s',
          }}
        >
          {loading ? '처리 중…' : '로그인'}
        </button>
      </form>
      {message ? (
        <p
          role="alert"
          style={{ ...noticeBase, marginTop: 16, marginBottom: 0, color: 'var(--danger)', background: 'var(--danger-subtle)' }}
        >
          {message}
        </p>
      ) : null}
    </>
  );
}
