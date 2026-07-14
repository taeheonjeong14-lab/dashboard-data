'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useHospital } from '@/components/shell/hospital-context';
import { ddxGet, ddxPost, DdxApiForbiddenError } from '@/lib/ddx-api';
import { inputStyle, textareaStyle, SegmentedToggle, primaryPillStyle } from '@/lib/form-styles';
import { SectionTitle } from '@/components/ui/typography';

type SessionListItem = {
  id: string;
  patientName: string | null;
  guardianName: string | null;
  contact?: string | null;
  visitType?: string | null;
  status: string;
  createdAt: string;
  analysisStatus?: string;
  isUsed?: boolean;
};

type Question = { id: string; order: number; text: string; type: string };
type Answer = { questionInstanceId: string; answerText: string | null; answerJson: unknown };
type SessionDetail = {
  id: string;
  patientName: string | null;
  guardianName: string | null;
  contact: string | null;
  visitType: string | null;
  draftSummary?: string | null;
  questions: Question[];
  answers: Answer[];
};

function answerDisplay(a: Answer | undefined): string {
  if (!a) return '';
  if (Array.isArray(a.answerJson)) return (a.answerJson as string[]).join(', ');
  if (typeof a.answerJson === 'string' && a.answerJson.trim()) return a.answerJson;
  return a.answerText ?? '';
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }); } catch { return iso; }
}

export default function StartConsultationPage() {
  const router = useRouter();
  const { userId } = useHospital();

  const [surveys, setSurveys] = useState<SessionListItem[]>([]);
  const [surveysLoading, setSurveysLoading] = useState(true);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);

  const [patientName, setPatientName] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [visitType, setVisitType] = useState('초진');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 완료된 미사용 사전문진 목록
  useEffect(() => {
    if (!userId) return;
    setSurveysLoading(true);
    ddxGet<{ success: boolean; sessions: SessionListItem[] }>('/api/surveys/sessions?take=200', userId)
      .then((data) => {
        if (data.success && Array.isArray(data.sessions)) {
          setSurveys(data.sessions.filter((s) => s.status === 'completed' && !s.isUsed));
        }
      })
      .catch(() => { /* 무시 — 직접 입력 가능 */ })
      .finally(() => setSurveysLoading(false));
  }, [userId]);

  const selectSurvey = (s: SessionListItem | null) => {
    if (!s) {
      setSelectedSurveyId(null);
      return;
    }
    setSelectedSurveyId(s.id);
    if (s.patientName) setPatientName(s.patientName);
    if (s.guardianName) setGuardianName(s.guardianName);
    if (s.visitType) setVisitType(s.visitType);
  };

  const handleStart = async () => {
    if (!userId) return;
    if (!patientName.trim()) { setError('환자 이름을 입력해 주세요.'); return; }
    setError('');
    setSubmitting(true);

    try {
      // 사전문진을 선택했으면 답변을 transcript 로 합성
      let surveyText = '';
      if (selectedSurveyId) {
        try {
          const d = await ddxGet<{ success: boolean; session: SessionDetail }>(
            `/api/surveys/sessions/${encodeURIComponent(selectedSurveyId)}`, userId,
          );
          if (d.success && d.session) {
            const lines = [...d.session.questions]
              .sort((a, b) => a.order - b.order)
              .map((q) => {
                const disp = answerDisplay(d.session.answers?.find((a) => a.questionInstanceId === q.id));
                return disp ? `Q: ${q.text}\nA: ${disp}` : null;
              })
              .filter(Boolean)
              .join('\n\n');
            if (lines) surveyText = `사전문진 답변:\n${lines}`;
          }
        } catch { /* 상세 조회 실패해도 진료 생성은 진행 */ }
      }

      const transcript = [
        `환자: ${patientName.trim()}`,
        guardianName.trim() ? `보호자: ${guardianName.trim()}` : '',
        `방문 유형: ${visitType}`,
        notes.trim() ? `\n진료 메모:\n${notes.trim()}` : '',
        surveyText ? `\n${surveyText}` : '',
      ].filter(Boolean).join('\n');

      const res = await ddxPost<{ success?: boolean; id?: string; sessionId?: string; error?: string }>(
        '/api/consultations', userId, {
          userId,
          patientName: patientName.trim(),
          guardianName: guardianName.trim() || undefined,
          visitType,
          surveySessionId: selectedSurveyId || undefined,
          transcript,
          status: 'recording',
        },
      );

      if (res.sessionId) {
        router.push(`/ai-assist/${encodeURIComponent(res.sessionId)}`);
      } else {
        setError(res.error || '진료 생성에 실패했습니다.');
        setSubmitting(false);
      }
    } catch (err) {
      if (err instanceof DdxApiForbiddenError) setError('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
      else setError(err instanceof Error ? err.message : '진료 생성 중 오류가 발생했습니다.');
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>진료 시작</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            사전문진에서 시작하거나, 환자 정보를 직접 입력하세요.
          </p>
        </div>
        <Link href="/ai-assist" style={{ ...btnSecondary, textDecoration: 'none' }}>목록으로</Link>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 14, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* 사전문진 선택 */}
      <div style={cardStyle}>
        <SectionTitle hint="(선택)" style={{ marginBottom: 4 }}>사전문진에서 시작</SectionTitle>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-muted)' }}>완료된 사전문진을 선택하면 답변이 진료에 반영됩니다.</p>
        {surveysLoading ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중...</p>
        ) : surveys.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>사용 가능한 완료 사전문진이 없습니다. 아래에 직접 입력해 주세요.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
            <button type="button" onClick={() => selectSurvey(null)}
              style={pickRow(selectedSurveyId === null)}>
              <span style={{ fontWeight: 600 }}>사전문진 없이 시작</span>
            </button>
            {surveys.map((s) => (
              <button key={s.id} type="button" onClick={() => selectSurvey(s)} style={pickRow(selectedSurveyId === s.id)}>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>{s.patientName || '(이름 없음)'}{s.guardianName ? ` / ${s.guardianName}` : ''}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.visitType || '—'} · {fmtDate(s.createdAt)} 제출</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 환자 정보 */}
      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="환자 이름" required>
            <input style={inputStyle} value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="예: 뽀미" />
          </Field>
          <Field label="보호자 성명">
            <input style={inputStyle} value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="예: 홍길동" />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="방문 유형">
            <SegmentedToggle options={['초진', '재진']} value={visitType} onChange={setVisitType} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="진료 메모 / 대화 내용 (선택)">
            <textarea style={{ ...textareaStyle, resize: 'vertical', minHeight: 96 }} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="진료 중 메모나 대화 내용을 붙여넣으면 AI 감별진단·요약에 활용됩니다." rows={4} />
          </Field>
        </div>
      </div>

      <button type="button" onClick={handleStart} disabled={submitting || !userId}
        style={{ ...primaryPillStyle(submitting || !userId), width: '100%', padding: '13px' }}>
        {submitting ? '진료 생성 중...' : '진료 시작'}
      </button>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
        {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
      </span>
      {children}
    </label>
  );
}

const cardStyle: CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 16,
};
const btnSecondary: CSSProperties = {
  padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center',
};
function pickRow(selected: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left',
    padding: '10px 12px', borderRadius: 'var(--radius)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    background: selected ? 'var(--accent-subtle)' : 'var(--bg)',
    color: selected ? 'var(--accent)' : 'var(--text)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
  };
}
