'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  FileSpreadsheet,
  RefreshCw,
  CalendarClock,
  MousePointerClick,
  type LucideIcon,
} from 'lucide-react';

type UpsertItem = { label: string; count: number; skipped?: boolean; dateRange?: string | null };
type StepItem = { index: number; name: string; error?: string };

type HistoryItem = {
  key: string;
  kind: 'manual_stats' | 'auto';
  id: string;
  hospitalId: string | null;
  status: string;
  at: string;
  startedAt: string | null;
  finishedAt: string | null;
  chartType?: string | null;
  sourceFileName?: string | null;
  importedRows?: number;
  totalRows?: number;
  errorRows?: number;
  origin?: 'manual' | 'schedule';
  upserts?: UpsertItem[];
  failedSteps?: StepItem[];
  progress?: Record<string, { done: number; total: number; label?: string | null }>;
  stepsFilter?: string[] | null;
  doneStepNames?: string[];
};

// 진행률 바 라벨 매핑 (collect_jobs.progress 키 ↔ steps[].name)
const COLLECT_STEPS: { key: string; label: string }[] = [
  { key: 'blog_metrics', label: '블로그 일별 지표' },
  { key: 'smartplace', label: '스마트플레이스 유입' },
  { key: 'keyword_rank', label: '블로그/플레이스 키워드 순위' },
  { key: 'searchad', label: 'SearchAd 일별 성과' },
  { key: 'place_reviews', label: '스마트플레이스 리뷰 추이' },
];

function formatKst(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function durationText(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const sec = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (sec < 0) return null;
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
}

type Visual = { icon: LucideIcon; label: string; color: string; bg: string; border: string; spin?: boolean };
function statusVisual(status: string): Visual {
  switch (status) {
    case 'done':
      return { icon: CheckCircle2, label: '완료', color: 'var(--success)', bg: 'var(--success-subtle)', border: 'rgba(22,163,74,0.25)' };
    case 'failed':
      return { icon: XCircle, label: '실패', color: 'var(--danger)', bg: 'var(--danger-subtle)', border: 'rgba(185,28,28,0.25)' };
    case 'running':
      return { icon: Loader2, label: '진행 중', color: 'var(--accent)', bg: 'var(--accent-subtle)', border: 'rgba(29,78,216,0.22)', spin: true };
    default:
      return { icon: Clock, label: '대기 중', color: 'var(--text-muted)', bg: 'var(--bg-subtle)', border: 'var(--border)' };
  }
}

function Badge({ icon: Icon, label, color, bg, border, spin }: Visual) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: bg,
        border: `1px solid ${border}`,
        color,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}
    >
      <Icon size={12} className={spin ? 'adminSpin' : undefined} />
      {label}
    </span>
  );
}

// 출처(수단) 배지 — 경영통계 수동 / 자동(수동실행) / 자동(스케줄)
function sourceVisual(item: HistoryItem): Visual {
  if (item.kind === 'manual_stats')
    return { icon: FileSpreadsheet, label: '경영통계', color: 'var(--text-secondary)', bg: 'var(--bg-subtle)', border: 'var(--border)' };
  if (item.origin === 'schedule')
    return { icon: CalendarClock, label: '스케줄 자동', color: 'var(--accent)', bg: 'var(--accent-subtle)', border: 'rgba(29,78,216,0.22)' };
  return { icon: MousePointerClick, label: '수동 실행', color: 'var(--text-secondary)', bg: 'var(--bg-subtle)', border: 'var(--border)' };
}

const CHART_TYPE_LABEL: Record<string, string> = {
  intovet: '인투벳',
  plusvet: '플러스벳',
  efriends: '이프렌즈',
  woorien_pms: '우리엔PMS',
};

