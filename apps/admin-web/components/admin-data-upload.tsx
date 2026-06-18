'use client';

import type { ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';
import { parseChartAdminHospitalsResponse } from '@/lib/chart-extraction/chart-admin-hospitals';
import type { CSSProperties } from 'react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useChartExtraction } from '@/components/chart-extraction-provider';
import AdminDataConsole from '@/components/admin-data-console';
import AdminCollectScheduler from '@/components/admin-collect-scheduler';
import { Upload } from 'lucide-react';

const COLLECT_STEPS = [
  { key: 'blog_metrics', label: '블로그 일별 지표' },
  { key: 'smartplace', label: '스마트플레이스 유입' },
  { key: 'keyword_rank', label: '블로그/플레이스 키워드 순위' },
  { key: 'searchad', label: 'SearchAd 일별 성과' },
  { key: 'place_reviews', label: '스마트플레이스 리뷰 추이' },
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
  updated_at?: string | null;
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
  updated_at?: string | null;
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
  pending: 'var(--text-muted)',
  running: 'var(--accent)',
  done: 'var(--success)',
  failed: 'var(--danger)',
};

// 워커가 이 시간 이상 updated_at을 갱신하지 않으면 '중단 추정'으로 본다.
// 워커는 30초마다 하트비트로 updated_at을 갱신하므로, 3분(=6하트비트 누락)이면 죽은 것으로 판단.
const STALE_JOB_MS = 3 * 60_000;
function isJobStale(status: string, updatedAt?: string | null): boolean {
  if (status !== 'running') return false; // 워커가 집어 든(running) 잡만 — pending은 큐 대기일 수 있음
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() > STALE_JOB_MS;
}

type CoverageData = {
  applicable: boolean;
  start?: string;
  end?: string;
  totalDays?: number;
  collectedDays?: number;
  firstMissing?: string | null;
  lastCollected?: string | null;
  days?: { date: string; collected: boolean }[];
};

// SearchAd 기간 지정 잡의 '날짜별 수집 여부'(✓/✗)를 보여준다 — 중간에 종료된 잡 점검용.
function SearchadCoverage({ jobId }: { jobId: string }) {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/collect/coverage/${jobId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d as CoverageData); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>날짜별 수집 확인 중…</p>;
  if (!data || !data.applicable || !data.days) {
    return <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>기간 지정 수집이 아니라 날짜별 표시가 불가합니다.</p>;
  }
  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
        날짜별 수집 ({data.collectedDays}/{data.totalDays}일)
        {data.firstMissing && (
          <span style={{ fontWeight: 400, color: 'var(--warning)', marginLeft: 6 }}>· {data.firstMissing}부터 누락</span>
        )}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {data.days.map((d) => (
          <span
            key={d.date}
            title={d.date}
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              border: `1px solid ${d.collected ? 'rgba(22,163,74,0.3)' : 'rgba(185,28,28,0.3)'}`,
              background: d.collected ? 'var(--success-subtle)' : 'var(--danger-subtle)',
              color: d.collected ? 'var(--success)' : 'var(--danger)',
              whiteSpace: 'nowrap',
            }}
          >
            {d.collected ? '✓' : '✗'} {d.date.slice(5)}
          </span>
        ))}
      </div>
      {data.lastCollected && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
          마지막 수집일 {data.lastCollected}. 다시 수집할 때 시작일을 그 다음날로 잡으면 이어집니다.
        </p>
      )}
    </div>
  );
}

