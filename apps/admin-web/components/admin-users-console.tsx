'use client';

import { useEffect, useMemo, useState } from 'react';

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
  hospital: { id: string; name: string | null } | null;
};

type HospitalOption = { id: string; name?: string };
type Tab = 'pending' | 'all';

export default function AdminUsersConsole() {
  const [tab, setTab] = useState<Tab>('pending');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [query, setQuery] = useState('');
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
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
        fetch(tab === 'pending' ? '/api/admin/users/pending' : '/api/admin/users'),
        fetch('/api/admin/data/hospitals'),
      ]);

      const usersData = (await usersRes.json()) as { success?: boolean; users?: ApiUser[]; error?: string; pendingCount?: number };
      if (!usersRes.ok || !usersData.success) throw new Error(usersData.error || '사용자 조회 실패');
      setUsers(usersData.users || []);

      const hospitalsData = (await hospitalsRes.json()) as { hospitals?: HospitalOption[]; error?: string };
      if (!hospitalsRes.ok) throw new Error(hospitalsData.error || '병원 목록 조회 실패');
      setHospitals(hospitalsData.hospitals || []);

      if (tab === 'pending') {
        setMessage(`승인 대기 ${usersData.pendingCount ?? usersData.users?.length ?? 0}명`);
      } else {
        setMessage(`전체 사용자 ${usersData.users?.length ?? 0}명 로드 완료`);
      }
    } catch (e) {
      setUsers([]);
      setHospitals([]);
      setMessage(`조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tab]);

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
      await refresh();
    } catch (e) {
      setMessage(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function grantTokens(userId: string) {
    const input = window.prompt('지급할 토큰 수를 입력하세요 (1토큰=100원)');
    if (input == null) return;
    const amount = Math.trunc(Number(input.trim()));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('토큰 수는 양의 정수여야 합니다.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = (await res.json()) as { success?: boolean; balance?: number; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || '토큰 지급 실패');
      setMessage(`토큰 ${amount} 지급 완료 (현재 잔액: ${data.balance ?? '?'})`);
      await refresh();
    } catch (e) {
      setMessage(`토큰 지급 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function openEdit(user: ApiUser) {
    setEditingUser(user);
    setEditForm({
      name: user.name ?? '',
      phone: user.phone ?? '',
      active: user.active,
      hospitalId: user.hospitalId ?? '',
      customHospitalName: user.customHospitalName ?? '',
      hospitalAddress: user.hospitalAddress ?? '',
      hospitalAddressDetail: user.hospitalAddressDetail ?? '',
    });
  }

  function closeEdit() {
    setEditingUser(null);
  }

  async function saveEdit() {
    if (!editingUser) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(editingUser.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || '수정 실패');
      setMessage('사용자 정보 저장 완료');
      closeEdit();
      await refresh();
    } catch (e) {
      setMessage(`수정 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="adminLegacyPage" style={{ padding: 0 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          className={tab === 'pending' ? 'adminLegacyPrimaryBtn' : 'adminLegacySecondaryBtn'}
          onClick={() => setTab('pending')}
          disabled={loading}
        >
          승인 대기
        </button>
        <button
          type="button"
          className={tab === 'all' ? 'adminLegacyPrimaryBtn' : 'adminLegacySecondaryBtn'}
          onClick={() => setTab('all')}
          disabled={loading}
        >
          전체 사용자
        </button>
      </div>
      <div className="adminLegacyActions" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이메일/이름/전화/병원 검색"
            style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-strong)', width: 320 }}
            disabled={loading}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="adminLegacySecondaryBtn" onClick={() => void refresh()} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      <div className="adminLegacyStatus">{loading ? '처리 중...' : message || '준비'}</div>

      <section className="adminLegacyPanel">
        <h2>{tab === 'pending' ? '승인 대기 사용자' : '전체 사용자'}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>이메일</th>
                <th>이름</th>
                <th>전화</th>
                <th>승인</th>
                <th>거절</th>
                <th>활성</th>
                <th>병원</th>
                <th style={{ width: 300 }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td title={u.id}>{u.email ?? ''}</td>
                  <td>{u.name ?? ''}</td>
                  <td>{u.phone ?? ''}</td>
                  <td>{u.approved ? 'Y' : ''}</td>
                  <td>{u.rejected ? 'Y' : ''}</td>
                  <td>{u.active ? 'Y' : ''}</td>
                  <td>
                    {u.hospital?.name ?? ''}
                    {u.hospitalId ? (
                      <span style={{ opacity: 0.7 }}> ({u.hospitalId})</span>
                    ) : u.customHospitalName ? (
                      <span style={{ opacity: 0.85 }}> ({u.customHospitalName})</span>
                    ) : null}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {!u.approved ? (
                        <button
                          type="button"
                          className="adminLegacyPrimaryBtn"
                          onClick={() => void approve(u.id)}
                          disabled={loading}
                        >
                          승인
                        </button>
                      ) : null}
                      {!u.rejected && !u.approved ? (
                        <button
                          type="button"
                          className="adminLegacySecondaryBtn"
                          onClick={() => void reject(u.id)}
                          disabled={loading}
                        >
                          거절
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="adminLegacySecondaryBtn"
                        onClick={() => openEdit(u)}
                        disabled={loading}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="adminLegacySecondaryBtn"
                        onClick={() => void grantTokens(u.id)}
                        disabled={loading}
                      >
                        토큰 지급
                      </button>
                      <button
                        type="button"
                        className="adminLegacySecondaryBtn"
                        onClick={() => void softDelete(u.id)}
                        disabled={loading}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ opacity: 0.7 }}>
                    결과가 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {editingUser ? (
        <div className="adminLegacyModalBackdrop" onClick={closeEdit} role="presentation">
          <div className="adminLegacyModalCard" onClick={(e) => e.stopPropagation()} role="dialog">
            <h3>사용자 수정</h3>
            <div className="adminLegacyModalForm">
              <input value={editingUser.id} disabled readOnly />
              <input value={editingUser.email ?? ''} disabled readOnly />
              <input
                placeholder="이름"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                placeholder="전화번호"
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={editForm.active}
                  onChange={(e) => setEditForm((f) => ({ ...f, active: e.target.checked }))}
                />
                active
              </label>
              <select
                value={editForm.hospitalId}
                onChange={(e) => setEditForm((f) => ({ ...f, hospitalId: e.target.value }))}
              >
                <option value="">병원 미지정</option>
                {hospitals.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name || h.id} ({h.id})
                  </option>
                ))}
              </select>
              <input
                placeholder="custom hospital name"
                value={editForm.customHospitalName}
                onChange={(e) => setEditForm((f) => ({ ...f, customHospitalName: e.target.value }))}
              />
              <input
                placeholder="hospital address"
                value={editForm.hospitalAddress}
                onChange={(e) => setEditForm((f) => ({ ...f, hospitalAddress: e.target.value }))}
              />
              <input
                placeholder="hospital address detail"
                value={editForm.hospitalAddressDetail}
                onChange={(e) => setEditForm((f) => ({ ...f, hospitalAddressDetail: e.target.value }))}
              />
              <div className="adminLegacyModalActions">
                <button type="button" onClick={closeEdit}>
                  취소
                </button>
                <button type="button" onClick={() => void saveEdit()} disabled={loading}>
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

