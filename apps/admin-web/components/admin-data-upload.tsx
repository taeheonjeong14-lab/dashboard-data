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

const COLLECT_STEPS = [
  { key: 'blog_metrics', label: '블로그 일별 지표' },
  { key: 'smartplace', label: '스마트플레이스 유입' },
  { key: 'keyword_rank', label: '블로그/플레이스 키워드 순위' },
  { key: 'searchad', label: 'SearchAd 일별 성과' },
] as const;

type StepKey = (typeof COLLECT_STEPS)[number]['key'];

function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  style,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} style={style} />;
}

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 50;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type UploadSection = 'pdf' | 'stats' | 'collect';

type CollectStepResult = { index: number; total: number; name: string; durationSec: number; error?: string; hospitalId?: string | null; hospitalName?: string | null };
type CollectLastSuccess = Record<string, Record<string, string>>; // hospitalId → { stepKey → "YYYY-MM-DD" }
type CollectUpsertItem = { label: string; count: number; dateRange?: string | null; skipped?: boolean };
type CollectProgress = Record<string, { done: number; total: number; label?: string | null }>;
type CollectJob = {
  id: string;
  hospital_id: string | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  output: string | null;
  steps: CollectStepResult[] | null;
  upserts: CollectUpsertItem[] | null;
  progress?: CollectProgress | null;
  steps_filter?: string[] | null;
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
  const { startExtract, status, lastRunId, error: extractError } = useChartExtraction();
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageAnalysisStatus, setImageAnalysisStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [imageAnalysisError, setImageAnalysisError] = useState<string | null>(null);
  const prevLastRunId = useRef<string | null>(null);

  // selection: Map<hospitalId, Set<StepKey>> — 병원별 선택된 수집 항목
  const [selection, setSelection] = useState<Map<string, Set<StepKey>>>(new Map());
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const [collectJobs, setCollectJobs] = useState<CollectJob[]>([]);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collectHistory, setCollectHistory] = useState<CollectHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [collectLastSuccess, setCollectLastSuccess] = useState<CollectLastSuccess | null>(null);
  // SearchAd 기간 지정(선택). 비우면 기존 자동(빠진 날짜) 수집.
  const [searchadStart, setSearchadStart] = useState('');
  const [searchadEnd, setSearchadEnd] = useState('');
  // 수집 이력 아이템 클릭 시 상세 로그(output)를 펼쳐 보여준다. (한 번에 하나만)
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<CollectJob | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);

  const totalSelected = Array.from(selection.values()).reduce((sum, s) => sum + s.size, 0);
  const totalPossible = hospitals.length * COLLECT_STEPS.length;
  const isAllSelected = totalPossible > 0 && totalSelected === totalPossible;
  const isAnySelected = totalSelected > 0;
  // SearchAd 단계가 하나라도 선택됐을 때만 기간 입력을 노출/적용한다.
  const anySearchadSelected = Array.from(selection.values()).some((s) => s.has('searchad'));
  const searchadDateIncomplete =
    anySearchadSelected && Boolean(searchadStart) !== Boolean(searchadEnd);
  const searchadDateInvalid =
    anySearchadSelected && !!searchadStart && !!searchadEnd && searchadStart > searchadEnd;

  function toggleAll(checked: boolean) {
    setSelection(
      checked
        ? new Map(hospitals.map((h) => [h.id, new Set(COLLECT_STEPS.map((s) => s.key))]))
        : new Map(),
    );
  }

  function toggleHospital(hid: string, checked: boolean) {
    setSelection((prev) => {
      const next = new Map(prev);
      if (checked) next.set(hid, new Set(COLLECT_STEPS.map((s) => s.key)));
      else next.delete(hid);
      return next;
    });
  }

  function toggleStep(hid: string, step: StepKey, checked: boolean) {
    setSelection((prev) => {
      const next = new Map(prev);
      const steps = new Set(prev.get(hid) ?? []);
      if (checked) steps.add(step);
      else steps.delete(step);
      if (steps.size === 0) next.delete(hid);
      else next.set(hid, steps);
      return next;
    });
  }

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

  // After extraction succeeds and we have a runId, auto-upload + analyze images
  useEffect(() => {
    if (status !== 'success' || !lastRunId) return;
    if (lastRunId === prevLastRunId.current) return;
    if (imageFiles.length === 0) return;
    prevLastRunId.current = lastRunId;

    const pendingFiles = [...imageFiles];
    const pendingRunId = lastRunId;
    setImageAnalysisStatus('uploading');
    setImageAnalysisError(null);

    void (async () => {
      try {
        const formData = new FormData();
        // Use today as exam date fallback; actual date is in the chart run
        formData.set('examDate', new Date().toISOString().slice(0, 10));
        for (const f of pendingFiles) formData.append('images', f);
        const res = await fetch(`/api/admin/runs/${encodeURIComponent(pendingRunId)}/case-images`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error ?? '이미지 분석 실패');
        setImageAnalysisStatus('done');
        setImageFiles([]);
      } catch (e) {
        setImageAnalysisError(e instanceof Error ? e.message : '이미지 분석 실패');
        setImageAnalysisStatus('error');
      }
    })();
  }, [status, lastRunId, imageFiles]);

  function addImageFiles(incoming: File[]) {
    const valid = incoming.filter((f) => {
      if (!ALLOWED_IMAGE_TYPES.includes(f.type)) return false;
      if (f.size > MAX_IMAGE_BYTES) return false;
      return true;
    });
    setImageFiles((prev) => {
      const combined = [...prev, ...valid];
      return combined.slice(0, MAX_IMAGES);
    });
  }

  function removeImageFile(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
  }

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

  // 이력 아이템을 펼치면 그 잡의 전체 output을 불러온다(목록 응답엔 output이 없음).
  async function toggleHistoryDetail(id: string) {
    if (expandedHistoryId === id) {
      setExpandedHistoryId(null);
      setHistoryDetail(null);
      return;
    }
    setExpandedHistoryId(id);
    setHistoryDetail(null);
    setHistoryDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/collect/status/${id}`, { credentials: 'include' });
      if (res.ok) setHistoryDetail((await res.json()) as CollectJob);
    } catch {
      /* 무시 — 아래에서 "로그 없음" 처리 */
    } finally {
      setHistoryDetailLoading(false);
    }
  }

  useEffect(() => {
    if (section !== 'collect') return;
    void loadHistory();
    // 진행 중인 잡을 패널로 복원 — 새로고침/다른 세션에서도 진행률 바가 보이도록.
    // collectJobs가 비어 있을 때만 시드하고, progress 등 상세는 폴링 effect가 곧 채운다.
    void (async () => {
      try {
        const res = await fetch('/api/admin/collect/jobs', { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { jobs: CollectHistoryItem[] };
        const active = (data.jobs ?? []).filter((j) => j.status === 'pending' || j.status === 'running');
        if (active.length === 0) return;
        setCollectJobs((prev) =>
          prev.length > 0
            ? prev
            : active.map((j) => ({
                id: j.id,
                hospital_id: j.hospital_id,
                status: j.status,
                output: null,
                steps: j.steps,
                upserts: j.upserts,
              })),
        );
      } catch {
        /* 복원 실패는 무시 */
      }
    })();
    fetch('/api/admin/collect/last-success', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setCollectLastSuccess(d as CollectLastSuccess); })
      .catch(() => {});
  }, [section]);

  async function runCollect() {
    setCollectSubmitting(true);
    setCollectJobs([]);
    setCollectError(null);
    try {
      const useSearchadRange = !!searchadStart && !!searchadEnd && !searchadDateInvalid;
      const jobs = Array.from(selection.entries())
        .filter(([, steps]) => steps.size > 0)
        .map(([hospitalId, steps]) => {
          const stepArr = Array.from(steps);
          return {
            hospitalId,
            steps: stepArr,
            ...(useSearchadRange && stepArr.includes('searchad')
              ? { searchadStart, searchadEnd }
              : {}),
          };
        });
      const res = await fetch('/api/admin/collect/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ jobs }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        jobs?: { id: string; hospitalId: string | null }[];
        error?: string;
      };
      if (!res.ok || !data.ok || !data.jobs) {
        setCollectError(data.error ?? '수집 요청 생성에 실패했습니다.');
        return;
      }
      setCollectJobs(
        data.jobs.map((j) => ({
          id: j.id,
          hospital_id: j.hospitalId,
          status: 'pending' as const,
          output: null,
          steps: null,
          upserts: null,
        })),
      );
      void loadHistory();
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : '알 수 없는 오류');
    } finally {
      setCollectSubmitting(false);
    }
  }

  // 진행 중인 잡(단일·다중 모두)을 각각 폴링해 병원별 진행률을 갱신한다.
  // activeJobKey가 바뀔 때(잡이 끝나 active 집합이 변할 때)마다 effect를 재구독해 최신 closure 확보.
  const activeJobKey = collectJobs
    .filter((j) => j.status === 'pending' || j.status === 'running')
    .map((j) => j.id)
    .join(',');
  useEffect(() => {
    if (!activeJobKey) return;
    const ids = activeJobKey.split(',');
    const timer = setInterval(async () => {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/admin/collect/status/${id}`, { credentials: 'include' });
            if (!res.ok) return null;
            return (await res.json()) as CollectJob;
          } catch {
            return null;
          }
        }),
      );
      setCollectJobs((prev) => prev.map((j) => results.find((r) => r && r.id === j.id) ?? j));
      void loadHistory();
    }, 2_000);
    return () => clearInterval(timer);
  }, [activeJobKey]);

  // collectJobs는 이번 세션에서 실행한 잡만 추적하므로, 새로고침하면 사라진다. 다른 곳에서 큐잉됐거나
  // 새로고침된 경우에도 히스토리에 pending/running 잡이 있으면 폴링해 워커 완료를 반영한다.
  const hasActiveCollectJobs = collectHistory.some(
    (h) => h.status === 'pending' || h.status === 'running',
  );
  useEffect(() => {
    if (section !== 'collect' || !hasActiveCollectJobs) return;
    const timer = setInterval(() => void loadHistory(), 3_000);
    return () => clearInterval(timer);
  }, [section, hasActiveCollectJobs]);

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

  // PDF·이미지 드롭존 공용 스타일 — 두 박스를 동일한 모양/크기로
  const dropzoneBaseStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: 8,
    minHeight: 132,
    border: '1.5px dashed #cbd5e1',
    borderRadius: 10,
    padding: '22px 20px',
    cursor: 'pointer',
    background: '#f8fafc',
    userSelect: 'none',
    transition: 'border-color 0.15s, background 0.15s',
  };

  return (
    <div className="adminLayoutMainPane">
      <div className="adminLayoutMainColumnInset">
          {section === 'collect' ? (
            <>
<div className="adminLegacyBlockBleed">
                <div style={{ display: 'grid', gap: 16 }}>
                  {/* 3단계 트리 체크박스 */}
                  {hospitalsLoading ? (
                    <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>병원 목록 불러오는 중…</p>
                  ) : hospitalsError ? (
                    <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>{hospitalsError}</p>
                  ) : (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                      {/* 1단계: 전체 선택 */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 14px',
                          background: '#e2e8f0',
                          borderBottom: '1px solid #cbd5e1',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#0f172a',
                          userSelect: 'none',
                        }}
                      >
                        <IndeterminateCheckbox
                          checked={isAllSelected}
                          indeterminate={!isAllSelected && isAnySelected}
                          onChange={(e) => toggleAll(e.target.checked)}
                        />
                        전체 병원 / 전체 항목
                        <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 2, fontSize: 12 }}>
                          ({selection.size}/{hospitals.length}개 병원)
                        </span>
                      </label>

                      {/* 2단계: 병원 목록 + 3단계: 항목 */}
                      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                        {hospitals.map((h, hi) => {
                          const hSteps = selection.get(h.id);
                          const hChecked = (hSteps?.size ?? 0) === COLLECT_STEPS.length;
                          const hIndeterminate = (hSteps?.size ?? 0) > 0 && !hChecked;
                          const isLast = hi === hospitals.length - 1;
                          return (
                            <div key={h.id} style={{ borderBottom: isLast ? 'none' : '1px solid #e2e8f0' }}>
                              {/* 병원 행 */}
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '9px 14px 9px 28px',
                                  background: '#f8fafc',
                                  borderBottom: '1px solid #f1f5f9',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: '#334155',
                                  userSelect: 'none',
                                }}
                              >
                                <IndeterminateCheckbox
                                  checked={hChecked}
                                  indeterminate={hIndeterminate}
                                  onChange={(e) => toggleHospital(h.id, e.target.checked)}
                                />
                                {h.name_ko}
                              </label>
                              {/* 항목 행들 */}
                              {COLLECT_STEPS.map((step, si) => (
                                <label
                                  key={step.key}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '7px 14px 7px 48px',
                                    borderBottom:
                                      si < COLLECT_STEPS.length - 1 ? '1px solid #f8fafc' : 'none',
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    color: '#475569',
                                    userSelect: 'none',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={hSteps?.has(step.key) ?? false}
                                    onChange={(e) => toggleStep(h.id, step.key, e.target.checked)}
                                  />
                                  <span style={{ flex: 1 }}>{step.label}</span>
                                  {collectLastSuccess?.[h.id]?.[step.key] && (
                                    <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4, whiteSpace: 'nowrap' }}>
                                      {new Date(collectLastSuccess[h.id][step.key] + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                                    </span>
                                  )}
                                </label>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* SearchAd 기간 지정 (searchad 선택 시만) */}
                  {anySearchadSelected && (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', background: '#f8fafc' }}>
                      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#334155' }}>
                        SearchAd 수집 기간 <span style={{ fontWeight: 400, color: '#94a3b8' }}>(선택)</span>
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          type="date"
                          value={searchadStart}
                          max={searchadEnd || undefined}
                          onChange={(e) => setSearchadStart(e.target.value)}
                          style={{ fontSize: 13, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, color: '#0f172a' }}
                        />
                        <span style={{ fontSize: 13, color: '#64748b' }}>~</span>
                        <input
                          type="date"
                          value={searchadEnd}
                          min={searchadStart || undefined}
                          onChange={(e) => setSearchadEnd(e.target.value)}
                          style={{ fontSize: 13, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, color: '#0f172a' }}
                        />
                        {(searchadStart || searchadEnd) && (
                          <button
                            type="button"
                            onClick={() => { setSearchadStart(''); setSearchadEnd(''); }}
                            style={{ fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                          >
                            지우기
                          </button>
                        )}
                      </div>
                      <p style={{ margin: '8px 0 0', fontSize: 12, color: searchadDateInvalid ? '#b91c1c' : '#94a3b8', lineHeight: 1.5 }}>
                        {searchadDateInvalid
                          ? '시작일이 종료일보다 늦습니다.'
                          : searchadDateIncomplete
                            ? '시작일과 종료일을 모두 선택해 주세요.'
                            : '비워두면 빠진 날짜를 자동 수집합니다. 하루만 받으려면 시작·종료일을 같게 선택하세요.'}
                      </p>
                    </div>
                  )}

                  {/* 수집 시작 버튼 */}
                  <div>
                    <button
                      type="button"
                      className="adminLegacyPrimaryBtn"
                      disabled={collectSubmitting || !isAnySelected || hospitalsLoading || searchadDateIncomplete || searchadDateInvalid}
                      onClick={() => void runCollect()}
                    >
                      {collectSubmitting
                        ? '요청 중…'
                        : `수집 시작 (${selection.size}개 병원)`}
                    </button>
                    {!isAnySelected && !hospitalsLoading && (
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: '#94a3b8' }}>
                        병원과 항목을 하나 이상 선택해 주세요.
                      </p>
                    )}
                  </div>

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

              {collectJobs.map((collectJob) => (
                <div key={collectJob.id} style={{ marginTop: 16 }}>
                  {/* 병원명 + 상태 배너 */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      marginBottom: 14,
                      borderRadius: 6,
                      background: collectJob.status === 'done' ? '#f0fdf4' : collectJob.status === 'failed' ? '#fef2f2' : '#eff6ff',
                      border: `1px solid ${collectJob.status === 'done' ? 'rgba(22,163,74,0.2)' : collectJob.status === 'failed' ? 'rgba(185,28,28,0.2)' : 'rgba(29,78,216,0.2)'}`,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                      {hospitals.find((h) => h.id === collectJob.hospital_id)?.name_ko ?? collectJob.hospital_id ?? '병원'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: collectJob.status === 'done' ? '#15803d' : collectJob.status === 'failed' ? '#991b1b' : '#1d4ed8' }}>
                      {collectJob.status === 'done' ? '✓ 수집 완료' : collectJob.status === 'failed' ? '✗ 수집 실패' : collectJob.status === 'pending' ? '대기 중 (곧 시작)' : '⋯ 수집 실행 중'}
                    </span>
                  </div>

                  {/* 데이터 종류별 진행률 바 */}
                  {(() => {
                    const filter = collectJob.steps_filter;
                    const stepKeys = (filter && filter.length > 0
                      ? COLLECT_STEPS.filter((s) => filter.includes(s.key))
                      : COLLECT_STEPS
                    );
                    const doneNames = new Set(
                      (collectJob.steps ?? []).filter((s) => !s.error).map((s) => s.name),
                    );
                    return (
                      <div className="adminLegacyBlockBleed">
                        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#334155' }}>진행률</p>
                        <div style={{ display: 'grid', gap: 12 }}>
                          {stepKeys.map((s) => {
                            const p = collectJob.progress?.[s.key];
                            const stepDone = doneNames.has(s.label);
                            const total = p?.total ?? 0;
                            const done = stepDone ? (total || 1) : (p?.done ?? 0);
                            const pct = stepDone ? 100 : total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                            const running = collectJob.status === 'running' && !stepDone && (p?.done ?? 0) > 0;
                            const statusText = stepDone
                              ? '완료'
                              : running
                                ? `${done.toLocaleString()}/${total.toLocaleString()}${p?.label ? ` · ${p.label}` : ''}`
                                : collectJob.status === 'running'
                                  ? '대기'
                                  : '-';
                            return (
                              <div key={s.key}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <span style={{ fontSize: 13, color: '#334155' }}>{s.label}</span>
                                  <span style={{ fontSize: 12, color: stepDone ? '#15803d' : '#64748b' }}>
                                    {statusText}{!stepDone && pct > 0 ? ` (${pct}%)` : ''}
                                  </span>
                                </div>
                                <div style={{ height: 8, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }}>
                                  <div
                                    style={{
                                      width: `${pct}%`,
                                      height: '100%',
                                      background: stepDone ? '#15803d' : '#3182f6',
                                      transition: 'width 0.4s ease',
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

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
                  {collectJob.steps && collectJob.steps.length > 0 && (() => {
                    const steps = collectJob.steps!;
                    const isBatch = steps.some((s) => s.hospitalId != null);

                    const renderStepRow = (s: CollectStepResult) => (
                      <li key={`${s.hospitalId ?? ''}-${s.index}-${s.name}`} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid rgba(15,23,42,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: s.error ? '#991b1b' : '#475569' }}>
                            <span style={{ color: s.error ? '#b91c1c' : '#15803d', marginRight: 6 }}>{s.error ? '✗' : '✓'}</span>
                            {s.index}. {s.name}
                          </span>
                          <span style={{ color: '#94a3b8', fontSize: 12, flexShrink: 0, marginLeft: 8 }}>{s.durationSec.toFixed(1)}s</span>
                        </div>
                        {s.error && <p style={{ margin: '3px 0 0 18px', fontSize: 12, color: '#b91c1c', lineHeight: 1.4 }}>{s.error}</p>}
                      </li>
                    );

                    if (!isBatch) {
                      return (
                        <div className="adminLegacyBlockBleed">
                          <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#334155' }}>
                            실행 단계{collectJob.status === 'running' ? ' (진행 중)' : ''}
                          </p>
                          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>{steps.map(renderStepRow)}</ol>
                        </div>
                      );
                    }

                    // 병원별로 그룹핑
                    const groups: { hospitalId: string; hospitalName: string | null; steps: CollectStepResult[] }[] = [];
                    const idxMap = new Map<string, number>();
                    for (const s of steps) {
                      const hid = s.hospitalId ?? '__none__';
                      if (!idxMap.has(hid)) {
                        idxMap.set(hid, groups.length);
                        groups.push({ hospitalId: hid, hospitalName: s.hospitalName ?? null, steps: [] });
                      }
                      groups[idxMap.get(hid)!].steps.push(s);
                    }

                    return (
                      <div className="adminLegacyBlockBleed">
                        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#334155' }}>
                          실행 단계{collectJob.status === 'running' ? ' (진행 중)' : ''}
                        </p>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {groups.map((g) => {
                            const anyFail = g.steps.some((s) => s.error);
                            const doneCount = g.steps.filter((s) => !s.error).length;
                            return (
                              <div key={g.hospitalId} style={{ border: `1px solid ${anyFail ? 'rgba(185,28,28,0.3)' : '#e2e8f0'}`, borderRadius: 6, overflow: 'hidden' }}>
                                <div style={{ background: anyFail ? '#fef2f2' : '#f1f5f9', padding: '6px 12px', fontSize: 12, fontWeight: 600, color: anyFail ? '#991b1b' : '#334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span>{g.hospitalName ?? g.hospitalId}</span>
                                  <span style={{ fontWeight: 400, color: anyFail ? '#b91c1c' : '#15803d', fontSize: 11 }}>{doneCount}/{g.steps.length} 완료</span>
                                </div>
                                <ol style={{ margin: 0, padding: '2px 12px', listStyle: 'none', display: 'grid', gap: 0 }}>{g.steps.map(renderStepRow)}</ol>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

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
                </div>
              ))}

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
                          onClick={() => void toggleHistoryDetail(h.id)}
                          style={{ padding: '10px 12px', background: '#f8fafc', border: `1px solid ${failedSteps.length > 0 ? 'rgba(185,28,28,0.25)' : '#e2e8f0'}`, borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasDetails || expandedHistoryId === h.id ? 8 : 0 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 600, color: '#0f172a' }}>{hospitalName}</span>
                              <span style={{ color: '#64748b' }}>
                                {formatKst(h.created_at)}
                                {h.finished_at && ` · ${durationSec(h.started_at, h.finished_at)}`}
                              </span>
                            </div>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', marginLeft: 8 }}>
                              <span style={{ fontWeight: 700, color: STATUS_COLOR[h.status] }}>{STATUS_LABEL[h.status]}</span>
                              <span style={{ color: '#94a3b8', fontSize: 11 }}>{expandedHistoryId === h.id ? '▴ 로그' : '▾ 로그'}</span>
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
                          {expandedHistoryId === h.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8, cursor: 'default' }}
                            >
                              {historyDetailLoading ? (
                                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>로그 불러오는 중…</p>
                              ) : historyDetail?.output ? (
                                <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: '#334155', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, overflow: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                  {historyDetail.output}
                                </pre>
                              ) : (
                                <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>저장된 로그가 없습니다.</p>
                              )}
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

                    {/* PDF 드롭존 */}
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
                        ...dropzoneBaseStyle,
                        border: `1.5px dashed ${isDragOver ? '#3b82f6' : selectedFile ? '#22c55e' : '#cbd5e1'}`,
                        background: isDragOver ? '#eff6ff' : selectedFile ? '#f0fdf4' : '#f8fafc',
                      }}
                    >
                      <Upload size={26} style={{ color: isDragOver ? '#3b82f6' : selectedFile ? '#16a34a' : '#94a3b8' }} />
                      {selectedFile ? (
                        <div>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#15803d' }}>{selectedFile.name}</p>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB · 클릭해서 다시 선택</p>
                        </div>
                      ) : (
                        <div>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#334155' }}>PDF 드래그 또는 클릭해서 선택</p>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>최대 30MB · 텍스트 기반 PDF</p>
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

                    {/* 이미지 업로드 */}
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                        관련 이미지 (선택) — 추출 완료 후 AI가 자동 분류·분석합니다
                      </div>
                      <div
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const files = Array.from(e.dataTransfer.files);
                          addImageFiles(files);
                        }}
                        onClick={() => imageInputRef.current?.click()}
                        style={dropzoneBaseStyle}
                      >
                        <Upload size={26} style={{ color: '#94a3b8' }} />
                        <div>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#334155' }}>이미지 드래그 또는 클릭해서 선택</p>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>JPEG / PNG / WebP · 최대 {MAX_IMAGES}장 · 장당 8MB · 자동 압축 후 분석</p>
                        </div>
                      </div>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          addImageFiles(files);
                          e.target.value = '';
                        }}
                      />
                      {imageFiles.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {imageFiles.map((f, i) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 8px',
                                background: '#eff6ff',
                                border: '1px solid #bfdbfe',
                                borderRadius: 6,
                                fontSize: 11,
                                color: '#1d4ed8',
                              }}
                            >
                              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {f.name}
                              </span>
                              <span style={{ color: '#94a3b8', flexShrink: 0 }}>
                                {(f.size / 1024 / 1024).toFixed(1)}MB
                              </span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeImageFile(i); }}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, fontSize: 13, lineHeight: 1 }}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button type="submit" className="adminLegacyPrimaryBtn" disabled={!canSubmit} style={{ width: '100%' }}>
                      {isExtractRunning ? '처리 중…' : '실행'}
                    </button>
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
              {imageAnalysisStatus === 'uploading' && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: '#1d4ed8' }}>이미지 분석 중… (OpenAI Vision)</p>
                </div>
              )}
              {imageAnalysisStatus === 'done' && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: '#15803d', fontWeight: 600 }}>✓ 이미지 분석 완료. 추출 결과 하단에서 확인하세요.</p>
                </div>
              )}
              {imageAnalysisStatus === 'error' && imageAnalysisError && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>이미지 분석 오류: {imageAnalysisError}</p>
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
