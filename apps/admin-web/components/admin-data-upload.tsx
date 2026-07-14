'use client';

import type { ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';
import { parseChartAdminHospitalsResponse } from '@/lib/chart-extraction/chart-admin-hospitals';
import { compressPdfIfNeeded, PdfCompressError } from '@/lib/pdf-compress';
import type { CSSProperties } from 'react';
import { Fragment, FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useChartExtraction } from '@/components/chart-extraction-provider';
import AdminCollectScheduler from '@/components/admin-collect-scheduler';
import CollectHistoryPanel from '@/components/collect-history-panel';
import AdminStatsUpload from '@/components/admin-stats-upload';
import {
  Upload,
  FileText,
  MapPin,
  Search,
  TrendingUp,
  Star,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  ShoppingCart,
  X,
  type LucideIcon,
} from 'lucide-react';

const COLLECT_STEPS = [
  { key: 'blog_metrics', label: '블로그 일별 지표', short: '블로그 지표' },
  { key: 'smartplace', label: '스마트플레이스 유입', short: '플레이스 유입' },
  { key: 'keyword_rank', label: '블로그/플레이스 키워드 순위', short: '키워드 순위' },
  { key: 'searchad', label: 'SearchAd 일별 성과', short: 'SearchAd' },
  { key: 'place_reviews', label: '스마트플레이스 리뷰 추이', short: '리뷰 추이' },
] as const;

type StepKey = (typeof COLLECT_STEPS)[number]['key'];

// 수집 항목별 아이콘 — 트리·진행률에서 종류를 한눈에 구분
const STEP_ICON: Record<StepKey, LucideIcon> = {
  blog_metrics: FileText,
  smartplace: MapPin,
  keyword_rank: Search,
  searchad: TrendingUp,
  place_reviews: Star,
};

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 50;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type DataTab = 'stats' | 'collect' | 'schedule' | 'history';

const DATA_TABS: { key: DataTab; label: string }[] = [
  { key: 'stats', label: '경영통계 수집' },
  { key: 'collect', label: '데이터 자동 수집' },
  { key: 'schedule', label: '자동 수집 스케줄' },
  { key: 'history', label: '수집 내역' },
];

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

type JobStatus = 'pending' | 'running' | 'done' | 'failed';

type StatusVisual = { icon: LucideIcon; label: string; color: string; bg: string; border: string; spin?: boolean };

function statusVisual(status: JobStatus, stale: boolean): StatusVisual {
  if (stale)
    return { icon: AlertTriangle, label: '중단 추정', color: 'var(--warning)', bg: 'var(--warning-subtle)', border: 'rgba(217,119,6,0.35)' };
  switch (status) {
    case 'done':
      return { icon: CheckCircle2, label: '수집 완료', color: 'var(--success)', bg: 'var(--success-subtle)', border: 'rgba(22,163,74,0.25)' };
    case 'failed':
      return { icon: XCircle, label: '수집 실패', color: 'var(--danger)', bg: 'var(--danger-subtle)', border: 'rgba(185,28,28,0.25)' };
    case 'running':
      return { icon: Loader2, label: '수집 중', color: 'var(--accent)', bg: 'var(--accent-subtle)', border: 'rgba(29,78,216,0.22)', spin: true };
    default:
      return { icon: Clock, label: '대기 중', color: 'var(--text-muted)', bg: 'var(--bg-subtle)', border: 'var(--border)' };
  }
}

// 상태 칩(pill) — 이모지 대신 lucide 아이콘 + 토큰 색으로 통일
function StatusBadge({ status, stale, size = 'md' }: { status: JobStatus; stale: boolean; size?: 'sm' | 'md' }) {
  const v = statusVisual(status, stale);
  const Icon = v.icon;
  const sm = size === 'sm';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: sm ? '2px 8px' : '4px 11px',
        borderRadius: 999,
        background: v.bg,
        border: `1px solid ${v.border}`,
        color: v.color,
        fontSize: sm ? 11 : 12.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}
    >
      <Icon size={sm ? 12 : 14} className={v.spin ? 'adminSpin' : undefined} />
      {v.label}
    </span>
  );
}

