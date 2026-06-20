'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { X, User, KeyRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Tab = 'basic' | 'password';

const MENU: { key: Tab; label: string; icon: typeof User }[] = [
  { key: 'basic', label: '사용자 정보', icon: User },
  { key: 'password', label: '비밀번호 변경', icon: KeyRound },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('basic');

  const [profile, setProfile] = useState({ name: '', phone: '', email: '' });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 모달이 열릴 때 기본 탭으로 + 프로필 로드
  useEffect(() => {
    if (!open) return;
    setTab('basic');
    setProfileMsg(null);
    setPwMsg(null);
    (async () => {
      setLoadingProfile(true);
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoadingProfile(false); return; }
        const { data } = await supabase.schema('core').from('users').select('name, phone').eq('id', user.id).single();
        const row = data as { name?: string | null; phone?: string | null } | null;
        setProfile({ name: row?.name ?? '', phone: row?.phone ?? '', email: user.email ?? '' });
      } catch { /* noop */ } finally {
        setLoadingProfile(false);
      }
    })();
  }, [open]);

  // Esc 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name, phone: profile.phone }),
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
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email;
      if (!email) throw new Error('로그인 정보를 확인할 수 없습니다.');
      // 현재 비밀번호 검증 — 같은 계정으로 재인증.
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInErr) { setPwMsg({ type: 'error', text: '현재 비밀번호가 올바르지 않습니다.' }); setSavingPw(false); return; }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPwMsg({ type: 'success', text: '비밀번호가 변경되었습니다.' });
      setCurrentPassword(''); setNewPassword(''); setNewPasswordConfirm('');
    } catch (err) {
      setPwMsg({ type: 'error', text: err instanceof Error ? err.message : '변경 실패' });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={dialog} role="dialog" aria-modal="true">
        <div style={dialogHeader}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>설정</span>
          <button onClick={onClose} title="닫기" style={closeBtn}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <nav style={leftMenu}>
            {MENU.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{ ...menuItem, color: active ? 'var(--accent)' : 'var(--text-secondary)', background: active ? 'var(--accent-subtle)' : 'transparent', fontWeight: active ? 600 : 400 }}
                >
                  <Icon size={15} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                  {label}
                </button>
              );
            })}
          </nav>

          <section style={content}>
            {tab === 'basic' && (
              loadingProfile ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
              ) : (
                <form onSubmit={(e) => void handleProfileSubmit(e)} style={formStyle}>
                  <Field label="이메일" hint="변경 불가">
                    <input value={profile.email} disabled style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'not-allowed' }} />
                  </Field>
                  <Field label="이름">
                    <input value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} style={inputStyle} placeholder="홍길동" />
                  </Field>
                  <Field label="연락처">
                    <input value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} style={inputStyle} placeholder="010-0000-0000" />
                  </Field>
                  {profileMsg && <Msg type={profileMsg.type} text={profileMsg.text} />}
                  <button type="submit" disabled={savingProfile} style={primaryBtn(savingProfile)}>
                    {savingProfile ? '저장 중…' : '저장'}
                  </button>
                </form>
              )
            )}

            {tab === 'password' && (
              <form onSubmit={(e) => void handlePasswordSubmit(e)} style={formStyle}>
                <Field label="현재 비밀번호">
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={inputStyle} placeholder="현재 비밀번호" autoComplete="current-password" />
                </Field>
                <Field label="새 비밀번호">
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} placeholder="6자 이상" autoComplete="new-password" />
                </Field>
                <Field label="새 비밀번호 확인">
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</label>
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
  position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const dialog: React.CSSProperties = {
  width: '100%', maxWidth: 560, height: 'min(460px, 80vh)', overflow: 'hidden',
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
  width: 160, flexShrink: 0, borderRight: '1px solid var(--border)',
  padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2,
};
const menuItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
  border: 'none', borderRadius: 'var(--radius)', fontSize: 13, textAlign: 'left', cursor: 'pointer', width: '100%',
};
const content: React.CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, padding: '20px 22px', overflowY: 'auto' };
const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', fontSize: 14, color: 'var(--text)',
  background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none',
};
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  alignSelf: 'flex-start', padding: '9px 18px', fontSize: 14, fontWeight: 600,
  color: '#fff', background: disabled ? 'var(--text-muted)' : 'var(--accent)',
  border: 'none', borderRadius: 'var(--radius)', cursor: disabled ? 'default' : 'pointer',
});
