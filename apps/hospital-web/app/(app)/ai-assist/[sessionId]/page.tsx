'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useHospital } from '@/components/shell/hospital-context';
import { CenteredSpinner } from '@/components/ui/loading-spinner';
import { ddxGet, ddxPost, ddxPostStream, DdxApiForbiddenError } from '@/lib/ddx-api';

type Consultation = {
  id: string;
  sessionId: string;
  userId?: string | null;
  surveySessionId?: string | null;
  transcript: string;
  summary: string | null;
  ddx: string | null;
  cc: string | null;
  realtimeQuestions: string[];
  status: string;
  patientName: string | null;
  guardianName: string | null;
  visitType: string | null;
  previousChartContent: string | null;
  createdAt: string;
  updatedAt: string;
};

type SurveyQuestion = {
  id: string;
  order: number;
  text: string;
  type: string;
};

type SurveyAnswer = {
  id: string;
  questionInstanceId: string;
  answerText: string | null;
  answerJson: unknown;
};

type SurveyDetail = {
  id: string;
  patientName: string | null;
  guardianName: string | null;
  status: string;
  analysisStatus?: string;
  draftSummary?: string | null;
  draftDdx?: string | null;
  followUpQuestions?: unknown;
  questions: SurveyQuestion[];
  answers: SurveyAnswer[];
} | null;

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function parseDdxJson(raw: string | null): Array<{ name: string; likelihood: string; reasons: string[]; tests: string[] }> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // not JSON
  }
  return null;
}

