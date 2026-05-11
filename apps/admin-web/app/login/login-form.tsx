'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useState, type FormEvent } from 'react';

function supabaseEnv(): { url: string; anon: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) return null;
  return { url, anon };
}

type Props = { forbidden?: boolean };

export function AdminLoginForm({ forbidden }: Props) {
  const configured = supabaseEnv();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const env = supabaseEnv();
    if (!env) {
      setMessage('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 를 설정하세요.');
      return;
    }
    setLoading(true);
    setMessage(null);
    const supabase = createBrowserClient(env.url, env.anon);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    window.location.href = '/dashboard';
  }

  return (
    <>
      {forbidden ? (
        <p role="status" style={{ color: '#b00020', fontSize: '0.875rem', marginBottom: 16, lineHeight: 1.5 }}>
          관리자만 이용할 수 있습니다. 다른 계정으로 로그인하거나 로그아웃 후 다시 시도하세요.{' '}
          <a href="/auth/signout">로그아웃</a>
        </p>
      ) : null}
      <p style={{ fontSize: '0.875rem', color: '#555', lineHeight: 1.5 }}>
        Supabase 이메일·비밀번호 로그인입니다.
      </p>
      {!configured ? (
        <p role="status" style={{ color: '#856404', fontSize: '0.875rem', marginTop: 12 }}>
          빌드·실행 환경에 Supabase 공개 환경변수가 없습니다. Vercel 또는 <code>.env.local</code>을 확인하세요.
        </p>
      ) : null}
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: '0.8rem' }}>이메일</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            required
            style={{ padding: '8px 10px' }}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: '0.8rem' }}>비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            required
            style={{ padding: '8px 10px' }}
          />
        </label>
        <button type="submit" disabled={loading} style={{ padding: '10px 12px', marginTop: 8 }}>
          {loading ? '처리 중…' : '로그인'}
        </button>
      </form>
      {message ? (
        <p role="alert" style={{ color: '#b00020', marginTop: 16, fontSize: '0.875rem' }}>
          {message}
        </p>
      ) : null}
      <p style={{ marginTop: 24, fontSize: '0.8rem' }}>
        <a href="/">← 처음으로</a>
      </p>
    </>
  );
}
