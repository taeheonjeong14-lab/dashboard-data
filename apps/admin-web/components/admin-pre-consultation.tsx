'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { parseChartAdminHospitalsResponse, type ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';
import {
  PageHeader, Section, Field, FieldGrid, Badge, Empty, Notice, thStyle, tdStyle,
} from '@/components/ui/admin-ui';

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

function statusTone(status: string): 'success' | 'accent' | 'muted' {
  if (status === 'completed') return 'success';
  if (status === 'expired') return 'muted';
  return 'accent';
}

export default function AdminPreConsultation() {
  const [hospitals, setHospitals] = useState<ChartHospitalOption[]>([]);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  // 선택된 세션 상세 로드
  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((cur) => (cur && sessions.some((s) => s.id === cur) ? cur : sessions[0]!.id));
  }, [sessions]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    fetch(`/api/admin/pre-consultation/sessions/${encodeURIComponent(selectedId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('상세를 불러오지 못했습니다.'))))
      .then((d: SessionDetail) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null;

  const hospitalSelect = (
    <select
      value={hospitalId ?? ''}
      onChange={(e) => setHospitalId(e.target.value || null)}
      style={{
        padding: '8px 10px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)',
        border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none', cursor: 'pointer',
      }}
    >
      {hospitals.length === 0 ? <option value="">불러오는 중…</option> : null}
      {hospitals.map((h) => (
        <option key={h.id} value={h.id}>{h.name_ko}</option>
      ))}
    </select>
  );

  return (
    <div>
      <PageHeader
        title="사전문진"
        description="병원별로 보호자가 제출한 사전문진과 AI 사전 분석 결과를 확인합니다."
        actions={hospitalSelect}
      />

      {error ? <Notice danger>{error}</Notice> : null}

      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* ── 좌측: 세션 목록 ── */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <div style={{ padding: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            문진 목록
            {sessions.length > 0 && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>{sessions.length}건</span>
            )}
          </div>

          {listLoading ? (
            <Empty text="불러오는 중…" />
          ) : !hospitalId ? (
            <Empty text="병원을 선택하세요." />
          ) : sessions.length === 0 ? (
            <Empty title="이 병원의 사전문진이 없습니다" text="보호자가 사전문진을 제출하면 여기에 표시됩니다." />
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
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      background: selectedId === s.id ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >
                    <td style={tdStyle}>{fmtDateTime(s.createdAt)}</td>
                    <td style={{ ...tdStyle, color: 'var(--text)' }}>{s.patientName || '—'}</td>
                    <td style={tdStyle}>{s.guardianName || '—'}</td>
                    <td style={tdStyle}>
                      <Badge tone={statusTone(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── 우측: 문진 상세 ── */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', paddingLeft: 24 }}>
          <div style={{ padding: '0 0 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>문진 상세</div>
            {selectedSession && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{fmtDateTime(selectedSession.createdAt)} 발송</div>
            )}
          </div>
          {detailLoading && !detail ? (
            <Empty text="불러오는 중…" />
          ) : detail ? (
            <DetailBody detail={detail} />
          ) : selectedSession ? (
            <Empty text="상세를 불러오지 못했습니다." />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>왼쪽에서 항목을 선택하세요.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailBody({ detail }: { detail: SessionDetail }) {
  const { session, questions, answers } = detail;
  const answerByQ = new Map(answers.map((a) => [a.questionInstanceId, a]));
  return (
    <div>
      <Section title="문진 정보" first>
        <FieldGrid>
          <Field label="환자" value={session.patientName} />
          <Field label="보호자" value={session.guardianName} />
          <Field label="연락처" value={session.contact} />
          <Field label="방문 유형" value={session.visitType} />
          <Field label="상태" value={STATUS_LABEL[session.status] ?? session.status} />
          <Field label="AI 분석" value={session.analysisStatus ? (ANALYSIS_LABEL[session.analysisStatus] ?? session.analysisStatus) : '—'} />
          <Field label="발송일시" value={fmtDateTime(session.createdAt)} />
          <Field label="작성완료" value={fmtDateTime(session.completedAt)} />
        </FieldGrid>
      </Section>

      {session.draftSummary ? (
        <Section title="AI 요약">
          <p style={preLikeStyle}>{session.draftSummary}</p>
        </Section>
      ) : null}
      {session.draftDdx ? (
        <Section title="AI 감별진단(DDx)">
          <p style={preLikeStyle}>{session.draftDdx}</p>
        </Section>
      ) : null}

      <Section title={`문진 답변 (${questions.length}문항)`}>
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
      </Section>
    </div>
  );
}

const preLikeStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
  background: 'var(--bg-subtle)',
  borderRadius: 'var(--radius)',
  padding: '12px 14px',
};
