'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useHospital } from '@/components/shell/hospital-context';
import { CenteredSpinner } from '@/components/ui/loading-spinner';
import { StickyHeader } from '@/components/ui/sticky-header';
import { ddxGet, ddxPost, DdxApiForbiddenError } from '@/lib/ddx-api';
import { inputStyle, textareaStyle, primaryPillStyle } from '@/lib/form-styles';
import { DOG_BREEDS, CAT_BREEDS, SEX_OPTIONS } from '@/lib/intake/form-spec';
import { Modal } from '@/components/ui/modal';
import {
  SessionDetailView,
  Section, Row, CopyBtn, StatusBadge, SurveyKakaoSend, AnswersModal,
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
  scheduledDate?: string | null;
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
  const [resendFor, setResendFor] = useState<SessionListItem | null>(null);
  const [answersDetail, setAnswersDetail] = useState<SessionDetail | null>(null);

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

  // 목록의 '문진 답변' 버튼 — 해당 세션 상세를 불러와 답변 모달로 띄운다(선택 행과 독립).
  const openAnswers = useCallback((id: string) => {
    if (!userId) return;
    ddxGet<{ success: boolean; session: SessionDetail }>(
      `/api/surveys/sessions/${encodeURIComponent(id)}`, userId,
    )
      .then((data) => { if (data.success && data.session) setAnswersDetail(data.session); })
      .catch(() => { /* 무시 */ });
  }, [userId]);

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
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            보호자에게 사전문진 링크를 보내고, 제출된 답변과 AI 사전 분석을 확인합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            padding: '9px 16px', border: 'none', borderRadius: 'var(--radius)',
            background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          + 사전문진 발송
        </button>
      </div>
      </StickyHeader>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 14, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
        {/* ── 좌측: 목록 ── */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <div style={{ padding: '0 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              사전문진 목록
              {sessions.length > 0 && (
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  {filtered.length === sessions.length ? `${sessions.length}건` : `${filtered.length} / ${sessions.length}건`}
                </span>
              )}
            </span>
            <button onClick={() => userId && loadSessions(userId)}
              style={{ background: 'none', border: 'none', fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}>
              새로고침
            </button>
          </div>

          {loading ? (
            <Spinner />
          ) : sessions.length === 0 ? (
            <div style={{ padding: '48px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>아직 발송된 사전문진이 없습니다</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>“사전문진 발송”으로 보호자에게 문진 링크를 보내보세요.</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="환자·보호자·연락처 검색"
                  style={{ width: '100%', padding: '8px 10px', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>

              {filtered.length === 0 ? (
                <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 14, color: 'var(--text-muted)' }}>검색 결과가 없습니다.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle)' }}>
                      {['발송일시', '제출일시', '환자', '보호자', '상태', '액션'].map((h) => (
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
                        <td style={tdStyle}>
                          {s.completedAt ? fmtDateTime(s.completedAt) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--text)' }}>{s.patientName || '—'}</td>
                        <td style={tdStyle}>{s.guardianName || '—'}</td>
                        <td style={{ ...tdStyle }}>
                          <StatusBadge status={s.status} label={STATUS_LABEL[s.status] ?? s.status} />
                        </td>
                        <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                          {s.status === 'pending' ? (
                            s.token ? (
                              <button type="button" onClick={() => setResendFor(s)} style={resendBtnStyle}>재발송</button>
                            ) : <span style={{ color: 'var(--text-muted)' }}>—</span>
                          ) : s.status === 'completed' ? (
                            <button type="button" onClick={() => openAnswers(s.id)} style={answersBtnStyle}>문진 답변</button>
                          ) : (
                            // 만료(미제출) — 답변이 없으므로 미응답
                            <span style={{ color: 'var(--text-muted)' }}>미응답</span>
                          )}
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
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>사전문진 상세</div>
          </div>
          {!selectedId ? (
            <div style={{ fontSize: 14, color: 'var(--text-muted)', padding: '8px 0' }}>왼쪽에서 항목을 선택하세요.</div>
          ) : detailLoading && !detail ? (
            <Spinner />
          ) : detail ? (
            <SessionDetailView detail={detail} origin={origin} hideAnswersButton />
          ) : (
            <div style={{ fontSize: 14, color: 'var(--text-muted)', padding: '8px 0' }}>상세를 불러오지 못했습니다.</div>
          )}
        </div>
      </div>

      {modalOpen && userId && (
        <SendModal userId={userId} origin={origin} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
      )}

      {resendFor && (
        <Modal title={`재발송${resendFor.patientName ? ` — ${resendFor.patientName}` : ''}`} onClose={() => setResendFor(null)} maxWidth={480}>
          <div style={{ display: 'grid', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              아래에서 <b>링크를 복사</b>하거나 <b>카카오톡으로 발송</b>하세요.
            </p>
            {origin && resendFor.token && (
              <div>
                <p style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>작성 링크</p>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text)', wordBreak: 'break-all', lineHeight: 1.6 }}>{`${origin}/survey/${resendFor.token}`}</span>
                  <CopyBtn text={`${origin}/survey/${resendFor.token}`} label="복사" />
                </div>
              </div>
            )}
            {resendFor.token && (
              <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <SurveyKakaoSend
                  token={resendFor.token}
                  defaultPhone={resendFor.contact ?? ''}
                  patientName={resendFor.patientName ?? ''}
                  guardianName={resendFor.guardianName ?? ''}
                  scheduledDate={resendFor.scheduledDate ?? ''}
                />
              </div>
            )}
          </div>
        </Modal>
      )}

      {answersDetail && <AnswersModal detail={answersDetail} onClose={() => setAnswersDetail(null)} />}
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
  const [visitType, setVisitType] = useState('신규환자');
  const [petSpecies, setPetSpecies] = useState('');
  const [petBreed, setPetBreed] = useState('');
  const [petSex, setPetSex] = useState('');
  const [previousChart, setPreviousChart] = useState('');
  const isExisting = visitType === '새 증상' || visitType === '경과 확인';
  const breedOptions = petSpecies === '강아지' ? DOG_BREEDS : petSpecies === '고양이' ? CAT_BREEDS : null;
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<{ id: string; token?: string | null } | null>(null);

  const shareUrl = created && origin && created.token ? `${origin}/survey/${created.token}` : '';

  // 입력값 검증 + 세션 생성. 성공 시 생성된 세션을 반환(없으면 null, 에러는 setErr 로 표시). throw 는 호출부에서 처리.
  const createSession = async (): Promise<{ id: string; token?: string | null } | null> => {
    if (!contact.trim()) { setErr('연락처를 입력해 주세요.'); return null; }
    if (!scheduledDate) { setErr('내원 예정일을 선택해 주세요. (알림톡 본문에 들어갑니다)'); return null; }
    if (visitType === '경과 확인' && !previousChart.trim()) { setErr('경과 확인 사전문진은 이전 차트 내용이 필요합니다.'); return null; }
    if (isExisting && (!petSpecies || !petSex)) { setErr('기존 환자는 종류와 성별을 입력해 주세요.'); return null; }
    setErr('');
    const body: Record<string, string> = { userId, contact: contact.trim(), visitType };
    if (patientName.trim()) body.patientName = patientName.trim();
    if (guardianName.trim()) body.guardianName = guardianName.trim();
    if (scheduledDate) body.scheduledDate = scheduledDate;
    if (visitType === '경과 확인' && previousChart.trim()) body.previousChart = previousChart.trim();
    if (isExisting) {
      body.petSpecies = petSpecies;
      if (petBreed.trim()) body.petBreed = petBreed.trim();
      body.petSex = petSex;
    }

    const res = await ddxPost<{ success: boolean; session?: { id: string; token?: string | null }; error?: string }>(
      '/api/surveys/sessions', userId, body,
    );
    if (res.success && res.session) {
      const session = { id: res.session.id, token: res.session.token };
      setCreated(session);
      onCreated(session);
      return session;
    }
    setErr(res.error || '사전문진 생성에 실패했습니다.');
    return null;
  };

  const handleCreateError = (e: unknown) => {
    if (e instanceof DdxApiForbiddenError) setErr('ddx-api 계정 동기화가 필요합니다. 관리자에게 문의하세요.');
    else setErr(e instanceof Error ? e.message : '사전문진 생성 중 오류가 발생했습니다.');
  };

  // "발송 링크 생성" — 세션만 생성하고 다음 화면(링크 복사 + 카카오 발송)으로.
  const submit = async () => {
    setSubmitting(true);
    try { await createSession(); }
    catch (e) { handleCreateError(e); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal
      title={created ? '사전문진 발송 완료' : '사전문진 발송'}
      onClose={onClose}
      footer={created ? (
        <button type="button" onClick={onClose} style={primaryPillStyle()}>완료</button>
      ) : (
        <button type="button" onClick={submit} disabled={submitting} style={primaryPillStyle(submitting)}>
          {submitting ? '생성 중…' : '발송 링크 생성'}
        </button>
      )}
    >
      {created ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            발송 링크가 생성되었습니다. 아래에서 <b>링크를 복사</b>하거나 <b>카카오톡으로 발송</b>하세요.
            보호자가 작성을 완료하면 자동으로 AI 사전 분석이 진행됩니다.
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text)', wordBreak: 'break-all', lineHeight: 1.6 }}>{shareUrl || '링크 생성 실패'}</span>
            {shareUrl && <CopyBtn text={shareUrl} label="복사" />}
          </div>
          {created.token && (
            <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <SurveyKakaoSend token={created.token} defaultPhone={contact} patientName={patientName} guardianName={guardianName} scheduledDate={scheduledDate} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {err && (
            <div style={{ padding: '10px 12px', background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 14 }}>{err}</div>
          )}
          <Field label="방문 유형">
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { v: '신규환자', label: '신규환자', desc: '본원 첫 내원' },
                { v: '새 증상', label: '(기존 환자) 새 증상', desc: '새로운 증상/질환' },
                { v: '경과 확인', label: '(기존 환자) 경과 확인', desc: '치료 중인 질환 재진' },
              ].map((o) => {
                const on = visitType === o.v;
                return (
                  <button key={o.v} type="button" className="hospBtnFree" onClick={() => setVisitType(o.v)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '11px 14px', borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
                      background: on ? 'var(--accent-subtle)' : 'var(--bg)',
                      color: on ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: on ? 700 : 500, fontSize: 14,
                    }}>
                    <span>{o.label}</span>
                    <span style={{ fontSize: 11, color: on ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 500 }}>{o.desc}</span>
                  </button>
                );
              })}
            </div>
          </Field>
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
          <Field label="내원 예정일" required>
            <input style={inputStyle} type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
          </Field>
          {isExisting && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="동물 분류" required>
                <select style={inputStyle} value={petSpecies} onChange={(e) => { setPetSpecies(e.target.value); setPetBreed(''); }}>
                  <option value="">선택</option>
                  <option value="강아지">강아지</option>
                  <option value="고양이">고양이</option>
                  <option value="그 외">그 외</option>
                </select>
              </Field>
              <Field label="품종">
                {breedOptions ? (
                  <select style={inputStyle} value={petBreed} onChange={(e) => setPetBreed(e.target.value)}>
                    <option value="">선택</option>
                    {breedOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                ) : (
                  <input style={inputStyle} value={petBreed} onChange={(e) => setPetBreed(e.target.value)} placeholder={petSpecies ? '품종 입력' : '동물 분류 먼저'} disabled={!petSpecies} />
                )}
              </Field>
              <Field label="성별" required>
                <select style={inputStyle} value={petSex} onChange={(e) => setPetSex(e.target.value)}>
                  <option value="">선택</option>
                  {SEX_OPTIONS.map((s) => <option key={s.value} value={s.label}>{s.label}</option>)}
                </select>
              </Field>
            </div>
          )}
          {visitType === '경과 확인' && (
            <Field label="이전 차트 내용" required>
              <textarea style={{ ...textareaStyle, resize: 'vertical', minHeight: 90 }} value={previousChart} onChange={(e) => setPreviousChart(e.target.value)}
                placeholder="지난 진료 차트를 붙여넣으면 AI가 경과 확인 맞춤 질문을 생성합니다." rows={4} />
            </Field>
          )}
          <p style={{ margin: '-2px 0 0', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {visitType === '경과 확인'
              ? '이전 차트를 바탕으로 AI 맞춤 질문이 생성됩니다.'
              : visitType === '새 증상'
                ? '보호자·환자 기본 정보는 생략하고 증상 위주로 묻습니다.'
                : '전체 사전문진 질문이 사용됩니다.'}
          </p>
        </div>
      )}
    </Modal>
  );
}

// ─── 발송 모달 전용 작은 컴포넌트 ──────────────────────────
function Spinner() {
  return <CenteredSpinner minHeight={240} />;
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


const thStyle: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)',
  fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const tdStyle: CSSProperties = {
  padding: '11px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};
const actionBtnBase: CSSProperties = {
  padding: '5px 10px', fontSize: 14, fontWeight: 600, borderRadius: 'var(--radius)',
  cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 76, textAlign: 'center',
};
// 재발송(대기 중) = 진한 회색, 문진 답변(제출 완료) = success(초록) — 솔리드 톤으로 구분.
const resendBtnStyle: CSSProperties = {
  ...actionBtnBase, color: '#fff', background: '#4e5968', border: 'none',
};
const answersBtnStyle: CSSProperties = {
  ...actionBtnBase, color: '#fff', background: 'var(--success)', border: 'none',
};
