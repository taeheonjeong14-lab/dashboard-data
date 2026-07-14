'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

type ApiUser = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  approved: boolean;
  rejected: boolean;
  active: boolean;
  hospitalId: string | null;
  customHospitalName: string | null;
  hospitalAddress: string | null;
  hospitalAddressDetail: string | null;
  createdAt: unknown;
  emailVerified?: boolean;
  hospitalRole?: string | null;
  hospital: { id: string; name: string | null } | null;
};

type HospitalOption = { id: string; name?: string };

// ---------------------------------------------------------------------------
// Shared style language (병원관리 메뉴와 동일)
// ---------------------------------------------------------------------------
const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  letterSpacing: '-0.02em',
  lineHeight: 1.3,
};
const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '5px 0',
  fontSize: 14,
  lineHeight: 1.45,
  background: 'transparent',
  border: 0,
  borderBottom: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: 0,
  outline: 'none',
  boxSizing: 'border-box',
};
const selectStyle: CSSProperties = { ...fieldStyle, padding: '6px 0', cursor: 'pointer' };
const twoColStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

function LabeledField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={fieldLabelStyle}>{label}</span>
      {hint ? <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.35, opacity: 0.8 }}>{hint}</span> : null}
      {children}
    </div>
  );
}

function DataCard({ title, desc, children, padding }: { title?: string; desc?: string; children: ReactNode; padding?: string }) {
  const hasHeader = !!(title || desc);
  return (
    <div style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: 10, padding: padding ?? '14px 16px' }}>
      {title ? <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</div> : null}
      {desc ? <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div> : null}
      <div style={{ display: 'grid', gap: 12, marginTop: hasHeader ? 12 : 0 }}>{children}</div>
    </div>
  );
}

