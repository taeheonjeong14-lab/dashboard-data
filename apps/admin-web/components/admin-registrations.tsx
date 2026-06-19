'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

type Reg = {
  id: string;
  hospital_name: string;
  phone: string | null;
  address: string | null;
  address_detail: string | null;
  email: string | null;
  director_name: string | null;
  director_phone: string | null;
  status: 'pending' | 'approved' | 'rejected';
  di_conflict: boolean;
  di_conflict_hospital: string | null;
  created_at: string;
  reviewed_at: string | null;
};
type Detail = { registration: Reg; files: { bizCertUrl: string | null; vetLicenseUrl: string | null } };

const STATUS_TABS = [
  { key: 'pending', label: '심사 대기' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '거절' },
] as const;

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminRegistrations() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [list, setList] = useState<Reg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/registrations?status=${status}`, { credentials: 'include' });
      const data = (await res.json()) as { registrations?: Reg[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '불러오기 실패');
      setList(data.registrations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(tab); setSelectedId(null); setDetail(null); }, [tab, load]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setNote('');
    (async () => {
      try {
        const res = await fetch(`/api/admin/registrations/${selectedId}`, { credentials: 'include' });
        const data = (await res.json()) as Detail & { error?: string };
        if (!cancelled) setDetail(res.ok ? data : null);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const act = async (action: 'approve' | 'reject') => {
    if (!selectedId) return;
    if (action === 'reject' && !note.trim() && !window.confirm('사유 없이 거절할까요?')) return;
    if (action === 'approve' && !window.confirm('이 병원을 승인하고 생성할까요?')) return;
    setActing(true);
    try {
      const res = await fetch(`/api/admin/registrations/${selectedId}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '처리 실패');
      setSelectedId(null);
      await load(tab);
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리 실패');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="adminLayout2WithMain">
      <aside className="adminLayoutSecondaryRail" aria-label="병원 심사 목록">
        <div className="adminRailToolbar" style={{ gap: 4 }}>
          {STATUS_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              style={{ flex: 1, padding: '7px 0', fontSize: 12.5, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${tab === t.key ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: tab === t.key ? 'var(--accent-subtle)' : '#fff', color: tab === t.key ? 'var(--accent)' : 'var(--text-secondary)' }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 'calc(100vh - var(--topbar-height) - 60px)', overflowY: 'auto' }}>
          {loading ? (
            <p style={{ margin: 10, fontSize: 12.5, color: 'var(--text-muted)' }}>불러오는 중…</p>
          ) : error ? (
            <p style={{ margin: 10, fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
          ) : list.length === 0 ? (
            <p style={{ margin: 10, fontSize: 12.5, color: 'var(--text-muted)' }}>신청이 없습니다.</p>
          ) : (
            list.map((r) => (
              <div key={r.id} onClick={() => setSelectedId(r.id)}
                style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  background: selectedId === r.id ? 'var(--accent-subtle)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hospital_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmt(r.created_at)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {r.director_name || '원장 미입력'}
                  {r.di_conflict ? <span style={{ marginLeft: 6, color: 'var(--danger)', fontWeight: 700 }}>⚠ DI중복</span> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="adminLayoutMainPane">
        <div className="adminLayoutMainColumnInset">
          {!selectedId ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>좌측에서 신청을 선택하세요.</p>
          ) : detailLoading || !detail ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
          ) : (
            <div style={{ display: 'grid', gap: 14, maxWidth: 640 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{detail.registration.hospital_name}</h2>
              {detail.registration.di_conflict && (
                <div style={banner('var(--danger-subtle)', 'var(--danger)')}>
                  ⚠ 대표(마스터) 본인인증 DI가 기존 계정과 중복됩니다
                  {detail.registration.di_conflict_hospital ? ` — 기존: ${detail.registration.di_conflict_hospital}` : ''}. 신청자에게 확인 후 처리하세요.
                </div>
              )}
              <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', margin: 0, fontSize: 13 }}>
                <Row k="병원 전화" v={detail.registration.phone} />
                <Row k="병원 이메일" v={detail.registration.email} />
                <Row k="주소" v={[detail.registration.address, detail.registration.address_detail].filter(Boolean).join(' ')} />
                <Row k="대표원장" v={detail.registration.director_name} />
                <Row k="대표원장 연락처" v={detail.registration.director_phone} />
                <Row k="상태" v={detail.registration.status} />
                <Row k="신청일" v={fmt(detail.registration.created_at)} />
              </dl>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <FileLink label="사업자등록증" url={detail.files.bizCertUrl} />
                <FileLink label="수의사신고필증" url={detail.files.vetLicenseUrl} />
              </div>

              {detail.registration.status === 'pending' ? (
                <>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="심사 메모(거절 사유 등)" rows={3}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => void act('reject')} disabled={acting}
                      style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--danger)', background: '#fff', color: 'var(--danger)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>거절</button>
                    <button type="button" onClick={() => void act('approve')} disabled={acting}
                      style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{acting ? '처리 중…' : '승인'}</button>
                  </div>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>처리됨 · {fmt(detail.registration.reviewed_at)}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <>
      <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
      <dd style={{ margin: 0, color: 'var(--text)' }}>{v?.trim() || '—'}</dd>
    </>
  );
}
function FileLink({ label, url }: { label: string; url: string | null }) {
  if (!url) return <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{label}: 없음</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 12px', textDecoration: 'none' }}>
      {label} 열기 ↗
    </a>
  );
}
function banner(bg: string, color: string): CSSProperties {
  return { padding: 12, fontSize: 12.5, background: bg, borderRadius: 8, color };
}
