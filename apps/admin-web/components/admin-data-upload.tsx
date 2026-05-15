'use client';

import type { ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';
import { parseChartAdminHospitalsResponse } from '@/lib/chart-extraction/chart-admin-hospitals';
import type { CSSProperties } from 'react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useChartExtraction } from '@/components/chart-extraction-provider';
import AdminDataConsole from '@/components/admin-data-console';
import { Upload } from 'lucide-react';

const MAX_PDF_BYTES = 30 * 1024 * 1024;

type UploadSection = 'pdf' | 'stats' | 'collect';

type CollectStepResult = { index: number; total: number; name: string; durationSec: number; error?: string };
type CollectUpsertItem = { label: string; count: number; dateRange?: string | null; skipped?: boolean };
type CollectJob = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  output: string | null;
  steps: CollectStepResult[] | null;
  upserts: CollectUpsertItem[] | null;
};
type CollectHistoryItem = {
  id: string;
  hospital_id: string | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  steps: CollectStepResult[] | null;
  upserts: CollectUpsertItem[] | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

function formatKst(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function durationSec(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  const sec = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '대기 중',
  running: '수집 중',
  done: '완료',
  failed: '실패',
};
const STATUS_COLOR: Record<string, string> = {
  pending: '#64748b',
  running: '#1d4ed8',
  done: '#15803d',
  failed: '#991b1b',
};

export default function AdminDataUpload() {
  const searchParams = useSearchParams();
  const [section, setSection] = useState<UploadSection>('pdf');
  const { startExtract, status, error: extractError } = useChartExtraction();
  const [localError, setLocalError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<string>('intovet');
  const [hospitals, setHospitals] = useState<ChartHospitalOption[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(true);
  const [hospitalsError, setHospitalsError] = useState<string | null>(null);
  const [extractSuccess, setExtractSuccess] = useState(false);
  const prevExtractStatus = useRef(status);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [collectHospitalId, setCollectHospitalId] = useState('');
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const [collectJob, setCollectJob] = useState<CollectJob | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collectHistory, setCollectHistory] = useState<CollectHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setHospitalsLoading(true);
      setHospitalsError(null);
      try {
        const res = await fetch('/api/admin/data/hospitals', { credentials: 'include' });
        const data = (await res.json()) as { hospitals?: unknown; error?: string };
        if (!res.ok) {
          if (!cancelled) {
            setHospitalsError(data.error ?? '병원 목록을 불러오지 못했습니다.');
            setHospitals([]);
          }
          return;
        }
        if (!cancelled) setHospitals(parseChartAdminHospitalsResponse(data));
      } catch {
        if (!cancelled) {
          setHospitalsError('병원 목록을 불러오지 못했습니다.');
          setHospitals([]);
        }
      } finally {
        if (!cancelled) setHospitalsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const s = searchParams.get('section');
    if (s === 'stats') setSection('stats');
    else if (s === 'collect') setSection('collect');
  }, [searchParams]);

  const isExtractRunning = status === 'running';

  useEffect(() => {
    if (prevExtractStatus.current === 'running' && status === 'idle') {
      setExtractSuccess(true);
    }
    prevExtractStatus.current = status;
  }, [status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setExtractSuccess(false);
    const formData = new FormData(event.currentTarget);
    const hospitalId = formData.get('hospitalId');
    if (typeof hospitalId !== 'string' || !hospitalId.trim()) {
      setLocalError('병원을 선택해 주세요.');
      return;
    }
    if (!selectedFile) {
      setLocalError('PDF 파일을 선택해 주세요.');
      return;
    }
    if (selectedFile.size > MAX_PDF_BYTES) {
      setLocalError(`PDF는 ${MAX_PDF_BYTES / 1024 / 1024}MB 이하만 업로드할 수 있습니다.`);
      return;
    }
    formData.set('file', selectedFile);
    formData.delete('chartPasteText');
    formData.delete('efriendsChartBlocksJson');
    await startExtract(formData);
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/admin/collect/jobs', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: CollectHistoryItem[] };
      setCollectHistory(data.jobs ?? []);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (section === 'collect') void loadHistory();
  }, [section]);

  async function runCollect(hospitalId?: string) {
    setCollectSubmitting(true);
    setCollectJob(null);
    setCollectError(null);
    try {
      const res = await fetch('/api/admin/collect/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(hospitalId ? { hospitalId } : {}),
      });
      const data = (await res.json()) as { ok?: boolean; jobId?: string; error?: string };
      if (!res.ok || !data.jobId) {
        setCollectError(data.error ?? '수집 요청 생성에 실패했습니다.');
        return;
      }
      setCollectJob({ id: data.jobId, status: 'pending', output: null, steps: null, upserts: null });
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setCollectSubmitting(false);
    }
  }

  useEffect(() => {
    if (!collectJob || collectJob.status === 'done' || collectJob.status === 'failed') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/collect/status/${collectJob.id}`, { credentials: 'include' });
        if (!res.ok) return;
        const job = (await res.json()) as CollectJob;
        setCollectJob(job);
        void loadHistory();
      } catch {
        // 폴링 오류는 무시하고 계속 시도
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [collectJob?.id, collectJob?.status]);

  const error = localError ?? (status === 'error' ? extractError : null);
  const canSubmit =
    !isExtractRunning && !hospitalsLoading && hospitals.length > 0 && !hospitalsError && !!selectedFile;

  const selectLineStyle: CSSProperties = {
    padding: '10px 0',
    border: 0,
    borderBottom: '1px solid rgba(15, 23, 42, 0.1)',
    borderRadius: 0,
    background: 'transparent',
    color: '#0f172a',
    font: 'inherit',
    width: '100%',
  };

  return (
    <div className="adminLayoutMainPane">
      <div className="adminLayoutMainColumnInset">
          {section === 'collect' ? (
            <>
              <header style={{ marginBottom: 20 }}>
                <h1
                  style={{
                    fontSize: 22,
                    margin: '0 0 8px',
                    fontWeight: 700,
                    color: '#0f172a',
                    letterSpacing: '-0.02em',
                  }}
                >
                  자동 수집
                </h1>
                <p style={{ margin: 0, color: '#475569', fontSize: 14, lineHeight: 1.55 }}>
                  블로그 일별 지표 → 스마트플레이스 유입 → 키워드 순위 → SearchAd 성과를 순서대로 수집합니다.
                </p>
              </header>

              <div className="adminLegacyBlockBleed">
                <div style={{ display: 'grid', gap: 14 }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <label htmlFor="collectHospitalId" style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                      병원
                    </label>
                    {hospitalsLoading ? (
                      <p style={{ margin: '8px 0 0', fontSize: 13, color: '#64748b' }}>병원 목록 불러오는 중…</p>
                    ) : hospitalsError ? (
                      <p style={{ margin: '8px 0 0', fontSize: 13, color: '#b91c1c' }}>{hospitalsError}</p>
                    ) : (
                      <select
                        id="collectHospitalId"
                        value={collectHospitalId}
                        onChange={(e) => setCollectHospitalId(e.target.value)}
                        style={selectLineStyle}
                      >
                        <option value="">병원 선택</option>
                        {hospitals.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name_ko}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="adminLegacyPrimaryBtn"
                      disabled={collectSubmitting || !collectHospitalId || hospitalsLoading}
                      onClick={() => void runCollect(collectHospitalId)}
                    >
                      {collectSubmitting ? '요청 중…' : '선택 병원 수집'}
                    </button>
                    <button
                      type="button"
                      className="adminLegacySecondaryBtn"
                      disabled={collectSubmitting}
                      onClick={() => void runCollect()}
                    >
                      {collectSubmitting ? '요청 중…' : '전체 병원 수집'}
                    </button>
                  </div>
                  {collectJob && collectJob.status === 'pending' && (
                    <p style={{ margin: 0, fontSize: 13, color: '#1d4ed8' }}>
                      Worker가 곧 수집을 시작합니다… (최대 30초 대기)
                    </p>
                  )}
                </div>
              </div>

              {collectError && (
                <div
                  className="adminLegacyBlockBleed"
                  style={{ color: '#991b1b', borderBottom: '1px solid rgba(185,28,28,0.25)' }}
                >
                  <p style={{ margin: 0, fontSize: 14 }}>{collectError}</p>
                </div>
              )}

              {collectJob && collectJob.status !== 'pending' && (
                <>
                  {/* 상태 배너 */}
                  <div
                    className="adminLegacyBlockBleed"
                    style={{
                      background: collectJob.status === 'done' ? '#f0fdf4' : collectJob.status === 'failed' ? '#fef2f2' : '#eff6ff',
                      borderBottom: `1px solid ${collectJob.status === 'done' ? 'rgba(22,163,74,0.2)' : collectJob.status === 'failed' ? 'rgba(185,28,28,0.2)' : 'rgba(29,78,216,0.2)'}`,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: collectJob.status === 'done' ? '#15803d' : collectJob.status === 'failed' ? '#991b1b' : '#1d4ed8' }}>
                      {collectJob.status === 'done' ? '✓ 수집 완료' : collectJob.status === 'failed' ? '✗ 수집 실패' : '⋯ 수집 실행 중'}
                    </p>
                  </div>

                  {/* 수집 결과 요약 */}
                  {collectJob.upserts && collectJob.upserts.length > 0 && (
                    <div className="adminLegacyBlockBleed">
                      <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#334155' }}>
                        수집 결과{collectJob.status === 'running' ? ' (진행 중)' : ''}
                      </p>
                      <div style={{ display: 'grid', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
                        {collectJob.upserts.map((u) => (
                          <div key={u.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: '#0f172a' }}>
                            <span>{u.label}</span>
                            <span style={{ fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
                              {u.count.toLocaleString()}건
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 실행 단계 */}
                  {collectJob.steps && collectJob.steps.length > 0 && (
                    <div className="adminLegacyBlockBleed">
                      <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#334155' }}>
                        실행 단계{collectJob.status === 'running' ? ' (진행 중)' : ''}
                      </p>
                      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                        {collectJob.steps.map((s) => (
                          <li key={`${s.index}-${s.name}`} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid rgba(15,23,42,0.05)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: s.error ? '#991b1b' : '#475569' }}>
                                <span style={{ color: s.error ? '#b91c1c' : '#15803d', marginRight: 6 }}>{s.error ? '✗' : '✓'}</span>
                                {s.index}. {s.name}
                              </span>
                              <span style={{ color: '#94a3b8', fontSize: 12, flexShrink: 0, marginLeft: 8 }}>{s.durationSec.toFixed(1)}s</span>
                            </div>
                            {s.error && (
                              <p style={{ margin: '3px 0 0 18px', fontSize: 12, color: '#b91c1c', lineHeight: 1.4 }}>{s.error}</p>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* 상세 로그 — 완료/실패 시만 */}
                  {(collectJob.status === 'done' || collectJob.status === 'failed') && (
                    <details className="adminMainAccordion">
                      <summary className="adminAccordionSummary" style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, listStyle: 'none', padding: '12px 0' }}>
                        상세 로그 보기
                      </summary>
                      <pre style={{ margin: '8px 0 16px', fontSize: 11, lineHeight: 1.6, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, overflow: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {collectJob.output}
                      </pre>
                    </details>
                  )}
                </>
              )}

              {/* 수집 이력 */}
              <div className="adminLegacyBlockBleed" style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#334155' }}>최근 수집 이력</p>
                  <button
                    type="button"
                    onClick={() => void loadHistory()}
                    disabled={historyLoading}
                    style={{ fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    {historyLoading ? '불러오는 중…' : '새로고침'}
                  </button>
                </div>
                {collectHistory.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>수집 이력이 없습니다.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {collectHistory.map((h) => {
                      const hospitalName = hospitals.find((x) => x.id === h.hospital_id)?.name_ko ?? h.hospital_id ?? '전체 병원';
                      const upserts = h.upserts ?? [];
                      const failedSteps = (h.steps ?? []).filter((s) => s.error);
                      const hasDetails = upserts.length > 0 || failedSteps.length > 0;
                      return (
                        <div
                          key={h.id}
                          style={{ padding: '10px 12px', background: '#f8fafc', border: `1px solid ${failedSteps.length > 0 ? 'rgba(185,28,28,0.25)' : '#e2e8f0'}`, borderRadius: 6, fontSize: 12 }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasDetails ? 8 : 0 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 600, color: '#0f172a' }}>{hospitalName}</span>
                              <span style={{ color: '#64748b' }}>
                                {formatKst(h.created_at)}
                                {h.finished_at && ` · ${durationSec(h.started_at, h.finished_at)}`}
                              </span>
                            </div>
                            <span style={{ fontWeight: 700, color: STATUS_COLOR[h.status], whiteSpace: 'nowrap', marginLeft: 8 }}>
                              {STATUS_LABEL[h.status]}
                            </span>
                          </div>
                          {failedSteps.length > 0 && (
                            <div style={{ display: 'grid', gap: 4, borderTop: '1px solid rgba(185,28,28,0.2)', paddingTop: 7, marginBottom: upserts.length > 0 ? 8 : 0 }}>
                              {failedSteps.map((s) => (
                                <div key={`${s.index}-${s.name}`} style={{ color: '#991b1b' }}>
                                  <span style={{ fontWeight: 600 }}>✗ {s.index}. {s.name}</span>
                                  {s.error && <span style={{ color: '#b91c1c', marginLeft: 6 }}>— {s.error}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {upserts.length > 0 && (
                            <div style={{ display: 'grid', gap: 3, borderTop: '1px solid #e2e8f0', paddingTop: 7 }}>
                              {upserts.map((u) => (
                                <div key={u.label} style={{ display: 'flex', justifyContent: 'space-between', color: '#475569' }}>
                                  <span>{u.label}</span>
                                  <span style={{ fontWeight: 600, color: u.skipped ? '#94a3b8' : '#1d4ed8' }}>
                                    {u.skipped
                                      ? '이미 최신'
                                      : `${u.count.toLocaleString()}건${u.dateRange ? ` (${u.dateRange})` : ''}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : section === 'pdf' ? (
            <>
              <div className="adminLegacyBlockBleed">
                <form onSubmit={(e) => void onSubmit(e)}>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {/* 병원 + 차트 종류 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <label htmlFor="hospitalId" style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
                          병원
                        </label>
                        {hospitalsLoading ? (
                          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>불러오는 중…</p>
                        ) : hospitalsError ? (
                          <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>{hospitalsError}</p>
                        ) : hospitals.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                            등록된 병원이 없습니다.{' '}
                            <Link href="/admin/users/hospitals" style={{ fontWeight: 700, color: '#0f172a' }}>병원 관리</Link>에서 추가해 주세요.
                          </p>
                        ) : (
                          <select id="hospitalId" name="hospitalId" required defaultValue="" style={selectLineStyle}>
                            <option value="" disabled>병원 선택</option>
                            {hospitals.map((h) => (
                              <option key={h.id} value={h.id}>{h.name_ko}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <label htmlFor="chartType" style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
                          차트 종류
                        </label>
                        <select id="chartType" name="chartType" value={chartType} onChange={(e) => setChartType(e.target.value)} style={selectLineStyle}>
                          <option value="intovet">인투벳</option>
                          <option value="plusvet">플러스벳</option>
                          <option value="efriends">이프렌즈</option>
                          <option value="other">기타</option>
                        </select>
                      </div>
                    </div>

                    {/* 드롭존 + 실행 버튼 */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                      <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                        onDragLeave={() => setIsDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDragOver(false);
                          const file = e.dataTransfer.files[0];
                          if (file) setSelectedFile(file);
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          border: `1.5px dashed ${isDragOver ? '#3b82f6' : selectedFile ? '#22c55e' : '#cbd5e1'}`,
                          borderRadius: 8,
                          padding: '12px 16px',
                          cursor: 'pointer',
                          background: isDragOver ? '#eff6ff' : selectedFile ? '#f0fdf4' : '#f8fafc',
                          transition: 'border-color 0.15s, background 0.15s',
                          userSelect: 'none',
                        }}
                      >
                        <Upload size={18} style={{ color: isDragOver ? '#3b82f6' : selectedFile ? '#16a34a' : '#94a3b8', flexShrink: 0 }} />
                        {selectedFile ? (
                          <div>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#15803d' }}>{selectedFile.name}</p>
                            <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB · 클릭해서 다시 선택</p>
                          </div>
                        ) : (
                          <div>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#334155' }}>PDF 드래그 또는 클릭해서 선택</p>
                            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>최대 30MB · 텍스트 기반 PDF</p>
                          </div>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) setSelectedFile(f); }}
                      />
                      <button type="submit" className="adminLegacyPrimaryBtn" disabled={!canSubmit} style={{ alignSelf: 'stretch', padding: '0 22px', whiteSpace: 'nowrap' }}>
                        {isExtractRunning ? '처리 중…' : '실행'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {isExtractRunning && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: '#1d4ed8' }}>추출 중입니다…</p>
                </div>
              )}
              {!isExtractRunning && extractSuccess && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: '#15803d', fontWeight: 600 }}>✓ 추출 성공했습니다.</p>
                </div>
              )}
              {!isExtractRunning && error && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>{error}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <header style={{ marginBottom: 20 }}>
                <h1
                  style={{
                    fontSize: 22,
                    margin: '0 0 8px',
                    fontWeight: 700,
                    color: '#0f172a',
                    letterSpacing: '-0.02em',
                  }}
                >
                  경영통계 업로드
                </h1>
                <p style={{ margin: 0, color: '#475569', fontSize: 14, lineHeight: 1.55 }}>
                  병원별 실적·엑셀 업로드 및 차트 종류별 안내는 아래 콘솔에서 처리합니다. (기존 <strong>통계</strong>{' '}
                  메뉴에 있던 화면과 동일합니다.)
                </p>
              </header>
              <div className="adminMainSingleGutter" style={{ paddingTop: 0, maxWidth: 1280 }}>
                <AdminDataConsole mode="performance" />
              </div>
            </>
          )}
        </div>
      </div>
  );
}
