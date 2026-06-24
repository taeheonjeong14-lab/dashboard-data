'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { inputStyle, primaryPillStyle } from '@/lib/form-styles';
import { PasswordInput } from '@/components/password-input';

type Profile = {
  name: string;
  phone: string;
  customHospitalName: string;
  hospital_address: string;
  hospital_address_detail: string;
  email: string;
};

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile>({
    name: '',
    phone: '',
    customHospitalName: '',
    hospital_address: '',
    hospital_address_detail: '',
    email: '',
  });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .schema('core')
        .from('users')
        .select('name, phone, customHospitalName, hospital_address, hospital_address_detail')
        .eq('id', user.id)
        .single();

      const row = data as {
        name?: string | null;
        phone?: string | null;
        customHospitalName?: string | null;
        hospital_address?: string | null;
        hospital_address_detail?: string | null;
      } | null;

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
  }, []);

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
    } catch (e) {
      setProfileMsg({ type: 'error', text: e instanceof Error ? e.message : '저장 실패' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword.length < 6) {
      setPwMsg({ type: 'error', text: '새 비밀번호는 최소 6자 이상이어야 합니다.' });
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPwMsg({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' });
      return;
    }
    setSavingPw(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPwMsg({ type: 'success', text: '비밀번호가 변경되었습니다.' });
      setNewPassword('');
      setNewPasswordConfirm('');
    } catch (e) {
      setPwMsg({ type: 'error', text: e instanceof Error ? e.message : '변경 실패' });
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 36 }}>
      <div>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>설정</h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>계정 및 병원 정보를 수정합니다.</p>
      </div>

      {/* 기본 정보 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SectionTitle>기본 정보</SectionTitle>
        {loadingProfile ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
        ) : (
          <form onSubmit={(e) => void handleProfileSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="이메일" hint="변경 불가">
              <input value={profile.email} disabled style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'not-allowed', borderBottomColor: 'var(--border)' }} />
            </Field>
            <Field label="이름" required>
              <input
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                style={inputStyle}
                placeholder="홍길동"
              />
            </Field>
            <Field label="연락처">
              <input
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                style={inputStyle}
                placeholder="010-0000-0000"
              />
            </Field>
            <Field label="병원명 (커스텀)" hint="비워두면 등록된 병원명 사용">
              <input
                value={profile.customHospitalName}
                onChange={(e) => setProfile((p) => ({ ...p, customHospitalName: e.target.value }))}
                style={inputStyle}
                placeholder="뉴엘동물의료센터"
              />
            </Field>
            <Field label="병원 주소">
              <input
                value={profile.hospital_address}
                onChange={(e) => setProfile((p) => ({ ...p, hospital_address: e.target.value }))}
                style={inputStyle}
                placeholder="서울특별시 강남구 …"
              />
            </Field>
            <Field label="병원 상세 주소">
              <input
                value={profile.hospital_address_detail}
                onChange={(e) => setProfile((p) => ({ ...p, hospital_address_detail: e.target.value }))}
                style={inputStyle}
                placeholder="2층 201호"
              />
            </Field>

            {profileMsg && <Msg type={profileMsg.type} text={profileMsg.text} />}

            <button type="submit" disabled={savingProfile} style={primaryBtn(savingProfile)}>
              {savingProfile ? '저장 중…' : '저장'}
            </button>
          </form>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* 비밀번호 변경 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SectionTitle>비밀번호 변경</SectionTitle>
        <form onSubmit={(e) => void handlePasswordSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="새 비밀번호" required>
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
              placeholder="6자 이상"
            />
          </Field>
          <Field label="새 비밀번호 확인" required>
            <PasswordInput
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              style={inputStyle}
              placeholder="새 비밀번호 재입력"
            />
          </Field>

          {pwMsg && <Msg type={pwMsg.type} text={pwMsg.text} />}

          <button type="submit" disabled={savingPw || !newPassword} style={primaryBtn(savingPw || !newPassword)}>
            {savingPw ? '변경 중…' : '비밀번호 변경'}
          </button>
        </form>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</h2>
      <div style={{ height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
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
    }}>
      {text}
    </p>
  );
}


const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  ...primaryPillStyle(disabled),
  alignSelf: 'flex-start',
});
