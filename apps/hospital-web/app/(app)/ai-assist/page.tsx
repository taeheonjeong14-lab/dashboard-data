'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useHospital } from '@/components/shell/hospital-context';
import { CenteredSpinner } from '@/components/ui/loading-spinner';
import { ddxGet, DdxApiForbiddenError } from '@/lib/ddx-api';

type Consultation = {
  id: string;
  sessionId: string;
  patientName: string | null;
  guardianName: string | null;
  visitType: string | null;
  status: string;
  summary: string | null;
  ddx: string | null;
  surveySessionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  recording: '진행 중',
  awaiting_recording: '대기',
  completed: '완료',
};

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return iso; }
}

export default function AiAssistPage() {
  const router = useRouter();
  const { userId } = useHospital();
  const [items, setItems] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    ddxGet<{ success: boolean; consultations: Consultation[] }>('/api/consultations', userId)
      .then((data) => {
        if (data.success && Array.isArray(data.consultations)) setItems(data.consultations);
        else setItems([]);
      })
      .catch((err) => {
        if (err instanceof DdxApiForbiddenError) setError('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
        else setError('데이터를 불러오는 중 오류가 발생했습니다.');
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  const filtered = items.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [c.patientName ?? '', c.guardianName ?? ''].join(' ').toLowerCase().includes(q);
  });

  return (
    <div style={{ maxWidth: 960 }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>AI 진료 보조</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            진료를 시작하고 AI 감별진단·요약을 확인합니다.
          </p>
        </div>
        <Link href="/ai-assist/new"
          style={{ padding: '9px 16px', border: 'none', borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          + 진료 시작
        </Link>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* 검색 */}
      {!loading && items.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="환자 또는 보호자 검색"
            style={{ width: '100%', maxWidth: 320, padding: '9px 12px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
      )}

      {/* 목록 */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>진료 내역</h2>
          {!loading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>총 {filtered.length}건</span>}
        </div>

        {loading ? (
          <CenteredSpinner minHeight={220} />
        ) : filtered.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {search ? '검색 결과가 없습니다' : '아직 진료 내역이 없습니다'}
            </div>
            {!search && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>“진료 시작”으로 첫 진료를 기록해 보세요.</div>
                <Link href="/ai-assist/new"
                  style={{ marginTop: 4, padding: '8px 16px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  진료 시작하기
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 150px', gap: 12, padding: '10px 18px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <span>환자 / 보호자</span>
              <span>방문</span>
              <span>상태</span>
              <span>최근 업데이트</span>
            </div>
            {filtered.map((c, idx) => (
              <div key={c.id}
                onClick={() => router.push(`/ai-assist/${encodeURIComponent(c.sessionId)}`)}
                style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 150px', gap: 12, padding: '14px 18px', borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center', cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                    {c.patientName || '(이름 없음)'}
                    {c.surveySessionId && (
                      <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', background: 'var(--accent-subtle)', color: 'var(--accent)', borderRadius: 999, fontWeight: 500 }}>사전문진</span>
                    )}
                  </div>
                  {c.guardianName && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{c.guardianName}</div>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{c.visitType || '—'}</div>
                <div>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: c.status === 'completed' ? 'var(--success-subtle)' : 'var(--bg-raised)', color: c.status === 'completed' ? 'var(--success)' : 'var(--text-secondary)', border: `1px solid ${c.status === 'completed' ? 'var(--success)' : 'var(--border)'}` }}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{fmtDateTime(c.updatedAt)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