// 마지막 수집일을 컴팩트하게: 오늘/어제/N일 전, 7일 이상이면 stale(갱신 필요)
function relDay(dateStr: string): { text: string; stale: boolean } {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff <= 0) return { text: '오늘', stale: false };
  if (diff === 1) return { text: '어제', stale: false };
  if (diff < 7) return { text: `${diff}일 전`, stale: false };
  return { text: `${d.getMonth() + 1}/${d.getDate()}`, stale: true };
}

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

  if (loading) return <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>날짜별 수집 확인 중…</p>;
  if (!data || !data.applicable || !data.days) {
    return <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>기간 지정 수집이 아니라 날짜별 표시가 불가합니다.</p>;
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
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          마지막 수집일 {data.lastCollected}. 다시 수집할 때 시작일을 그 다음날로 잡으면 이어집니다.
        </p>
      )}
    </div>
  );
}

export default function AdminDataUpload({ variant = 'data' }: { variant?: 'data' | 'extract' } = {}) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<DataTab>('stats');
  const { startExtract, status, lastRunId, error: extractError } = useChartExtraction();
  const [localError, setLocalError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
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

  // 선택 모델: 병원 다중 선택 + 수집 데이터 종류(공통 적용). 병원이 많아도 확장 가능.
  // 설정 패널: 드롭다운으로 고른 병원 + 그 병원에 담을 항목(체크)
  const [configHospitalId, setConfigHospitalId] = useState('');
  const [configSteps, setConfigSteps] = useState<Set<StepKey>>(new Set());
  // 장바구니: 여러 병원의 수집 항목을 누적했다가 한꺼번에 실행. 병원 → 항목 집합.
  const [cart, setCart] = useState<Map<string, Set<StepKey>>>(new Map());
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const [collectJobs, setCollectJobs] = useState<CollectJob[]>([]);
  const [collectError, setCollectError] = useState<string | null>(null);
  // 진행 중 잡 감지용으로만 사용(목록 표시는 '수집 내역' 탭으로 이동).
  const [collectHistory, setCollectHistory] = useState<CollectHistoryItem[]>([]);
  const [collectLastSuccess, setCollectLastSuccess] = useState<CollectLastSuccess | null>(null);
  // SearchAd 기간 지정(선택). 비우면 기존 자동(빠진 날짜) 수집.
  const [searchadStart, setSearchadStart] = useState('');
  const [searchadEnd, setSearchadEnd] = useState('');
  // SearchAd 캠페인 선택(병원별). 비어 있으면 전체 캠페인 수집.
  const [campaignLists, setCampaignLists] = useState<Record<string, { id: string; name: string; type: string }[]>>({});
  const [campaignLoading, setCampaignLoading] = useState<Record<string, boolean>>({});
  const [campaignError, setCampaignError] = useState<Record<string, string>>({});
  const [campaignSel, setCampaignSel] = useState<Map<string, Set<string>>>(new Map());

  // 15일 넘게 수집되지 않으면 알림.
  const STALE_DAYS = 15;

  // 병원×항목의 마지막 수집일 → 절대일자 + 상대표기 + 경과일수
  function lastSuccessOf(hid: string, step: StepKey): { date: string; text: string; daysAgo: number } | null {
    const date = collectLastSuccess?.[hid]?.[step];
    if (!date) return null;
    const d = new Date(date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((today.getTime() - d.getTime()) / 86_400_000);
    return { date, text: relDay(date).text, daysAgo };
  }

  // 15일 초과 미수집 (병원×항목) 목록 — 알림용. 오래된 순.
  const staleAlerts = hospitals
    .flatMap((h) =>
      COLLECT_STEPS.flatMap((s) => {
        const last = lastSuccessOf(h.id, s.key);
        if (!last || last.daysAgo <= STALE_DAYS) return [];
        return [{ hospitalId: h.id, hospitalName: h.name_ko, step: s.key, stepLabel: s.short, daysAgo: last.daysAgo }];
      }),
    )
    .sort((a, b) => b.daysAgo - a.daysAgo);

  const cartHospitalCount = cart.size;
  const cartItemCount = Array.from(cart.values()).reduce((sum, set) => sum + set.size, 0);
  const isCartEmpty = cart.size === 0;
  const cartHasSearchad = Array.from(cart.values()).some((set) => set.has('searchad'));

  const searchadDateIncomplete = cartHasSearchad && Boolean(searchadStart) !== Boolean(searchadEnd);
  const searchadDateInvalid =
    cartHasSearchad && !!searchadStart && !!searchadEnd && searchadStart > searchadEnd;

  function selectConfigHospital(hid: string) {
    setConfigHospitalId(hid);
    setConfigSteps(new Set()); // 병원 바꾸면 체크 초기화
  }

  function toggleConfigStep(step: StepKey) {
    const turningOn = !configSteps.has(step);
    setConfigSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
    // SearchAd를 켜면 그 자리에서 캠페인을 고를 수 있게 바로 목록을 불러온다.
    if (step === 'searchad' && turningOn && configHospitalId && !campaignLists[configHospitalId] && !campaignLoading[configHospitalId]) {
      void loadCampaigns(configHospitalId);
    }
  }

  function addToCart(hid: string, steps: Iterable<StepKey>) {
    setCart((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(hid) ?? []);
      for (const s of steps) set.add(s);
      if (set.size > 0) next.set(hid, set);
      return next;
    });
  }

  function addConfigToCart() {
    if (!configHospitalId || configSteps.size === 0) return;
    addToCart(configHospitalId, configSteps);
    setConfigSteps(new Set());
  }

  function removeCartStep(hid: string, step: StepKey) {
    setCart((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(hid) ?? []);
      set.delete(step);
      if (set.size === 0) next.delete(hid);
      else next.set(hid, set);
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
    const s = searchParams.get('tab') ?? searchParams.get('section');
    if (s === 'stats' || s === 'collect' || s === 'schedule' || s === 'history') setTab(s);
  }, [searchParams]);

  function selectTab(key: DataTab) {
    setTab(key);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', key);
      url.searchParams.delete('section');
      window.history.replaceState(null, '', url.toString());
    }
  }

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
    let fileToUpload = selectedFile;
    if (selectedFile.size > MAX_PDF_BYTES) {
      // 30MB 초과 → 브라우저에서 압축 시도. 실패해도 정상 업로드엔 영향 없고 안내만 띄운다.
      setCompressing(true);
      try {
        fileToUpload = await compressPdfIfNeeded(selectedFile, MAX_PDF_BYTES);
      } catch (e) {
        setLocalError(
          e instanceof PdfCompressError && e.kind === 'too_large'
            ? `압축해도 ${MAX_PDF_BYTES / 1024 / 1024}MB를 초과합니다. 해당 진료분 페이지만 잘라서 올려주세요.`
            : `PDF 압축에 실패했습니다. 파일을 ${MAX_PDF_BYTES / 1024 / 1024}MB 이하로 줄여 다시 올려주세요.`,
        );
        return;
      } finally {
        setCompressing(false);
      }
    }
    formData.set('file', fileToUpload);
    formData.delete('chartPasteText');
    formData.delete('efriendsChartBlocksJson');
    await startExtract(formData);
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/admin/collect/jobs', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: CollectHistoryItem[] };
      setCollectHistory(data.jobs ?? []);
    } catch {
      /* 무시 */
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

  // 진행 상황은 '수집 내역' 탭에서 폴링한다. 여기서는 병원 신선도 표시용 last-success만 로드.
  useEffect(() => {
    if (tab !== 'collect') return;
    fetch('/api/admin/collect/last-success', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setCollectLastSuccess(d as CollectLastSuccess); })
      .catch(() => {});
  }, [tab]);

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
      const jobs = Array.from(cart.entries()).map(([hospitalId, steps]) => {
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
      setCart(new Map()); // 요청 보냈으니 장바구니 비움
      void loadHistory();
      // 진행 상황은 '수집 내역' 탭에서 본다 — 요청 성공 시 그 탭으로 이동.
      selectTab('history');
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
    if (tab !== 'collect' || !hasActiveCollectJobs) return;
    const timer = setInterval(() => void loadHistory(), 3_000);
    return () => clearInterval(timer);
  }, [tab, hasActiveCollectJobs]);

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

  const renderCollect = () => {
    const cfgSelect: CSSProperties = {
      width: '100%', padding: '9px 11px', borderRadius: 'var(--radius)',
      border: '1px solid var(--border-strong)', background: 'var(--bg)',
      color: 'var(--text)', font: 'inherit', fontSize: 13, cursor: 'pointer',
    };
    const secLabel: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 };
    return (
      <div className="adminCollectGrid">
        {/* 좌: 15일 넘게 수집되지 않은 목록 */}
        <div className="adminCollectAlerts">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 13, fontWeight: 700, color: staleAlerts.length > 0 ? 'var(--warning)' : 'var(--text)' }}>
            <AlertTriangle size={15} style={{ color: staleAlerts.length > 0 ? 'var(--warning)' : 'var(--text-muted)' }} />
            {STALE_DAYS}일 넘게 수집 안 된 항목{staleAlerts.length > 0 ? ` (${staleAlerts.length})` : ''}
          </div>
          {staleAlerts.length === 0 ? (
            <div style={{ padding: '24px 14px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
              {collectLastSuccess ? '모든 항목이 최근에 수집되었습니다.' : '수집 기록을 불러오는 중…'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6, maxHeight: 'calc(100vh - 230px)', overflowY: 'auto' }}>
              {staleAlerts.map((a) => {
                const inCart = cart.get(a.hospitalId)?.has(a.step) ?? false;
                return (
                  <div key={`${a.hospitalId}-${a.step}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '9px 11px', borderRadius: 'var(--radius)', border: '1px solid rgba(217,119,6,0.3)', background: 'var(--warning-subtle)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.hospitalName}</div>
                      <div style={{ color: 'var(--text-secondary)' }}>{a.stepLabel} · <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{a.daysAgo}일 전</span></div>
                    </div>
                    <button
                      type="button"
                      disabled={inCart}
                      onClick={() => addToCart(a.hospitalId, [a.step])}
                      style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: inCart ? 'var(--text-muted)' : 'var(--accent)', background: 'var(--bg)', border: `1px solid ${inCart ? 'var(--border)' : 'var(--accent)'}`, borderRadius: 6, padding: '4px 10px', cursor: inCart ? 'default' : 'pointer' }}
                    >
                      {inCart ? '담김' : '담기'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 우: 데이터 수집 */}
        <div className="adminCollectWork">
          {/* 병원 선택 + 항목별 마지막 수집일 */}
          <div className="adminCollectHospitals">
            {hospitalsLoading ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>병원 목록 불러오는 중…</p>
            ) : hospitalsError ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{hospitalsError}</p>
            ) : (
              <>
                <div style={secLabel}>병원 선택</div>
                <select value={configHospitalId} onChange={(e) => selectConfigHospital(e.target.value)} style={cfgSelect}>
                  <option value="">병원을 선택하세요</option>
                  {hospitals.map((h) => (
                    <option key={h.id} value={h.id}>{h.name_ko}</option>
                  ))}
                </select>

                {configHospitalId && (
                  <div style={{ marginTop: 18 }}>
                    <div style={secLabel}>
                      수집할 데이터 <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13 }}>· 항목별 마지막 수집일</span>
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                      {COLLECT_STEPS.map((step, i) => {
                        const StepIcon = STEP_ICON[step.key];
                        const last = lastSuccessOf(configHospitalId, step.key);
                        const stale = !!last && last.daysAgo > STALE_DAYS;
                        const checked = configSteps.has(step.key);
                        const inCart = cart.get(configHospitalId)?.has(step.key) ?? false;
                        return (
                          <Fragment key={step.key}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer', userSelect: 'none', background: checked ? 'var(--accent-subtle)' : 'transparent' }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleConfigStep(step.key)} />
                              <StepIcon size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                              <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{step.label}</span>
                              {inCart && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>담김</span>}
                              {last ? (
                                <span title={`마지막 수집 ${last.date}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: stale ? 'var(--warning)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                  {stale && <AlertTriangle size={12} />}
                                  {last.text}
                                </span>
                              ) : (
                                <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>수집 이력 없음</span>
                              )}
                            </label>

                            {/* SearchAd 행을 켜면 바로 아래로 캠페인 선택 확장 */}
                            {step.key === 'searchad' && checked && (
                              <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', padding: '10px 12px 12px 40px' }}>
                                {/* 수집 기간 */}
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                  수집 기간 <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(선택)</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <input type="date" value={searchadStart} max={searchadEnd || undefined} onChange={(e) => setSearchadStart(e.target.value)} style={{ fontSize: 13, padding: '5px 7px', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)' }} />
                                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>~</span>
                                  <input type="date" value={searchadEnd} min={searchadStart || undefined} onChange={(e) => setSearchadEnd(e.target.value)} style={{ fontSize: 13, padding: '5px 7px', border: '1px solid var(--border-strong)', borderRadius: 6, color: 'var(--text)' }} />
                                  {(searchadStart || searchadEnd) && (
                                    <button type="button" onClick={() => { setSearchadStart(''); setSearchadEnd(''); }} style={{ fontSize: 13, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>지우기</button>
                                  )}
                                </div>
                                <p style={{ margin: '6px 0 12px', fontSize: 11, color: (!!searchadStart && !!searchadEnd && searchadStart > searchadEnd) ? 'var(--danger)' : 'var(--text-muted)', lineHeight: 1.5 }}>
                                  {!!searchadStart && !!searchadEnd && searchadStart > searchadEnd
                                    ? '시작일이 종료일보다 늦습니다.'
                                    : Boolean(searchadStart) !== Boolean(searchadEnd)
                                      ? '시작·종료일을 모두 선택해 주세요.'
                                      : '비워두면 빠진 날짜를 자동 수집합니다.'}
                                </p>

                                {/* 캠페인 */}
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                  캠페인 선택{' '}
                                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                                    · {(campaignSel.get(configHospitalId)?.size ?? 0) > 0 ? `${campaignSel.get(configHospitalId)!.size}개 선택` : '전체'}
                                  </span>
                                </div>
                                {campaignLoading[configHospitalId] ? (
                                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>캠페인 불러오는 중…</span>
                                ) : campaignError[configHospitalId] ? (
                                  <span style={{ fontSize: 13, color: 'var(--danger)' }}>{campaignError[configHospitalId]}</span>
                                ) : (campaignLists[configHospitalId] ?? []).length === 0 ? (
                                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>캠페인이 없습니다.</span>
                                ) : (
                                  <>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>아무것도 선택하지 않으면 전체 캠페인을 수집합니다.</div>
                                    <div style={{ maxHeight: 170, overflowY: 'auto', display: 'grid', gap: 2 }}>
                                      {campaignLists[configHospitalId].map((c) => (
                                        <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', padding: '3px 0', cursor: 'pointer' }}>
                                          <input type="checkbox" checked={campaignSel.get(configHospitalId)?.has(c.id) ?? false} onChange={(e) => toggleCampaign(configHospitalId, c.id, e.target.checked)} />
                                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || c.id}</span>
                                          {c.type && <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{c.type}</span>}
                                        </label>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </Fragment>
                        );
                      })}
                    </div>

                    <button type="button" onClick={addConfigToCart} disabled={configSteps.size === 0} className="adminLegacySecondaryBtn" style={{ marginTop: 12 }}>
                      장바구니에 담기{configSteps.size > 0 ? ` (${configSteps.size})` : ''}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 우: 장바구니 */}
          <div className="adminCollectOptions">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                <ShoppingCart size={15} /> 수집 대기열{cartItemCount > 0 ? ` (${cartItemCount})` : ''}
              </span>
              {!isCartEmpty && (
                <button type="button" onClick={() => setCart(new Map())} style={{ fontSize: 13, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>비우기</button>
              )}
            </div>

            {isCartEmpty ? (
              <div style={{ padding: '32px 18px', textAlign: 'center', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-lg, 12px)', background: 'var(--bg-subtle)', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.7 }}>
                왼쪽에서 병원과 데이터를 골라<br /><strong>장바구니에 담기</strong>를 누르세요.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {Array.from(cart.entries()).map(([hid, steps]) => {
                  const hName = hospitals.find((h) => h.id === hid)?.name_ko ?? hid;
                  return (
                    <div key={hid} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', background: 'var(--bg)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 7 }}>{hName}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {COLLECT_STEPS.filter((s) => steps.has(s.key)).map((s) => (
                          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 6px 3px 9px', borderRadius: 999, background: 'var(--accent-subtle)', color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>
                            {s.short}
                            <button type="button" onClick={() => removeCartStep(hid, s.key)} aria-label="제거" style={{ display: 'inline-flex', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0 }}>
                              <X size={13} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 전체 수집 */}
            <div style={{ marginTop: 14 }}>
              <button type="button" className="adminLegacyPrimaryBtn" disabled={collectSubmitting || isCartEmpty || searchadDateIncomplete || searchadDateInvalid} onClick={() => void runCollect()} style={{ width: '100%' }}>
                {collectSubmitting ? '요청 중…' : `전체 수집 시작 (병원 ${cartHospitalCount} · 항목 ${cartItemCount})`}
              </button>
              {collectError && (
                <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--danger)', lineHeight: 1.5 }}>{collectError}</p>
              )}
              {(searchadDateIncomplete || searchadDateInvalid) && (
                <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--danger)', lineHeight: 1.5 }}>
                  {searchadDateInvalid ? 'SearchAd 시작일이 종료일보다 늦습니다.' : 'SearchAd 시작·종료일을 모두 선택해 주세요.'}
                </p>
              )}
              <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                시작하면 <strong>수집 내역</strong> 탭에서 진행 상황을 확인할 수 있어요.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderPdf = () => (
          <div className="adminLayoutMainPane">
            <div className="adminLayoutMainColumnInset">
              <div className="adminLegacyBlockBleed">
                <form onSubmit={(e) => void onSubmit(e)}>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {/* 병원 + 차트 종류 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <label htmlFor="hospitalId" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                          병원
                        </label>
                        {hospitalsLoading ? (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
                        ) : hospitalsError ? (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{hospitalsError}</p>
                        ) : hospitals.length === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                            등록된 병원이 없습니다.{' '}
                            <Link href="/admin/hospitals" style={{ fontWeight: 700, color: 'var(--text)' }}>병원 관리</Link>에서 추가해 주세요.
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
                        <label htmlFor="chartType" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                          차트 종류
                        </label>
                        <select id="chartType" name="chartType" value={chartType} onChange={(e) => setChartType(e.target.value)} style={selectLineStyle}>
                          <option value="intovet">인투벳</option>
                          <option value="plusvet">플러스벳</option>
                          <option value="efriends">이프렌즈</option>
                          <option value="woorien_pms">우리엔PMS</option>
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
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>{selectedFile.name}</p>
                          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB · 클릭해서 다시 선택</p>
                        </div>
                      ) : (
                        <div>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>PDF 드래그 또는 클릭해서 선택</p>
                          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>최대 30MB · 텍스트 기반 PDF</p>
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
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
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
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>이미지 드래그 또는 클릭해서 선택</p>
                          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>JPEG / PNG / WebP · 최대 {MAX_IMAGES}장 · 장당 8MB · 자동 압축 후 분석</p>
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

                    <button type="submit" className="adminLegacyPrimaryBtn" disabled={!canSubmit || compressing} style={{ width: '100%' }}>
                      {compressing ? '압축 중…' : isExtractRunning ? '처리 중…' : '실행'}
                    </button>
                  </div>
                </form>
              </div>

              {compressing && (
                <div className="adminLegacyBlockBleed">
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--accent)' }}>PDF 용량이 커서 압축 중이에요… 잠시만 기다려주세요.</p>
                </div>
              )}
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
  );

  const renderStats = () => (
    <AdminStatsUpload
      hospitals={hospitals}
      hospitalsLoading={hospitalsLoading}
      hospitalsError={hospitalsError}
    />
  );

  if (variant === 'extract') return renderPdf();

  return (
    <div>
      <div className="adminDataHubHeader">
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>데이터 수집</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            경영통계 업로드와 자동 수집·스케줄·수집 내역을 한 곳에서 관리합니다.
          </p>
        </div>
        <div className="adminDataTabRow">
          {DATA_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={tab === t.key ? 'adminDataTab adminDataTabActive' : 'adminDataTab'}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="adminDataTabBody">
        {tab === 'stats' && renderStats()}
        {tab === 'collect' && renderCollect()}
        {tab === 'schedule' && <AdminCollectScheduler hospitals={hospitals} inline />}
        {tab === 'history' && <CollectHistoryPanel hospitals={hospitals} />}
      </div>
    </div>
  );
}