// Buttons
const btnBase: CSSProperties = {
  padding: '5px 10px',
  fontSize: 14,
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  border: '1px solid transparent',
  background: 'none',
};
const btnPrimary: CSSProperties = { ...btnBase, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' };
const btnSecondary: CSSProperties = { ...btnBase, background: '#fff', color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' };
const btnDanger: CSSProperties = { ...btnBase, background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger-subtle)' };

function formatDate(raw: unknown): string {
  if (!raw) return '—';
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function StatusBadge({ user }: { user: ApiUser }) {
  const badges: { label: string; color: string; bg: string }[] = [];
  if (user.rejected) badges.push({ label: '거절됨', color: 'var(--danger)', bg: 'var(--danger-subtle)' });
  else if (user.approved) badges.push({ label: '승인됨', color: '#15803d', bg: 'rgba(34,197,94,0.12)' });
  else badges.push({ label: '승인 대기', color: '#b45309', bg: 'rgba(245,158,11,0.14)' });
  if (user.emailVerified === false) badges.push({ label: '이메일 미인증', color: 'var(--danger)', bg: 'var(--danger-subtle)' });
  if (!user.active) badges.push({ label: '비활성', color: 'var(--text-muted)', bg: 'var(--bg-subtle)' });
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {badges.map((b) => (
        <span
          key={b.label}
          style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 999, color: b.color, background: b.bg, whiteSpace: 'nowrap' }}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

/** 숫자만 입력해도 한국 전화번호 형태(010-1234-5678 등)로 포맷한다. */
function formatPhone(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  // 서울 지역번호(02)
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, d.length - 4)}-${d.slice(d.length - 4)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  // 휴대폰/기타(010, 070, 0XX 지역번호)
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(d.length - 4)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AdminUsersConsole() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [editForm, setEditForm] = useState({
    name: '',
    phone: '',
    active: true,
    hospitalId: '',
    customHospitalName: '',
    hospitalAddress: '',
    hospitalAddressDetail: '',
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = [
        u.email ?? '',
        u.name ?? '',
        u.phone ?? '',
        u.hospital?.name ?? '',
        u.hospitalId ?? '',
        u.customHospitalName ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, query]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setMessage('');
    try {
      const [usersRes, hospitalsRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/data/hospitals'),
      ]);

      const usersData = (await usersRes.json()) as { success?: boolean; users?: ApiUser[]; error?: string };
      if (!usersRes.ok || !usersData.success) throw new Error(usersData.error || '사용자 조회 실패');
      const list = usersData.users || [];
      setUsers(list);
      if (!selectedId && list[0]) selectUser(list[0]);

      const hospitalsData = (await hospitalsRes.json()) as { hospitals?: HospitalOption[]; error?: string };
      if (!hospitalsRes.ok) throw new Error(hospitalsData.error || '병원 목록 조회 실패');
      setHospitals(hospitalsData.hospitals || []);

      setMessage('');
    } catch (e) {
      setUsers([]);
      setHospitals([]);
      setMessage(`조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function approve(userId: string) {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/users/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || '승인 실패');
      setMessage('승인 완료');
      await refresh();
    } catch (e) {
      setMessage(`승인 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function reject(userId: string) {
    if (!confirm('정말 거절할까요? (Auth 사용자도 삭제됩니다)')) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/users/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || '거절 실패');
      setMessage('거절 완료');
      await refresh();
    } catch (e) {
      setMessage(`거절 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function softDelete(userId: string) {
    if (!confirm('정말 삭제할까요? (DB soft delete + Auth 삭제)')) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/delete`, { method: 'POST' });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || '삭제 실패');
      setMessage('삭제 완료');
      if (selectedId === userId) setSelectedId('');
      await refresh();
    } catch (e) {
      setMessage(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function sendPasswordReset(email: string | null | undefined) {
    if (!email) {
      setMessage('이메일이 없는 사용자입니다.');
      return;
    }
    if (!confirm(`${email} 주소로 비밀번호 재설정 메일을 보낼까요?`)) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || '메일 발송 실패');
      setMessage(`비밀번호 재설정 메일을 보냈습니다: ${email}`);
    } catch (e) {
      setMessage(`메일 발송 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function selectUser(user: ApiUser) {
    setSelectedId(user.id);
    setEditForm({
      name: user.name ?? '',
      phone: formatPhone(user.phone ?? ''),
      active: user.active,
      hospitalId: user.hospitalId ?? '',
      customHospitalName: user.customHospitalName ?? '',
      hospitalAddress: user.hospitalAddress ?? '',
      hospitalAddressDetail: user.hospitalAddressDetail ?? '',
    });
  }

  async function saveEdit() {
    if (!selectedId) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || '수정 실패');
      setMessage('사용자 정보 저장 완료');
      await refresh();
    } catch (e) {
      setMessage(`수정 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  const totalCount = users.length;
  const pendingCount = users.filter((u) => !u.approved && !u.rejected).length;
  const selectedUser = users.find((u) => u.id === selectedId) ?? null;

  return (
    <div>
      {/* 페이지 헤더 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>사용자 관리</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            전체 {totalCount}명{pendingCount > 0 ? ` · 승인 대기 ${pendingCount}명` : ''} — 사용자 정보·소속 병원·토큰·승인 상태를 관리합니다.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{loading ? '처리 중…' : message}</span>
          <button type="button" style={btnSecondary} onClick={() => void refresh()} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>

      {/* 좌우 split: 좌측 사용자 목록 / 우측 선택 사용자 상세 */}
      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', width: '100%' }}>
        {/* LEFT — 사용자 목록 */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·이메일·전화·병원 검색"
            aria-label="사용자 검색"
            disabled={loading}
            style={{ width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, background: '#fff', color: 'var(--text)', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
          />
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
            {filtered.map((u, i) => {
              const active = selectedId === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => selectUser(u)}
                  disabled={loading}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    border: 0,
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 0,
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: active ? 'var(--accent)' : 'var(--text)' }}>{u.name || '(이름 없음)'}</span>
                    <StatusBadge user={u} />
                  </span>
                  <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--text-muted)' }}>{u.email ?? '—'}</span>
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <div style={{ padding: '40px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>결과가 없습니다.</div>
            ) : null}
          </div>
        </div>

        {/* RIGHT — 선택한 사용자 상세/수정 */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', paddingLeft: 24 }}>
          {selectedUser ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {/* 선택 사용자 헤더 */}
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{selectedUser.name || '(이름 없음)'}</div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>
                  {selectedUser.email ?? '이메일 없음'} · 가입 {formatDate(selectedUser.createdAt)}
                </div>
              </div>

              {/* 상태 + 액션 */}
              <DataCard>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <StatusBadge user={selectedUser} />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!selectedUser.approved ? (
                      <button
                        type="button"
                        style={{ ...btnPrimary, ...(selectedUser.emailVerified === false ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                        onClick={() => void approve(selectedUser.id)}
                        disabled={loading || selectedUser.emailVerified === false}
                        title={selectedUser.emailVerified === false ? '이메일 인증을 완료해야 승인할 수 있습니다.' : undefined}
                      >
                        승인
                      </button>
                    ) : null}
                    {!selectedUser.rejected && !selectedUser.approved ? (
                      <button type="button" style={btnSecondary} onClick={() => void reject(selectedUser.id)} disabled={loading}>
                        거절
                      </button>
                    ) : null}
                    <button type="button" style={btnSecondary} onClick={() => void sendPasswordReset(selectedUser.email)} disabled={loading}>
                      비밀번호 재설정 메일
                    </button>
                    <button type="button" style={btnDanger} onClick={() => void softDelete(selectedUser.id)} disabled={loading}>
                      삭제
                    </button>
                  </div>
                </div>
              </DataCard>

              {/* 기본 정보 */}
              <DataCard title="기본 정보">
                <div style={twoColStyle}>
                  <LabeledField label="이름">
                    <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                  <LabeledField label="전화번호">
                    <input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))} inputMode="numeric" placeholder="01012345678" style={fieldStyle} />
                  </LabeledField>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editForm.active}
                    onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                    style={{ width: 15, height: 15 }}
                  />
                  활성 사용자 (체크 해제 시 로그인·이용 차단)
                </label>
              </DataCard>

              {/* 소속 병원 */}
              <DataCard title="소속 병원">
                <LabeledField label="연결 병원" hint="등록된 병원과 연결하거나 미지정으로 둘 수 있습니다.">
                  <select value={editForm.hospitalId} onChange={(e) => setEditForm((f) => ({ ...f, hospitalId: e.target.value }))} style={selectStyle}>
                    <option value="">병원 미지정</option>
                    {hospitals.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name || h.id} ({h.id})
                      </option>
                    ))}
                  </select>
                </LabeledField>
                <LabeledField label="커스텀 병원명" hint="등록 병원과 연결하지 않을 때 표시할 병원명">
                  <input value={editForm.customHospitalName} onChange={(e) => setEditForm((f) => ({ ...f, customHospitalName: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <div style={twoColStyle}>
                  <LabeledField label="병원 주소">
                    <input value={editForm.hospitalAddress} onChange={(e) => setEditForm((f) => ({ ...f, hospitalAddress: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                  <LabeledField label="상세주소">
                    <input value={editForm.hospitalAddressDetail} onChange={(e) => setEditForm((f) => ({ ...f, hospitalAddressDetail: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                </div>
              </DataCard>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" style={btnPrimary} onClick={() => void saveEdit()} disabled={loading}>
                  저장
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '64px 18px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>👤</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>선택된 사용자가 없습니다</div>
              <div style={{ fontSize: 14 }}>좌측 목록에서 사용자를 선택하세요.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