export default function CollectHistoryPanel({ hospitals }: { hospitals: ChartHospitalOption[] }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useCallback(
    (hid: string | null) => (hid ? hospitals.find((h) => h.id === hid)?.name_ko ?? hid : '전체 병원'),
    [hospitals],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/collect/history', { credentials: 'include' });
      const data = (await res.json()) as { items?: HistoryItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '불러오기 실패');
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 진행 중(대기/수집 중) 항목이 있으면 자동 새로고침해서 진행 상황을 갱신한다.
  const hasActive = items.some((i) => i.status === 'running' || i.status === 'pending');
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>수집 내역</h2>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            경영통계 수동 업로드와 자동 수집(수동 실행·스케줄)이 한 곳에 시간순으로 모입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }}
        >
          <RefreshCw size={13} className={loading ? 'adminSpin' : undefined} />
          새로고침
        </button>
      </div>

      {error && <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}

      {loading && items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>수집 내역이 없습니다.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((item) => {
            const sv = statusVisual(item.status);
            const src = sourceVisual(item);
            const dur = durationText(item.startedAt, item.finishedAt);
            const isFail = item.status === 'failed' || (item.errorRows ?? 0) > 0 || (item.failedSteps?.length ?? 0) > 0;
            return (
              <div
                key={item.key}
                style={{
                  padding: '12px 14px',
                  background: 'var(--bg)',
                  border: `1px solid ${isFail ? 'rgba(185,28,28,0.25)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{nameOf(item.hospitalId)}</span>
                      <Badge {...src} />
                      {item.kind === 'manual_stats' && item.chartType && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {CHART_TYPE_LABEL[item.chartType] ?? item.chartType}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {formatKst(item.at)}
                      {dur && ` · ${dur}`}
                    </span>
                  </div>
                  <Badge {...sv} />
                </div>

                {/* 진행 중 항목의 단계별 진행률 바 */}
                {item.kind === 'auto' && (item.status === 'running' || item.status === 'pending') && (() => {
                  const filter = item.stepsFilter;
                  const stepKeys = filter && filter.length > 0 ? COLLECT_STEPS.filter((s) => filter.includes(s.key)) : COLLECT_STEPS;
                  const doneNames = new Set(item.doneStepNames ?? []);
                  return (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'grid', gap: 9 }}>
                      {stepKeys.map((s) => {
                        const p = item.progress?.[s.key];
                        const stepDone = doneNames.has(s.label);
                        const total = p?.total ?? 0;
                        const done = stepDone ? (total || 1) : (p?.done ?? 0);
                        const pct = stepDone ? 100 : total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                        const running = item.status === 'running' && !stepDone && (p?.done ?? 0) > 0;
                        const statusText = stepDone
                          ? '완료'
                          : running
                            ? `${done.toLocaleString()}/${total.toLocaleString()}${p?.label ? ` · ${p.label}` : ''}`
                            : '대기';
                        return (
                          <div key={s.key}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                                {stepDone ? (
                                  <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                ) : running ? (
                                  <Loader2 size={13} className="adminSpin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
                                ) : (
                                  <Clock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                )}
                                {s.label}
                              </span>
                              <span style={{ fontSize: 11.5, color: stepDone ? 'var(--success)' : 'var(--text-muted)' }}>
                                {statusText}{!stepDone && pct > 0 ? ` (${pct}%)` : ''}
                              </span>
                            </div>
                            <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: stepDone ? 'var(--success)' : 'var(--accent)', transition: 'width 0.4s ease' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* 요약 */}
                {item.kind === 'manual_stats' ? (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    <span>적재 <strong style={{ color: 'var(--accent)' }}>{(item.importedRows ?? 0).toLocaleString()}</strong>행</span>
                    <span>전체 {(item.totalRows ?? 0).toLocaleString()}행</span>
                    {(item.errorRows ?? 0) > 0 && <span style={{ color: 'var(--danger)' }}>오류 {item.errorRows}행</span>}
                    {item.sourceFileName && (
                      <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{item.sourceFileName}</span>
                    )}
                  </div>
                ) : (
                  ((item.upserts?.length ?? 0) > 0 || (item.failedSteps?.length ?? 0) > 0) && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'grid', gap: 4, fontSize: 12.5 }}>
                      {item.failedSteps?.map((s) => (
                        <div key={`${s.index}-${s.name}`} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--danger)' }}>
                          <XCircle size={13} style={{ flexShrink: 0 }} />
                          <span style={{ fontWeight: 600 }}>{s.name}</span>
                          {s.error && <span>— {s.error}</span>}
                        </div>
                      ))}
                      {item.upserts?.map((u) => (
                        <div key={u.label} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                          <span>{u.label}</span>
                          <span style={{ fontWeight: 600, color: u.skipped ? 'var(--text-muted)' : 'var(--accent)' }}>
                            {u.skipped ? '이미 최신' : `${u.count.toLocaleString()}건${u.dateRange ? ` (${u.dateRange})` : ''}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
