'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ddxGet, DdxApiForbiddenError } from '@/lib/ddx-api';

type SurveySession = {
  id: string;
  patientName: string | null;
  guardianName: string | null;
  scheduledDate: string | null;
  status: string;
  createdAt: string;
  analysisStatus?: string;
  isUsed?: boolean;
};

type SurveySessionsResponse = {
  success: boolean;
  sessions: SurveySession[];
  error?: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: '대기 중',
  completed: '제출 완료',
  expired: '만료',
};

const ANALYSIS_LABEL: Record<string, string> = {
  pending: '분석 대기',
  processing: '분석 중',
  done: '분석 완료',
  error: '분석 오류',
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function AiAssistPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SurveySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.id) setUserId(user.id);
      else setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    ddxGet<SurveySessionsResponse>('/api/surveys/sessions?take=50', userId)
      .then((data) => {
        if (data.success && Array.isArray(data.sessions)) {
          setSessions(data.sessions);
        } else {
          setSessions([]);
        }
      })
      .catch((err) => {
        if (err instanceof DdxApiForbiddenError) {
          setError('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
        } else {
          setError('데이터를 불러오는 중 오류가 발생했습니다.');
        }
        setSessions([]);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
            AI 진료 보조
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
            AI 기반 사전문진 및 감별진단 도구
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Link
            href="/ai-assist/records"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 14px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '13px',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            상담 기록
          </Link>
          <Link
            href="/ai-assist/new"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 16px',
              border: 'none',
              borderRadius: 'var(--radius)',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            + 새 상담 시작
          </Link>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--danger-subtle)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius)',
          color: 'var(--danger)',
          fontSize: '13px',
          marginBottom: '20px',
        }}>
          {error}
        </div>
      )}

      {/* Recent pre-consultations */}
      <div style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
            최근 사전문진
          </h2>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            최근 50건
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            <div style={{
              width: '20px', height: '20px', border: '2px solid var(--border)',
              borderTopColor: 'var(--accent)', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }} />
            불러오는 중...
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '32px', color: 'var(--text-muted)' }}>🩺</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>아직 상담 내역이 없습니다</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>새 상담을 시작하면 여기에 표시됩니다.</div>
            </div>
            <Link
              href="/ai-assist/new"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '8px 16px',
                background: 'var(--accent)',
                color: '#fff',
                borderRadius: 'var(--radius)',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
                marginTop: '4px',
              }}
            >
              첫 상담 시작하기
            </Link>
          </div>
        ) : (
          <div>
            {sessions.map((session, idx) => (
              <Link
                key={session.id}
                href={`/ai-assist/${session.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 20px',
                  borderBottom: idx < sessions.length - 1 ? '1px solid var(--border)' : 'none',
                  textDecoration: 'none',
                  color: 'inherit',
                  gap: '16px',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
                    {session.patientName || '(이름 없음)'}
                    {session.guardianName && (
                      <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '8px', fontSize: '13px' }}>
                        / {session.guardianName}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {formatDate(session.createdAt)}
                    {session.scheduledDate && (
                      <span style={{ marginLeft: '8px' }}>
                        · 예정일 {new Date(session.scheduledDate).toLocaleDateString('ko-KR')}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <StatusBadge status={session.status} label={STATUS_LABEL[session.status] ?? session.status} />
                  {session.analysisStatus && session.analysisStatus !== 'pending' && (
                    <StatusBadge
                      status={session.analysisStatus}
                      label={ANALYSIS_LABEL[session.analysisStatus] ?? session.analysisStatus}
                      variant="analysis"
                    />
                  )}
                  {session.isUsed && (
                    <StatusBadge status="used" label="문진 완료" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  label,
  variant = 'default',
}: {
  status: string;
  label: string;
  variant?: 'default' | 'analysis';
}) {
  const getColors = () => {
    if (variant === 'analysis') {
      if (status === 'done') return { bg: 'var(--success-subtle)', color: 'var(--success)', border: 'var(--success)' };
      if (status === 'processing') return { bg: 'var(--accent-subtle)', color: 'var(--accent)', border: 'var(--accent)' };
      if (status === 'error') return { bg: 'var(--danger-subtle)', color: 'var(--danger)', border: 'var(--danger)' };
      return { bg: 'var(--bg-raised)', color: 'var(--text-muted)', border: 'var(--border)' };
    }
    if (status === 'completed') return { bg: 'var(--success-subtle)', color: 'var(--success)', border: 'var(--success)' };
    if (status === 'expired') return { bg: 'var(--bg-raised)', color: 'var(--text-muted)', border: 'var(--border)' };
    if (status === 'used') return { bg: 'var(--accent-subtle)', color: 'var(--accent)', border: 'var(--accent)' };
    return { bg: 'var(--bg-raised)', color: 'var(--text-secondary)', border: 'var(--border)' };
  };
  const { bg, color, border } = getColors();
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      background: bg,
      color,
      border: `1px solid ${border}`,
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
