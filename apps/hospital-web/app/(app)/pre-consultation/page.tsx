'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useHospital } from '@/components/shell/hospital-context';
import { CenteredSpinner } from '@/components/ui/loading-spinner';
import { StickyHeader } from '@/components/ui/sticky-header';
import { ddxGet, ddxPost, DdxApiForbiddenError } from '@/lib/ddx-api';
import {
  SessionDetailView,
  Section, Row, CopyBtn, StatusBadge, SurveyKakaoSend,
  STATUS_LABEL,
  fmtDateTime,
  type SessionDetail,
} from '@/components/pre-consultation/session-detail';

// 한국 휴대폰 번호 자동 포맷팅(010-0000-0000). 숫자만 추출해 길이별로 - 삽입.
function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length < 11) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

// ─── 타입 (이 페이지 전용; 상세 관련 타입은 session-detail 모듈에서 import) ──
type SessionListItem = {
  id: string;
  token?: string | null;
  patientName: string | null;
  guardianName: string | null;
  contact?: string | null;
  visitType?: string | null;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  analysisStatus?: string;
  isUsed?: boolean;
};

// ─── 페이지 ──────────────────────────────────────────────
export default function PreConsultationPage() {
  const { userId } = useHospital();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const loadSessions = useCallback((uid: string) => {
    return ddxGet<{ success: boolean; sessions: SessionListItem[]; error?: string }>(
      '/api/surveys/sessions?take=200', uid,
    )
      .then((data) => {
        if (data.success && Array.isArray(data.sessions)) {
          setSessions(data.sessions);
          setSelectedId((prev) => prev ?? data.sessions[0]?.id ?? null);
        } else {
          setSessions([]);
          if (data.error) setError(data.error);
        }
      })
      .catch((err) => {
        if (err instanceof DdxApiForbiddenError) setError('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
        else setError('데이터를 불러오는 중 오류가 발생했습니다.');
        setSessions([]);
      });
  }, []);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    loadSessions(userId).finally(() => setLoading(false));
  }, [userId, loadSessions]);

  // 선택 항목 상세 로드
  const loadDetail = useCallback((uid: string, id: string) => {
    setDetailLoading(true);
    return ddxGet<{ success: boolean; session: SessionDetail }>(
      `/api/surveys/sessions/${encodeURIComponent(id)}`, uid,
    )
      .then((data) => { if (data.success && data.session) setDetail(data.session); })
      .catch(() => { /* 무시 */ })
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (!userId || !selectedId) { setDetail(null); return; }
    loadDetail(userId, selectedId);
  }, [userId, selectedId, loadDetail]);

  // 분석 진행 중이면 상세 폴링
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!userId || !detail) return;
    const inProgress = detail.status === 'completed' && (detail.analysisStatus === 'pending' || detail.analysisStatus === 'processing');
    if (!inProgress) return;
    pollRef.current = setInterval(() => { loadDetail(userId, detail.id); }, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [userId, detail, loadDetail]);

  const filtered = sessions.filter((s) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [s.patientName ?? '', s.guardianName ?? '', s.contact ?? ''].join(' ').toLowerCase().includes(q);
  });

  const handleCreated = (created: { id: string; token?: string | null }) => {
    if (userId) loadSessions(userId);
    setSelectedId(created.id);
  };

  return (
    <div>
      <StickyHeader>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 0, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>사전문진</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            보호자에게 사전문진 링크를 보내고, 제출된 답변과 AI 사전 분석을 확인합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            padding: '9px 16px', border: 'none', borderRadius: 'var(--radius)',
            background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          + 사전문진 발송
        </button>
      </div>
      </StickyHeader>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
        {/* ── 좌측: 목록 ── */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <div style={{ padding: '0 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              사전문진 목록
              {sessions.length > 0 && (
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  {filtered.length === sessions.length ? `${sessions.length}건` : `${filtered.length} / ${sessions.length}건`}
                </span>
              )}
            </span>
            <button onClick={() => userId && loadSessions(userId)}
              style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}>
              새로고침
            </button>
          </div>

          {loading ? (
            <Spinner />
          ) : sessions.length === 0 ? (
            <div style={{ padding: '48px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>아직 발송된 사전문진이 없습니다</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>“사전문진 발송”으로 보호자에게 문진 링크를 보내보세요.</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="환자·보호자·연락처 검색"
                  style={{ width: '100%', padding: '8px 10px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>

              {filtered.length === 0 ? (
                <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>검색 결과가 없습니다.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle)' }}>
                      {['발송일시', '환자', '보호자', '상태'].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s, i) => (
                      <tr key={s.id} onClick={() => setSelectedId(s.id)}
                        style={{
                          borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                          cursor: 'pointer',
                          background: selectedId === s.id ? 'var(--accent-subtle)' : 'transparent',
                        }}>
                        <td style={tdStyle}>{fmtDateTime(s.createdAt)}</td>
                        <td style={{ ...tdStyle, color: 'var(--text)' }}>{s.patientName || '—'}</td>
                        <td style={tdStyle}>{s.guardianName || '—'}</td>
                        <td style={{ ...tdStyle }}>
                          <StatusBadge status={s.status} label={STATUS_LABEL[s.status] ?? s.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* ── 우측: 상세 ── */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', paddingLeft: 24 }}>
          <div style={{ padding: '0 0 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>사전문진 상세</div>
          </div>
          {!selectedId ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>왼쪽에서 항목을 선택하세요.</div>
          ) : detailLoading && !detail ? (
            <Spinner />
          ) : detail ? (
            <SessionDetailView detail={detail} origin={origin} />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>상세를 불러오지 못했습니다.</div>
          )}
        </div>
      </div>

      {modalOpen && userId && (
        <SendModal userId={userId} origin={origin} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}

// ─── 발송 모달 ───────────────────────────────────────────
function SendModal({ userId, origin, onClose, onCreated }: {
  userId: string; origin: string;
  onClose: () => void;
  onCreated: (s: { id: string; token?: string | null }) => void;
}) {
  const [patientName, setPatientName] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [contact, setContact] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [visitType, setVisitType] = useState('초진');
  const [previousChart, setPreviousChart] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<{ id: string; token?: string | null } | null>(null);

  const shareUrl = created && origin && created.token ? `${origin}/survey/${created.token}` : '';

  const submit = async () => {
    if (!contact.trim()) { setErr('연락처를 입력해 주세요.'); return; }
    if (visitType === '재진' && !previousChart.trim()) { setErr('재진 사전문진은 이전 차트 내용이 필요합니다.'); return; }
    setErr('');
    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        userId,
        contact: contact.trim(),
        visitType,
      };
      if (patientName.trim()) body.patientName = patientName.trim();
      if (guardianName.trim()) body.guardianName = guardianName.trim();
      if (scheduledDate) body.scheduledDate = scheduledDate;
      if (visitType === '재진' && previousChart.trim()) body.previousChart = previousChart.trim();

      const res = await ddxPost<{ success: boolean; session?: { id: string; token?: string | null }; error?: string }>(
        '/api/surveys/sessions', userId, body,
      );
      if (res.success && res.session) {
        setCreated({ id: res.session.id, token: res.session.token });
        onCreated({ id: res.session.id, token: res.session.token });
      } else {
        setErr(res.error || '사전문진 생성에 실패했습니다.');
      }
    } catch (e) {
      if (e instanceof DdxApiForbiddenError) setErr('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
      else setErr(e instanceof Error ? e.message : '사전문진 생성 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{created ? '사전문진 발송 완료' : '사전문진 발송'}</h2>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {created ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              아래 작성 링크를 보호자에게 전달하세요. 보호자가 작성을 완료하면 자동으로 AI 사전 분석이 진행됩니다.
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)', wordBreak: 'break-all', lineHeight: 1.6 }}>{shareUrl || '링크 생성 실패'}</span>
              {shareUrl && <CopyBtn text={shareUrl} label="복사" />}
            </div>
            {created.token && (
              <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <SurveyKakaoSend token={created.token} defaultPhone={contact} patientName={patientName} guardianName={guardianName} />
              </div>
            )}
            <button type="button" onClick={onClose}
              style={{ padding: '11px', border: 'none', borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              완료
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {err && (
              <div style={{ padding: '10px 12px', background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 12.5 }}>{err}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="환자 이름">
                <input style={inputStyle} value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="예: 뽀미" />
              </Field>
              <Field label="보호자 성명">
                <input style={inputStyle} value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="예: 홍길동" />
              </Field>
            </div>
            <Field label="연락처" required>
              <input style={inputStyle} value={contact} onChange={(e) => setContact(formatPhone(e.target.value))} placeholder="010-0000-0000" type="tel" inputMode="numeric" />
            </Field>
            <Field label="내원 예정일">
              <input style={inputStyle} type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </Field>
            <Field label="방문 유형">
              <div style={{ display: 'flex', gap: 8 }}>
                {['초진', '재진'].map((vt) => (
                  <button key={vt} type="button" onClick={() => setVisitType(vt)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: 'var(--radius)',
                      border: `1px solid ${visitType === vt ? 'var(--accent)' : 'var(--border-strong)'}`,
                      background: visitType === vt ? 'var(--accent-subtle)' : 'var(--bg)',
                      color: visitType === vt ? 'var(--accent)' : 'var(--text)',
                      fontSize: 13, fontWeight: visitType === vt ? 600 : 400, cursor: 'pointer',
                    }}>
                    {vt}
                  </button>
                ))}
              </div>
            </Field>
            {visitType === '재진' && (
              <Field label="이전 차트 내용" required>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }} value={previousChart} onChange={(e) => setPreviousChart(e.target.value)}
                  placeholder="지난 진료 차트를 붙여넣으면 AI가 재진 맞춤 질문을 생성합니다." rows={4} />
              </Field>
            )}
            <p style={{ margin: '-2px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {visitType === '재진'
                ? '재진은 이전 차트를 바탕으로 AI 맞춤 질문이 생성됩니다.'
                : '초진은 기본 사전문진 질문이 사용됩니다.'}
            </p>
            <button type="button" onClick={submit} disabled={submitting}
              style={{ padding: '12px', border: 'none', borderRadius: 'var(--radius)', background: submitting ? 'var(--bg-raised)' : 'var(--accent)', color: submitting ? 'var(--text-muted)' : '#fff', fontSize: 14, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}>
              {submitting ? '생성 중…' : '발송 링크 생성'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 발송 모달 전용 작은 컴포넌트 ──────────────────────────
function Spinner() {
  return <CenteredSpinner minHeight={240} />;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
        {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
      </span>
      {children}
    </label>
  );
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13.5, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
};

const thStyle: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)',
  fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const tdStyle: CSSProperties = {
  padding: '11px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};
