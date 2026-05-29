'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { parseChartAdminHospitalsResponse, type ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';

type SessionListItem = {
  id: string;
  patientName: string | null;
  guardianName: string | null;
  contact: string | null;
  visitType: string | null;
  status: string;
  analysisStatus: string | null;
  createdAt: string;
  completedAt: string | null;
};

type QuestionInstance = {
  id: string;
  order: number;
  source: string | null;
  stage: string | null;
  text: string;
  type: string | null;
  options: unknown;
};

type AnswerRow = {
  id: string;
  questionInstanceId: string;
  answerText: string | null;
  answerJson: unknown;
};

type SessionDetail = {
  session: SessionListItem & {
    hospitalId: string | null;
    previousChartText: string | null;
    draftSummary: string | null;
    draftDdx: string | null;
    followUpQuestions: unknown;
    scheduledDate: string | null;
    petAge: number | null;
  };
  questions: QuestionInstance[];
  answers: AnswerRow[];
};

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  completed: '작성완료',
  expired: '만료',
};
const ANALYSIS_LABEL: Record<string, string> = {
  pending: 'AI 분석 대기',
  processing: 'AI 분석 중',
  done: 'AI 분석 완료',
  error: 'AI 분석 실패',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function answerDisplay(a: AnswerRow | undefined): string {
  if (!a) return '—';
  if (a.answerText && a.answerText.trim()) return a.answerText.trim();
  if (a.answerJson != null) {
    if (Array.isArray(a.answerJson)) return a.answerJson.join(', ');
    if (typeof a.answerJson === 'string') return a.answerJson;
    return JSON.stringify(a.answerJson);
  }
  return '—';
}

export default function AdminPreConsultation() {
  const [hospitals, setHospitals] = useState<ChartHospitalOption[]>([]);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    fetch('/api/admin/data/hospitals', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const list = parseChartAdminHospitalsResponse(d);
        setHospitals(list);
        setHospitalId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch(() => setError('병원 목록을 불러오지 못했습니다.'));
  }, []);

  const loadSessions = useCallback((hid: string) => {
    setListLoading(true);
    setError(null);
    fetch(`/api/admin/pre-consultation/sessions?hospitalId=${encodeURIComponent(hid)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('목록을 불러오지 못했습니다.'))))
      .then((d: { sessions: SessionListItem[] }) => setSessions(d.sessions ?? []))
      .catch((e) => {
        setSessions([]);
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
      })
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    if (!hospitalId) {
      setSessions([]);
      return;
    }
    loadSessions(hospitalId);
  }, [hospitalId, loadSessions]);

  function openDetail(id: string) {
    setModalOpen(true);
    setDetail(null);
    setDetailLoading(true);
    fetch(`/api/admin/pre-consultation/sessions/${encodeURIComponent(id)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('상세를 불러오지 못했습니다.'))))
      .then((d: SessionDetail) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>사전문진</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
          병원별로 보호자가 제출한 사전문진과 AI 사전 분석 결과를 확인합니다.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <HospitalList hospitals={hospitals} selected={hospitalId} onSelect={setHospitalId} />

        <section style={cardStyle}>
          {error ? (
            <div style={noticeStyle}>{error}</div>
          ) : null}
          {listLoading ? (
            <Empty text="불러오는 중…" />
          ) : !hospitalId ? (
            <Empty text="왼쪽에서 병원을 선택하세요." />
          ) : sessions.length === 0 ? (
            <Empty text="이 병원의 사전문진이 없습니다." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['발송일시', '환자', '보호자', '연락처', '상태'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => openDetail(s.id)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  >
                    <td style={tdStyle}>{fmtDateTime(s.createdAt)}</td>
                    <td style={{ ...tdStyle, color: 'var(--text)' }}>{s.patientName || '—'}</td>
                    <td style={tdStyle}>{s.guardianName || '—'}</td>
                    <td style={tdStyle}>{s.contact || '—'}</td>
                    <td style={tdStyle}>
                      <StatusBadge label={STATUS_LABEL[s.status] ?? s.status} tone={s.status === 'completed' ? 'success' : s.status === 'expired' ? 'muted' : 'accent'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {modalOpen ? (
        <Modal onClose={() => setModalOpen(false)} title="사전문진 상세">
          {detailLoading && !detail ? (
            <Empty text="불러오는 중…" />
          ) : !detail ? (
            <Empty text="상세를 불러오지 못했습니다." />
          ) : (
            <DetailBody detail={detail} />
          )}
        </Modal>
      ) : null}
    </div>
  );
}

function DetailBody({ detail }: { detail: SessionDetail }) {
  const { session, questions, answers } = detail;
  const answerByQ = new Map(answers.map((a) => [a.questionInstanceId, a]));
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        <Field label="환자" value={session.patientName} />
        <Field label="보호자" value={session.guardianName} />
        <Field label="연락처" value={session.contact} />
        <Field label="방문 유형" value={session.visitType} />
        <Field label="상태" value={STATUS_LABEL[session.status] ?? session.status} />
        <Field label="AI 분석" value={session.analysisStatus ? (ANALYSIS_LABEL[session.analysisStatus] ?? session.analysisStatus) : '—'} />
        <Field label="발송일시" value={fmtDateTime(session.createdAt)} />
        <Field label="작성완료" value={fmtDateTime(session.completedAt)} />
      </div>

      {session.draftSummary ? (
        <Block title="AI 요약">
          <p style={preLikeStyle}>{session.draftSummary}</p>
        </Block>
      ) : null}
      {session.draftDdx ? (
        <Block title="AI 감별진단(DDx)">
          <p style={preLikeStyle}>{session.draftDdx}</p>
        </Block>
      ) : null}

      <Block title={`문진 답변 (${questions.length}문항)`}>
        {questions.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>질문이 없습니다.</p>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {questions.map((q) => (
              <li key={q.id}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {q.order}. {q.text}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, whiteSpace: 'pre-wrap' }}>
                  {answerDisplay(answerByQ.get(q.id))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Block>
    </div>
  );
}

// ── 공유 소품 ───────────────────────────────────────────
function HospitalList({
  hospitals,
  selected,
  onSelect,
}: {
  hospitals: ChartHospitalOption[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside style={{ width: 220, flexShrink: 0, ...cardStyle, padding: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '6px 10px', letterSpacing: '0.02em' }}>
        병원
      </div>
      {hospitals.length === 0 ? (
        <div style={{ padding: '10px', fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</div>
      ) : (
        hospitals.map((h) => {
          const active = h.id === selected;
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => onSelect(h.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '9px 10px',
                border: 'none',
                borderRadius: 'var(--radius)',
                background: active ? 'var(--accent-subtle)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 500,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {h.name_ko}
            </button>
          );
        })
      )}
    </aside>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{value || '—'}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: 'success' | 'accent' | 'muted' }) {
  const colors =
    tone === 'success'
      ? { bg: 'var(--success-subtle)', fg: 'var(--success)' }
      : tone === 'muted'
        ? { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' }
        : { bg: 'var(--accent-subtle)', fg: 'var(--accent)' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.fg }}>
      {label}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>{text}</div>;
}

const cardStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};
const noticeStyle: CSSProperties = {
  padding: '10px 12px',
  marginBottom: 12,
  fontSize: 13,
  color: 'var(--danger)',
  background: 'var(--danger-subtle)',
  borderRadius: 'var(--radius)',
};
const thStyle: CSSProperties = {
  padding: '9px 12px',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--text-muted)',
  fontSize: 11,
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};
const tdStyle: CSSProperties = {
  padding: '11px 12px',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
};
const preLikeStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
};