function likelihoodColor(l: string) {
  if (l === '높음') return 'var(--danger)';
  if (l === '낮음') return 'var(--accent)';
  return '#d97706';
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '16px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'var(--bg-subtle)', border: 'none', cursor: 'pointer',
          color: 'var(--text)', fontSize: '14px', fontWeight: 600,
        }}
      >
        {title}
        <span style={{ fontSize: '16px', color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div style={{ padding: '16px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text.trim()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      }}
      title={copied ? '복사됨' : '복사'}
      style={{
        padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        background: 'var(--bg)', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: '4px',
      }}
    >
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

export default function ConsultationDetailPage() {
  const params = useParams();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';

  const { userId } = useHospital();
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [surveyDetail, setSurveyDetail] = useState<SurveyDetail>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // AI results state
  const [ddxResult, setDdxResult] = useState<string>('');
  const [ddxLoading, setDdxLoading] = useState(false);
  const [ddxError, setDdxError] = useState('');

  const [summaryResult, setSummaryResult] = useState<string>('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const [followupResult, setFollowupResult] = useState<string[]>([]);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [followupError, setFollowupError] = useState('');

  const fetchConsultation = useCallback(async (uid: string) => {
    if (!sessionId) return;
    try {
      const data = await ddxGet<{ success: boolean; consultation: Consultation }>(
        `/api/consultations?sessionId=${encodeURIComponent(sessionId)}`, uid,
      );
      if (data.success && data.consultation) {
        setConsultation(data.consultation);
        // If linked to a survey session, fetch its detail
        const sid = data.consultation.surveySessionId;
        if (sid) {
          ddxGet<{ success: boolean; session: SurveyDetail }>(`/api/surveys/sessions/${encodeURIComponent(sid)}`, uid)
            .then((d) => { if (d.success && d.session) setSurveyDetail(d.session); })
            .catch(() => {});
        }
      } else {
        setError('해당 기록을 찾을 수 없습니다.');
      }
    } catch (err) {
      if (err instanceof DdxApiForbiddenError) {
        setError('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
      } else {
        setError('불러오는 중 오류가 발생했습니다.');
      }
    }
  }, [sessionId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchConsultation(userId).finally(() => setLoading(false));
  }, [userId, fetchConsultation]);

  const handleRunDdx = async () => {
    if (!userId || !consultation) return;
    setDdxLoading(true);
    setDdxError('');
    setDdxResult('');
    try {
      const res = await ddxPostStream('/api/ddx', userId, {
        transcript: consultation.transcript,
        surveySessionData: surveyDetail ? {
          questions: surveyDetail.questions,
          answers: surveyDetail.answers,
          draftDdx: surveyDetail.draftDdx,
        } : undefined,
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('스트림을 읽을 수 없습니다.');
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]' || data === '') continue;
          try {
            const j = JSON.parse(data);
            if (j.text) setDdxResult(j.text);
          } catch {}
        }
      }
    } catch (err) {
      if (err instanceof DdxApiForbiddenError) {
        setDdxError('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
      } else {
        setDdxError(err instanceof Error ? err.message : '감별진단 생성 중 오류가 발생했습니다.');
      }
    } finally {
      setDdxLoading(false);
    }
  };

  const handleSummarize = async () => {
    if (!userId || !consultation) return;
    setSummaryLoading(true);
    setSummaryError('');
    setSummaryResult('');
    try {
      const res = await ddxPostStream('/api/summarize', userId, {
        transcript: consultation.transcript,
        surveySessionData: surveyDetail ? {
          questions: surveyDetail.questions,
          answers: surveyDetail.answers,
          draftSummary: surveyDetail.draftSummary,
        } : undefined,
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error('스트림을 읽을 수 없습니다.');
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]' || data === '') continue;
          try {
            const j = JSON.parse(data);
            if (j.text) setSummaryResult(j.text);
          } catch {}
        }
      }
    } catch (err) {
      if (err instanceof DdxApiForbiddenError) {
        setSummaryError('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
      } else {
        setSummaryError(err instanceof Error ? err.message : '요약 생성 중 오류가 발생했습니다.');
      }
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleFollowup = async () => {
    if (!userId || !consultation) return;
    setFollowupLoading(true);
    setFollowupError('');
    setFollowupResult([]);
    try {
      const body: Record<string, string> = {
        previousChartContent: consultation.transcript || consultation.summary || '',
      };
      const data = await ddxPost<{ questions: string[]; error?: string }>('/api/followup-questions', userId, body);
      if (Array.isArray(data.questions)) {
        setFollowupResult(data.questions);
      } else {
        setFollowupError(data.error || '추가 질문 생성에 실패했습니다.');
      }
    } catch (err) {
      if (err instanceof DdxApiForbiddenError) {
        setFollowupError('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
      } else {
        setFollowupError(err instanceof Error ? err.message : '추가 질문 생성 중 오류가 발생했습니다.');
      }
    } finally {
      setFollowupLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '20px',
    marginBottom: '16px',
  };

  const btnPrimaryStyle: React.CSSProperties = {
    padding: '9px 16px',
    border: 'none',
    borderRadius: 'var(--radius)',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  };

  const btnSecondaryStyle: React.CSSProperties = {
    padding: '9px 16px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
  };

  if (!sessionId) {
    return (
      <div style={{ padding: '24px' }}>
        <p style={{ color: 'var(--danger)' }}>잘못된 경로입니다.</p>
        <Link href="/ai-assist" style={{ color: 'var(--accent)', fontSize: '13px' }}>목록으로</Link>
      </div>
    );
  }

  if (loading) {
    return <CenteredSpinner />;
  }

  if (error || !consultation) {
    return (
      <div style={{ padding: '24px' }}>
        <p style={{ color: 'var(--danger)', fontSize: '14px' }}>{error || '기록을 찾을 수 없습니다.'}</p>
        <Link href="/ai-assist" style={{ color: 'var(--accent)', fontSize: '13px' }}>목록으로 돌아가기</Link>
      </div>
    );
  }

  const ddxParsed = parseDdxJson(ddxResult || consultation.ddx);

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700, color: 'var(--text)' }}>
            문진 기록
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
            {formatDate(consultation.createdAt)}
          </p>
        </div>
        <Link
          href="/ai-assist"
          style={{ ...btnSecondaryStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
        >
          목록으로
        </Link>
      </div>

      {/* Patient info */}
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>환자 정보</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', fontSize: '13px' }}>
          {[
            { label: '환자 이름', value: consultation.patientName },
            { label: '보호자 이름', value: consultation.guardianName },
            { label: '방문 유형', value: consultation.visitType },
            { label: '상태', value: consultation.status },
          ].map(({ label, value }) => (
            <div key={label}>
              <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>{label}</span>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{value || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '24px' }}>
        <button
          type="button"
          onClick={handleRunDdx}
          disabled={ddxLoading}
          style={{ ...btnPrimaryStyle, opacity: ddxLoading ? 0.7 : 1, cursor: ddxLoading ? 'not-allowed' : 'pointer' }}
        >
          {ddxLoading ? (
            <>
              <span style={{
                width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: '#fff', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite', display: 'inline-block',
              }} />
              분석 중...
            </>
          ) : '감별 진단 실행'}
        </button>
        <button
          type="button"
          onClick={handleSummarize}
          disabled={summaryLoading}
          style={{ ...btnPrimaryStyle, background: 'var(--success)', opacity: summaryLoading ? 0.7 : 1, cursor: summaryLoading ? 'not-allowed' : 'pointer' }}
        >
          {summaryLoading ? (
            <>
              <span style={{
                width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: '#fff', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite', display: 'inline-block',
              }} />
              요약 중...
            </>
          ) : '상담 요약'}
        </button>
        <button
          type="button"
          onClick={handleFollowup}
          disabled={followupLoading}
          style={{ ...btnSecondaryStyle, opacity: followupLoading ? 0.7 : 1, cursor: followupLoading ? 'not-allowed' : 'pointer' }}
        >
          {followupLoading ? '생성 중...' : '추가 질문 생성'}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Main content grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
        {/* Left: Summary */}
        <div>
          {/* Summary result */}
          {(summaryResult || consultation.summary) && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>수의사 요약</h2>
                <CopyButton text={summaryResult || consultation.summary || ''} />
              </div>
              {summaryError && (
                <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 8px' }}>{summaryError}</p>
              )}
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {summaryResult || consultation.summary}
              </p>
            </div>
          )}

          {/* Summary error (no result yet) */}
          {summaryError && !summaryResult && !consultation.summary && (
            <div style={{ ...cardStyle, border: '1px solid var(--danger)' }}>
              <p style={{ color: 'var(--danger)', fontSize: '13px', margin: 0 }}>{summaryError}</p>
            </div>
          )}

          {/* CC */}
          {consultation.cc && (
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>CC (주증상)</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text)' }}>{consultation.cc}</p>
            </div>
          )}

          {/* Follow-up questions */}
          {(followupResult.length > 0 || followupError) && (
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>추가 질문 제안</h2>
              {followupError && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 8px' }}>{followupError}</p>}
              {followupResult.length > 0 && (
                <ol style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {followupResult.map((q, i) => (
                    <li key={i} style={{ fontSize: '13px', color: 'var(--text)', lineHeight: 1.5 }}>{q}</li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Survey Q&A */}
          {surveyDetail && surveyDetail.questions.length > 0 && (
            <Section title="사전문진 답변">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {surveyDetail.questions
                  .sort((a, b) => a.order - b.order)
                  .map((q) => {
                    const ans = surveyDetail.answers?.find((a) => a.questionInstanceId === q.id);
                    if (!ans) return null;
                    const display = Array.isArray(ans.answerJson)
                      ? (ans.answerJson as string[]).join(', ')
                      : ans.answerText ?? '';
                    if (!display) return null;
                    return (
                      <div key={q.id} style={{ padding: '10px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                        <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)' }}>Q{q.order}. {q.text}</p>
                        <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>{display}</p>
                      </div>
                    );
                  })}
              </div>
            </Section>
          )}

          {/* Transcript */}
          {consultation.transcript && (
            <Section title="대화 내용">
              <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'var(--bg-subtle)', borderRadius: 'var(--radius)', padding: '12px' }}>
                <pre style={{ margin: 0, fontSize: '12px', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>
                  {consultation.transcript}
                </pre>
              </div>
            </Section>
          )}
        </div>

        {/* Right: DDx */}
        <div>
          {(ddxResult || consultation.ddx || ddxError) && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>감별진단 (DDx)</h2>
                {(ddxResult || consultation.ddx) && <CopyButton text={ddxResult || consultation.ddx || ''} />}
              </div>
              {ddxError && <p style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '8px' }}>{ddxError}</p>}
              {ddxParsed ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {ddxParsed.map((item, i) => (
                    <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px', background: 'var(--bg-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px', gap: '8px' }}>
                        <div>
                          <p style={{ margin: '0 0 2px', fontSize: '11px', color: 'var(--text-muted)' }}>DDx #{i + 1}</p>
                          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{item.name ?? '—'}</h3>
                        </div>
                        {item.likelihood && (
                          <span style={{
                            fontSize: '11px', fontWeight: 600, flexShrink: 0,
                            color: likelihoodColor(item.likelihood),
                          }}>
                            가능도 {item.likelihood}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px' }}>
                          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>근거</p>
                          {Array.isArray(item.reasons) && item.reasons.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: 'var(--text)', lineHeight: 1.5 }}>
                              {item.reasons.map((r, ri) => <li key={ri}>{r}</li>)}
                            </ul>
                          ) : <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>—</p>}
                        </div>
                        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px' }}>
                          <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>추천 검사</p>
                          {Array.isArray(item.tests) && item.tests.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: 'var(--text)', lineHeight: 1.5 }}>
                              {item.tests.map((t, ti) => <li key={ti}>{t}</li>)}
                            </ul>
                          ) : <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>—</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (ddxResult || consultation.ddx) ? (
                <pre style={{ margin: 0, fontSize: '13px', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', lineHeight: 1.6 }}>
                  {ddxResult || consultation.ddx}
                </pre>
              ) : null}
            </div>
          )}

          {/* Draft DDx from survey */}
          {surveyDetail?.draftDdx && !ddxResult && !consultation.ddx && (
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>사전문진 초안 DDx</h2>
              <pre style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', lineHeight: 1.6 }}>
                {surveyDetail.draftDdx}
              </pre>
            </div>
          )}

          {/* No results yet placeholder */}
          {!ddxResult && !consultation.ddx && !ddxError && !surveyDetail?.draftDdx && (
            <div style={{ ...cardStyle, textAlign: 'center', padding: '40px 20px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 16px' }}>
                위의 "감별 진단 실행" 버튼을 눌러 AI 감별진단을 생성하세요.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
