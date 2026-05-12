'use client';

import type { ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';
import { parseChartAdminHospitalsResponse } from '@/lib/chart-extraction/chart-admin-hospitals';
import type { CSSProperties } from 'react';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useChartExtraction } from '@/components/chart-extraction-provider';
import AdminDataConsole from '@/components/admin-data-console';

const MAX_PDF_BYTES = 30 * 1024 * 1024;

type UploadSection = 'pdf' | 'stats' | 'collect';

type CollectStepResult = { index: number; total: number; name: string; durationSec: number };
type CollectUpsertItem = { label: string; count: number };
type CollectRunResult = { ok: boolean; output: string; steps: CollectStepResult[]; upserts: CollectUpsertItem[] };

export default function AdminDataUpload() {
  const searchParams = useSearchParams();
  const [section, setSection] = useState<UploadSection>('pdf');
  const { startExtract, status, error: extractError } = useChartExtraction();
  const [localError, setLocalError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<string>('intovet');
  const [hospitals, setHospitals] = useState<ChartHospitalOption[]>([]);
  const [hospitalsLoading, setHospitalsLoading] = useState(true);
  const [hospitalsError, setHospitalsError] = useState<string | null>(null);
  const [patchRunId, setPatchRunId] = useState('');
  const [patchJson, setPatchJson] = useState(
    '{\n  "section": "basicInfo",\n  "basicInfo": {\n    "patientName": "수정 예시"\n  }\n}',
  );
  const [patchBusy, setPatchBusy] = useState(false);
  const [patchMessage, setPatchMessage] = useState<string | null>(null);

  const [collectHospitalId, setCollectHospitalId] = useState('');
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectResult, setCollectResult] = useState<CollectRunResult | null>(null);
  const [collectError, setCollectError] = useState<string | null>(null);

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    const formData = new FormData(event.currentTarget);
    const file = formData.get('file');
    const hospitalId = formData.get('hospitalId');
    if (typeof hospitalId !== 'string' || !hospitalId.trim()) {
      setLocalError('병원을 선택해 주세요.');
      return;
    }
    if (file instanceof File && file.size > MAX_PDF_BYTES) {
      setLocalError(`PDF는 ${MAX_PDF_BYTES / 1024 / 1024}MB 이하만 업로드할 수 있습니다.`);
      return;
    }
    formData.delete('chartPasteText');
    formData.delete('efriendsChartBlocksJson');
    await startExtract(formData);
  }

  async function sendPatch() {
    setPatchMessage(null);
    if (!patchRunId.trim()) {
      setPatchMessage('보정할 runId를 입력해 주세요.');
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(patchJson);
    } catch {
      setPatchMessage('보정 JSON 형식이 올바르지 않습니다.');
      return;
    }
    setPatchBusy(true);
    try {
      const res = await fetch(`/api/admin/runs/${encodeURIComponent(patchRunId.trim())}/extraction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || '보정 실패');
      setPatchMessage('보정이 반영되었습니다.');
    } catch (e) {
      setPatchMessage(`보정 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPatchBusy(false);
    }
  }

  async function runCollect(hospitalId?: string) {
    setCollectBusy(true);
    setCollectResult(null);
    setCollectError(null);
    try {
      const res = await fetch('/api/admin/collect/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(hospitalId ? { hospitalId } : {}),
      });
      const data = (await res.json()) as CollectRunResult & { error?: string };
      if (!res.ok) {
        setCollectError(data.error ?? '수집 실행 중 오류가 발생했습니다.');
        return;
      }
      setCollectResult(data);
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setCollectBusy(false);
    }
  }

  const error = localError ?? (status === 'error' ? extractError : null);
  const canSubmit =
    !isExtractRunning && !hospitalsLoading && hospitals.length > 0 && !hospitalsError;

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
                      disabled={collectBusy || !collectHospitalId || hospitalsLoading}
                      onClick={() => void runCollect(collectHospitalId)}
                    >
                      {collectBusy ? '수집 중…' : '선택 병원 수집'}
                    </button>
                    <button
                      type="button"
                      className="adminLegacySecondaryBtn"
                      disabled={collectBusy}
                      onClick={() => void runCollect()}
                    >
                      {collectBusy ? '수집 중…' : '전체 병원 수집'}
                    </button>
                  </div>
                  {collectBusy && (
                    <p style={{ margin: 0, fontSize: 13, color: '#1d4ed8' }}>
                      수집 실행 중입니다. 완료될 때까지 창을 닫지 마세요…
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

              {collectResult && (
                <>
                  {/* 성공/실패 배너 */}
                  <div
                    className="adminLegacyBlockBleed"
                    style={{
                      background: collectResult.ok ? '#f0fdf4' : '#fef2f2',
                      borderBottom: `1px solid ${collectResult.ok ? 'rgba(22,163,74,0.2)' : 'rgba(185,28,28,0.2)'}`,
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 700,
                        color: collectResult.ok ? '#15803d' : '#991b1b',
                      }}
                    >
                      {collectResult.ok ? '✓ 수집 완료' : '✗ 수집 실패'}
                    </p>
                  </div>

                  {/* 수집 결과 요약 */}
                  <div className="adminLegacyBlockBleed">
                    <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#334155' }}>
                      수집 결과
                    </p>
                    {collectResult.upserts.length > 0 ? (
                      <div
                        style={{
                          display: 'grid',
                          gap: 8,
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: '12px 14px',
                        }}
                      >
                        {collectResult.upserts.map((u) => (
                          <div
                            key={u.label}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 13,
                              color: '#0f172a',
                            }}
                          >
                            <span>{u.label}</span>
                            <span
                              style={{
                                fontWeight: 700,
                                color: '#1d4ed8',
                                background: '#eff6ff',
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 12,
                              }}
                            >
                              {u.count.toLocaleString()}건
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                        모든 데이터가 이미 최신 상태입니다. (신규 수집 없음)
                      </p>
                    )}
                  </div>

                  {/* 실행 단계 */}
                  {collectResult.steps.length > 0 && (
                    <div className="adminLegacyBlockBleed">
                      <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#334155' }}>
                        실행 단계
                      </p>
                      <ol
                        style={{
                          margin: 0,
                          padding: 0,
                          listStyle: 'none',
                          display: 'grid',
                          gap: 4,
                        }}
                      >
                        {collectResult.steps.map((s) => (
                          <li
                            key={`${s.index}-${s.name}`}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 13,
                              color: '#475569',
                              padding: '4px 0',
                              borderBottom: '1px solid rgba(15,23,42,0.05)',
                            }}
                          >
                            <span>
                              <span style={{ color: '#15803d', marginRight: 6 }}>✓</span>
                              {s.index}. {s.name}
                            </span>
                            <span style={{ color: '#94a3b8', fontSize: 12, flexShrink: 0, marginLeft: 8 }}>
                              {s.durationSec.toFixed(1)}s
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* 상세 로그 */}
                  <details className="adminMainAccordion">
                    <summary
                      className="adminAccordionSummary"
                      style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, listStyle: 'none', padding: '12px 0' }}
                    >
                      상세 로그 보기
                    </summary>
                    <pre
                      style={{
                        margin: '8px 0 16px',
                        fontSize: 11,
                        lineHeight: 1.6,
                        color: '#334155',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        padding: 14,
                        overflow: 'auto',
                        maxHeight: 400,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {collectResult.output}
                    </pre>
                  </details>
                </>
              )}
            </>
          ) : section === 'pdf' ? (
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
                  PDF 업로드
                </h1>
                <p style={{ margin: '0 0 8px', color: '#475569', fontSize: 14, lineHeight: 1.55 }}>
                  PDF 파일을 업로드하면 차트 본문·접종·검사 등을 의미 단위 버킷으로 나누어 저장합니다. 완료 후 실행
                  ID로 후속 작업(보정 등)을 이어갈 수 있습니다.
                </p>
                <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
                  업로드 가능한 PDF 크기는 최대 30MB입니다. 텍스트가 없는 스캔 전용 PDF는 지원하지 않습니다(OCR
                  미포함).
                </p>
              </header>

              <div className="adminLegacyBlockBleed">
                <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: 14 }}>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: 16,
                      }}
                    >
                      <div style={{ display: 'grid', gap: 6 }}>
                        <label htmlFor="hospitalId" style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                          병원 <span style={{ color: '#b91c1c', fontWeight: 700 }}>필수</span>
                        </label>
                        {hospitalsLoading ? (
                          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#64748b' }}>병원 목록 불러오는 중…</p>
                        ) : hospitalsError ? (
                          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#b91c1c' }}>{hospitalsError}</p>
                        ) : hospitals.length === 0 ? (
                          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#475569' }}>
                            등록된 병원이 없습니다.{' '}
                            <Link href="/admin/users/hospitals" style={{ fontWeight: 700, color: '#0f172a' }}>
                              병원 관리
                            </Link>
                            에서 병원을 추가해 주세요.
                          </p>
                        ) : (
                          <select id="hospitalId" name="hospitalId" required defaultValue="" style={selectLineStyle}>
                            <option value="" disabled>
                              병원 선택
                            </option>
                            {hospitals.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name_ko}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <label htmlFor="chartType" style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                          차트 종류
                        </label>
                        <select
                          id="chartType"
                          name="chartType"
                          value={chartType}
                          onChange={(e) => setChartType(e.target.value)}
                          style={selectLineStyle}
                        >
                          <option value="intovet">인투벳</option>
                          <option value="plusvet">플러스벳</option>
                          <option value="efriends">이프렌즈</option>
                          <option value="other">기타</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <label htmlFor="file" style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                        PDF 파일
                      </label>
                      <input id="file" name="file" type="file" accept=".pdf,application/pdf" required />
                    </div>
                  </div>
                  <div className="adminLegacyActions" style={{ marginTop: 4 }}>
                    <button type="submit" className="adminLegacyPrimaryBtn" disabled={!canSubmit}>
                      {isExtractRunning ? '처리 중...' : '실행'}
                    </button>
                  </div>
                </form>
              </div>

              {error ? (
                <div
                  className="adminLegacyBlockBleed"
                  style={{
                    color: '#991b1b',
                    borderBottom: '1px solid rgba(185, 28, 28, 0.25)',
                  }}
                >
                  <p style={{ margin: 0, fontSize: 14 }}>{error}</p>
                </div>
              ) : null}

              <details className="adminMainAccordion">
                <summary
                  className="adminAccordionSummary"
                  style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14, listStyle: 'none' }}
                >
                  고급: 추출 결과 보정 (PATCH /api/admin/runs/…/extraction)
                </summary>
                <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                  <label style={{ gridColumn: '1 / -1' }}>
                    runId
                    <input value={patchRunId} onChange={(e) => setPatchRunId(e.target.value)} disabled={patchBusy} />
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>
                    patch JSON
                    <textarea
                      value={patchJson}
                      onChange={(e) => setPatchJson(e.target.value)}
                      rows={10}
                      disabled={patchBusy}
                    />
                  </label>
                  <div className="adminLegacyActions" style={{ gridColumn: '1 / -1' }}>
                    <button
                      type="button"
                      className="adminLegacySecondaryBtn"
                      onClick={() => void sendPatch()}
                      disabled={patchBusy}
                    >
                      보정 반영
                    </button>
                  </div>
                  {patchMessage ? (
                    <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 13, color: '#475569' }}>{patchMessage}</p>
                  ) : null}
                </div>
              </details>
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