export default function AdminDataUpload() {
  const searchParams = useSearchParams();
  const [section, setSection] = useState<UploadSection>('pdf');
  const [schedulerOpen, setSchedulerOpen] = useState(false);
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
  // SearchAd 캠페인 선택(병원별). 비어 있으면 전체 캠페인 수집.
  const [campaignLists, setCampaignLists] = useState<Record<string, { id: string; name: string; type: string }[]>>({});
  const [campaignLoading, setCampaignLoading] = useState<Record<string, boolean>>({});
  const [campaignError, setCampaignError] = useState<Record<string, string>>({});
  const [campaignSel, setCampaignSel] = useState<Map<string, Set<string>>>(new Map());
  const [campaignOpen, setCampaignOpen] = useState<Set<string>>(new Set());
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

  // '중단 추정' 잡을 수동으로 종료(failed)한다 — 워커가 죽어 reaper가 못 도는 경우 정리용.
  async function cancelJob(id: string) {
    try {
      const res = await fetch('/api/admin/collect/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ jobId: id }),
      });
      if (res.ok) {
        setCollectJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'failed' as const } : j)));
        void loadHistory();
      }
    } catch {
      /* 무시 */
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
                updated_at: j.updated_at,
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

  // 병원의 SearchAd 캠페인 목록을 네이버에서 불러온다(선택 수집용).
  async function loadCampaigns(hid: string) {
    setCampaignLoading((m) => ({ ...m, [hid]: true }));
    setCampaignError((m) => ({ ...m, [hid]: '' }));
    try {
      const res = await fetch('/api/admin/collect/searchad-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hospitalId: hid }),
      });
      const data = (await res.json().catch(() => ({}))) as { campaigns?: { id: string; name: string; type: string }[]; error?: string };
      if (!res.ok) {
        setCampaignError((m) => ({ ...m, [hid]: data.error ?? '캠페인을 불러오지 못했습니다.' }));
        return;
      }
      setCampaignLists((m) => ({ ...m, [hid]: data.campaigns ?? [] }));
    } catch {
      setCampaignError((m) => ({ ...m, [hid]: '캠페인을 불러오지 못했습니다.' }));
    } finally {
      setCampaignLoading((m) => ({ ...m, [hid]: false }));
    }
  }
  function toggleCampaignOpen(hid: string) {
    setCampaignOpen((prev) => {
      const next = new Set(prev);
      if (next.has(hid)) {
        next.delete(hid);
      } else {
        next.add(hid);
        if (!campaignLists[hid] && !campaignLoading[hid]) void loadCampaigns(hid);
      }
      return next;
    });
  }
  function toggleCampaign(hid: string, cid: string, checked: boolean) {
    setCampaignSel((prev) => {
      const next = new Map(prev);
      const s = new Set(next.get(hid) ?? []);
      if (checked) s.add(cid);
      else s.delete(cid);
      next.set(hid, s);
      return next;
    });
  }

  async function runCollect() {
    setCollectSubmitting(true);
    // 진행 중인 잡 패널을 비우지 않는다 — 이미 돌고 있는 잡의 진행률도 계속 보이게.
    setCollectError(null);
    try {
      const useSearchadRange = !!searchadStart && !!searchadEnd && !searchadDateInvalid;
      const jobs = Array.from(selection.entries())
        .filter(([, steps]) => steps.size > 0)
        .map(([hospitalId, steps]) => {
          const stepArr = Array.from(steps);
          const camp = campaignSel.get(hospitalId);
          return {
            hospitalId,
            steps: stepArr,
            ...(useSearchadRange && stepArr.includes('searchad')
              ? { searchadStart, searchadEnd }
              : {}),
            ...(stepArr.includes('searchad') && camp && camp.size > 0
              ? { searchadCampaignIds: Array.from(camp) }
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
      setCollectJobs((prev) => {
        const newOnes = data.jobs!.map((j) => ({
          id: j.id,
          hospital_id: j.hospitalId,
          status: 'pending' as const,
          output: null,
          steps: null,
          upserts: null,
        }));
        const newIds = new Set(newOnes.map((j) => j.id));
        // 기존에 진행 중(대기/수집 중)인 잡은 유지하고, 새 잡을 뒤에 추가(중복 id 제거).
        const keptActive = prev.filter(
          (j) => (j.status === 'pending' || j.status === 'running') && !newIds.has(j.id),
        );
        return [...keptActive, ...newOnes];
      });
      void loadHistory();
      // 수집 요청 성공 시 화면을 한 번 새로고침(서버에 잡 저장 완료 → 새로고침 후 히스토리 폴링이 진행 중 잡을 다시 표시).
      if (typeof window !== 'undefined') {
        window.location.reload();
        return;
      }
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
    color: 'var(--text)',
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
    border: '1.5px dashed var(--border-strong)',
    borderRadius: 10,
    padding: '22px 20px',
    cursor: 'pointer',
    background: 'var(--bg-subtle)',
    userSelect: 'none',
    transition: 'border-color 0.15s, background 0.15s',
  };

  return section === 'collect' ? (
    <div className="adminLayout2WithMain" style={{ gridTemplateColumns: '360px minmax(0, 1fr)' }}>
      <AdminCollectScheduler hospitals={hospitals} open={schedulerOpen} onClose={() => setSchedulerOpen(false)} />
      <aside className="adminLayoutSecondaryRail" style={{ width: 360, maxWidth: 360, overflowY: 'auto' }}>
        <div style={{ padding: '14px 14px 24px' }}>
                <div style={{ display: 'grid', gap: 16 }}>
                  {/* 3단계 트리 체크박스 */}
                  {hospitalsLoading ? (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>병원 목록 불러오는 중…</p>
                  ) : hospitalsError ? (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{hospitalsError}</p>
                  ) : (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {/* 1단계: 전체 선택 */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 14px',
                          background: 'var(--border)',
                          borderBottom: '1px solid var(--border-strong)',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: 700,
                          color: 'var(--text)',
                          userSelect: 'none',
                        }}
                      >
                        <IndeterminateCheckbox
                          checked={isAllSelected}
                          indeterminate={!isAllSelected && isAnySelected}
                          onChange={(e) => toggleAll(e.target.checked)}
                        />
                        전체 병원 / 전체 항목
                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 2, fontSize: 12 }}>
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
                            <div key={h.id} style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                              {/* 병원 행 */}
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '9px 14px 9px 28px',
                                  background: 'var(--bg-subtle)',
                                  borderBottom: '1px solid var(--bg-subtle)',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: 'var(--text-secondary)',
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
                                      si < COLLECT_STEPS.length - 1 ? '1px solid var(--bg-subtle)' : 'none',
                                    cursor: 'pointer',
                                    fontSize: 12,
                                    color: 'var(--text-secondary)',
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
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4, whiteSpace: 'nowrap' }}>
                                      {new Date(collectLastSuccess[h.id][step.key] + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                                    </span>
                                  )}
                                </label>
                              ))}
                              {selection.get(h.id)?.has('searchad') && (
                                <div style={{ padding: '6px 14px 10px 48px', borderTop: '1px solid var(--bg-subtle)', background: 'var(--bg-raised)' }}>
                                  <button
                                    type="button"
                                    onClick={() => toggleCampaignOpen(h.id)}
                                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                  >
                                    {campaignOpen.has(h.id) ? '▴' : '▾'} SearchAd 캠페인{' '}
                                    {(campaignSel.get(h.id)?.size ?? 0) > 0 ? `(${campaignSel.get(h.id)!.size}개 선택)` : '(전체)'}
                                  </button>
                                  {campaignOpen.has(h.id) && (
                                    <div style={{ marginTop: 6 }}>
                                      {campaignLoading[h.id] ? (
                                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>캠페인 불러오는 중…</span>
                                      ) : campaignError[h.id] ? (
                                        <span style={{ fontSize: 12, color: 'var(--danger)' }}>{campaignError[h.id]}</span>
                                      ) : (campaignLists[h.id] ?? []).length === 0 ? (
                                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>캠페인이 없습니다.</span>
                                      ) : (
                                        <>
                                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>아무것도 선택하지 않으면 전체 캠페인을 수집합니다.</div>
                                          {campaignLists[h.id].map((c) => (
                                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0', cursor: 'pointer' }}>
                                              <input
                                                type="checkbox"
                                                checked={campaignSel.get(h.id)?.has(c.id) ?? false}
                                                onChange={(e) => toggleCampaign(h.id, c.id, e.target.checked)}
                                              />
                                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || c.id}</span>
                                              {c.type && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{c.type}</span>}
                                            </label>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* SearchAd 기간 지정 (searchad 선택 시만) */}
                  {anySearchadSelected && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', background: 'var(--bg-subtle)' }}>
                      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        SearchAd 수집 기간 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(선택)</span>
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          type="date"
                          value={searchadStart}
                          max={searchadEnd || undefined}
                          onChange={(e) => setSearchadStart(e.target.value)}
                          style={{ fontSize: 13, padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)' }}
                        />
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>~</span>
                        <input
                          type="date"
                          value={searchadEnd}
                          min={searchadStart || undefined}
                          onChange={(e) => setSearchadEnd(e.target.value)}
                          style={{ fontSize: 13, padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)' }}
                        />
                        {(searchadStart || searchadEnd) && (
                          <button
                            type="button"
                            onClick={() => { setSearchadStart(''); setSearchadEnd(''); }}
                            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                          >
                            지우기
                          </button>
                        )}
                      </div>
                      <p style={{ margin: '8px 0 0', fontSize: 12, color: searchadDateInvalid ? 'var(--danger)' : 'var(--text-muted)', lineHeight: 1.5 }}>
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
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                        병원과 항목을 하나 이상 선택해 주세요.
                      </p>
                    )}
                  </div>

                  {/* 자동 수집 스케줄 — 모달로 설정 */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => setSchedulerOpen(true)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '10px', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius, 8px)', background: '#fff', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                    >
                      ⏱ 자동 수집 스케줄
                    </button>
                  </div>

                </div>
              </div>
            </aside>
            <div className="adminLayoutMainPane">
              <div className="adminLayoutMainColumnInset">

              {collectError && (
                <div
                  className="adminLegacyBlockBleed"
                  style={{ color: 'var(--danger)', borderBottom: '1px solid rgba(185,28,28,0.25)' }}
                >
                  <p style={{ margin: 0, fontSize: 14 }}>{collectError}</p>
                </div>
              )}

              {collectJobs.map((collectJob) => {
                const stale = isJobStale(collectJob.status, collectJob.updated_at);
                return (
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
                      background: stale ? 'var(--warning-subtle)' : collectJob.status === 'done' ? 'var(--success-subtle)' : collectJob.status === 'failed' ? 'var(--danger-subtle)' : 'var(--accent-subtle)',
                      border: `1px solid ${stale ? 'rgba(217,119,6,0.35)' : collectJob.status === 'done' ? 'rgba(22,163,74,0.2)' : collectJob.status === 'failed' ? 'rgba(185,28,28,0.2)' : 'rgba(29,78,216,0.2)'}`,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      {hospitals.find((h) => h.id === collectJob.hospital_id)?.name_ko ?? collectJob.hospital_id ?? '병원'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: stale ? 'var(--warning)' : collectJob.status === 'done' ? 'var(--success)' : collectJob.status === 'failed' ? 'var(--danger)' : 'var(--accent)' }}>
                        {stale ? '⚠️ 워커 응답 없음 (중단 추정)' : collectJob.status === 'done' ? '✓ 수집 완료' : collectJob.status === 'failed' ? '✗ 수집 실패' : collectJob.status === 'pending' ? '대기 중 (곧 시작)' : '⋯ 수집 실행 중'}
                      </span>
                      {stale && (
                        <button
                          type="button"
                          onClick={() => void cancelJob(collectJob.id)}
                          style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: 'var(--warning)', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
                        >
                          종료
                        </button>
                      )}
                    </span>
                  </div>
                  {stale && (
                    <p style={{ margin: '-6px 0 14px', fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>
                      워커가 3분 이상 응답이 없습니다. 워커 컴퓨터가 꺼졌거나 멈췄을 수 있어요. 이미 수집된 날짜는 저장돼 있으니, 워커를 다시 켠 뒤 수집을 다시 시작하면 이어집니다.
                    </p>
                  )}
                  {(stale || collectJob.status === 'failed') && (
                    <div className="adminLegacyBlockBleed" style={{ marginBottom: 14 }}>
                      <SearchadCoverage jobId={collectJob.id} />
                    </div>
                  )}

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
                        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>진행률</p>
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
                                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.label}</span>
                                  <span style={{ fontSize: 12, color: stepDone ? 'var(--success)' : 'var(--text-muted)' }}>
                                    {statusText}{!stepDone && pct > 0 ? ` (${pct}%)` : ''}
                                  </span>
                                </div>
                                <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                                  <div
                                    style={{
                                      width: `${pct}%`,
                                      height: '100%',
                                      background: stepDone ? 'var(--success)' : 'var(--accent)',
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
                      <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        수집 결과{collectJob.status === 'running' ? ' (진행 중)' : ''}
                      </p>
                      <div style={{ display: 'grid', gap: 8, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                        {collectJob.upserts.map((u) => (
                          <div key={u.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, color: 'var(--text)' }}>
                            <span>{u.label}</span>
                            <span style={{ fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-subtle)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
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
                          <span style={{ color: s.error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                            <span style={{ color: s.error ? 'var(--danger)' : 'var(--success)', marginRight: 6 }}>{s.error ? '✗' : '✓'}</span>
                            {s.index}. {s.name}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0, marginLeft: 8 }}>{s.durationSec.toFixed(1)}s</span>
                        </div>
                        {s.error && <p style={{ margin: '3px 0 0 18px', fontSize: 12, color: 'var(--danger)', lineHeight: 1.4 }}>{s.error}</p>}
                      </li>
                    );

                    if (!isBatch) {
                      return (
                        <div className="adminLegacyBlockBleed">
                          <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
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
                        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                          실행 단계{collectJob.status === 'running' ? ' (진행 중)' : ''}
                        </p>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {groups.map((g) => {
                            const anyFail = g.steps.some((s) => s.error);
                            const doneCount = g.steps.filter((s) => !s.error).length;
                            return (
                              <div key={g.hospitalId} style={{ border: `1px solid ${anyFail ? 'rgba(185,28,28,0.3)' : 'var(--border)'}`, borderRadius: 6, overflow: 'hidden' }}>
                                <div style={{ background: anyFail ? 'var(--danger-subtle)' : 'var(--bg-subtle)', padding: '6px 12px', fontSize: 12, fontWeight: 600, color: anyFail ? 'var(--danger)' : 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span>{g.hospitalName ?? g.hospitalId}</span>
                                  <span style={{ fontWeight: 400, color: anyFail ? 'var(--danger)' : 'var(--success)', fontSize: 11 }}>{doneCount}/{g.steps.length} 완료</span>
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
                      <pre style={{ margin: '8px 0 16px', fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: 14, overflow: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {collectJob.output}
                      </pre>
                    </details>
                  )}
                </div>
                );
              })}

              {/* 수집 이력 */}
              <div className="adminLegacyBlockBleed" style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>최근 수집 이력</p>
                  <button
                    type="button"
                    onClick={() => void loadHistory()}
                    disabled={historyLoading}
                    style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    {historyLoading ? '불러오는 중…' : '새로고침'}
                  </button>
                </div>
                {collectHistory.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>수집 이력이 없습니다.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {collectHistory.map((h) => {
                      const hospitalName = hospitals.find((x) => x.id === h.hospital_id)?.name_ko ?? h.hospital_id ?? '전체 병원';
                      const upserts = h.upserts ?? [];
                      const failedSteps = (h.steps ?? []).filter((s) => s.error);
                      const hasDetails = upserts.length > 0 || failedSteps.length > 0;
                      const hStale = isJobStale(h.status, h.updated_at);
                      return (
                        <div
                          key={h.id}
                          onClick={() => void toggleHistoryDetail(h.id)}
                          style={{ padding: '10px 12px', background: 'var(--bg-subtle)', border: `1px solid ${failedSteps.length > 0 ? 'rgba(185,28,28,0.25)' : 'var(--border)'}`, borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasDetails || expandedHistoryId === h.id ? 8 : 0 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{hospitalName}</span>
                              <span style={{ color: 'var(--text-muted)' }}>
                                {formatKst(h.created_at)}
                                {h.finished_at && ` · ${durationSec(h.started_at, h.finished_at)}`}
                              </span>
                            </div>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', marginLeft: 8 }}>
                              <span style={{ fontWeight: 700, color: hStale ? 'var(--warning)' : STATUS_COLOR[h.status] }}>{hStale ? '⚠️ 중단 추정' : STATUS_LABEL[h.status]}</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{expandedHistoryId === h.id ? '▴ 로그' : '▾ 로그'}</span>
                            </span>
                          </div>
                          {failedSteps.length > 0 && (
                            <div style={{ display: 'grid', gap: 4, borderTop: '1px solid rgba(185,28,28,0.2)', paddingTop: 7, marginBottom: upserts.length > 0 ? 8 : 0 }}>
                              {failedSteps.map((s) => (
                                <div key={`${s.index}-${s.name}`} style={{ color: 'var(--danger)' }}>
                                  <span style={{ fontWeight: 600 }}>✗ {s.index}. {s.name}</span>
                                  {s.error && <span style={{ color: 'var(--danger)', marginLeft: 6 }}>— {s.error}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          {upserts.length > 0 && (
                            <div style={{ display: 'grid', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 7 }}>
                              {upserts.map((u) => (
                                <div key={u.label} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                                  <span>{u.label}</span>
                                  <span style={{ fontWeight: 600, color: u.skipped ? 'var(--text-muted)' : 'var(--accent)' }}>
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
                              style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, cursor: 'default' }}
                            >
                              <SearchadCoverage jobId={h.id} />
                              <div style={{ marginTop: 10 }} />
                              {historyDetailLoading ? (
                                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>로그 불러오는 중…</p>
                              ) : historyDetail?.output ? (
                                <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)', background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: 12, overflow: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                  {historyDetail.output}
                                </pre>
                              ) : (
                                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>저장된 로그가 없습니다.</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>
        ) : section === 'pdf' ? (
          <div className="adminLayoutMainPane">
            <div className="adminLayoutMainColumnInset">
              <div className="adminLegacyBlockBleed">
                <form onSubmit={(e) => void onSubmit(e)}>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {/* 병원 + 차트 종류 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <label htmlFor="hospitalId" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                          병원
                        </label>
                        {hospitalsLoading ? (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
                        ) : hospitalsError ? (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{hospitalsError}</p>
                        ) : hospitals.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                            등록된 병원이 없습니다.{' '}
                            <Link href="/admin/users/hospitals" style={{ fontWeight: 700, color: 'var(--text)' }}>병원 관리</Link>에서 추가해 주세요.
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
                        <label htmlFor="chartType" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
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
                        border: `1.5px dashed ${isDragOver ? 'var(--accent)' : selectedFile ? 'var(--success)' : 'var(--border-strong)'}`,
                        background: isDragOver ? 'var(--accent-subtle)' : selectedFile ? 'var(--success-subtle)' : 'var(--bg-subtle)',
                      }}
                    >
                      <Upload size={26} style={{ color: isDragOver ? 'var(--accent)' : selectedFile ? 'var(--success)' : 'var(--text-muted)' }} />
                      {selectedFile ? (
                        <div>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--success)' }}>{selectedFile.name}</p>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB · 클릭해서 다시 선택</p>
                        </div>
                      ) : (
                        <div>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>PDF 드래그 또는 클릭해서 선택</p>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>최대 30MB · 텍스트 기반 PDF</p>
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
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
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
                        <Upload size={26} style={{ color: 'var(--text-muted)' }} />
                        <div>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>이미지 드래그 또는 클릭해서 선택</p>
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>JPEG / PNG / WebP · 최대 {MAX_IMAGES}장 · 장당 8MB · 자동 압축 후 분석</p>
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
                                background: 'var(--accent-subtle)',
                                border: '1px solid var(--accent-subtle)',
                                borderRadius: 6,
                                fontSize: 11,
                                color: 'var(--accent)',
                              }}
                            >
                              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {f.name}
                              </span>
                              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                                {(f.size / 1024 / 1024).toFixed(1)}MB
                              </span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeImageFile(i); }}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, fontSize: 13, lineHeight: 1 }}
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
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--accent)' }}>추출 중입니다…</p>
                </div>
              )}
              {!isExtractRunning && extractSuccess && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>✓ 추출 성공했습니다.</p>
                </div>
              )}
              {!isExtractRunning && error && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>
                </div>
              )}
              {imageAnalysisStatus === 'uploading' && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--accent)' }}>이미지 분석 중… (OpenAI Vision)</p>
                </div>
              )}
              {imageAnalysisStatus === 'done' && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>✓ 이미지 분석 완료. 추출 결과 하단에서 확인하세요.</p>
                </div>
              )}
              {imageAnalysisStatus === 'error' && imageAnalysisError && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>이미지 분석 오류: {imageAnalysisError}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="adminLayoutMainPane">
            <div className="adminLayoutMainColumnInset">
              <header style={{ marginBottom: 20 }}>
                <h1
                  style={{
                    fontSize: 22,
                    margin: '0 0 8px',
                    fontWeight: 700,
                    color: 'var(--text)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  경영통계 업로드
                </h1>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.55 }}>
                  병원별 실적·엑셀 업로드 및 차트 종류별 안내는 아래 콘솔에서 처리합니다. (기존 <strong>통계</strong>{' '}
                  메뉴에 있던 화면과 동일합니다.)
                </p>
              </header>
              <div className="adminMainSingleGutter" style={{ paddingTop: 0, maxWidth: 1280 }}>
                <AdminDataConsole mode="performance" />
              </div>
            </div>
          </div>
        );
}
