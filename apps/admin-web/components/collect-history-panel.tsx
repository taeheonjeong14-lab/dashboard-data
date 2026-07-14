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
  RotateCcw,
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
  outputTail?: string;
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

// 수집 실패 원시 에러("종료 코드 N. <stderr 꼬리>")를 사람이 읽을 수 있는 원인 설명으로 풀어준다.
// 알려진 패턴이 없으면 null → 화면은 원시 에러를 그대로 보조 표기.
function humanizeCollectError(raw?: string): string | null {
  if (!raw) return null;
  const e = raw.toLowerCase();
  const has = (re: RegExp) => re.test(e);

  if (has(/reaper|고아 잡|진행이 없어|워커 중단|watchdog/)) {
    return '수집이 오래 멈춰 있어 자동 중단됐습니다(타임아웃 또는 워커 응답 없음). 다시 실행해 보세요.';
  }
  if (has(/gemini_api_key|api[_ ]?key (not|미설정|없)|missing.*api key/)) {
    return 'AI(Gemini) API 키가 없거나 잘못됐습니다. 워커 환경변수(GEMINI_API_KEY)를 확인하세요.';
  }
  if (has(/modulenotfounderror|no module named|importerror/)) {
    return '워커 PC에 필요한 파이썬 패키지가 설치돼 있지 않습니다. (의존성 재설치 필요)';
  }
  if (has(/econnrefused|cannot connect|chrome|chromium|browser|devtools|9222|websocket|target page|debugging port|디버그 포트/)) {
    return '수집용 크롬(브라우저)에 연결하지 못했습니다. 워커 PC의 크롬이 꺼져 있거나 디버그 포트가 닫혔을 수 있어요.';
  }
  if (has(/captcha|보안문자|robot|verify you are human|자동입력 방지/)) {
    return '네이버 보안문자(캡차)에 막혔습니다. 사람이 한 번 로그인/인증을 거쳐야 합니다.';
  }
  if (has(/login|로그인|sign ?in|authentication|세션|logout|로그아웃|credential/)) {
    return '네이버 로그인/세션이 만료됐을 수 있습니다. 계정 재로그인이 필요합니다.';
  }
  if (has(/429|too many requests|rate ?limit|차단|blocked|403|forbidden/)) {
    return '네이버가 요청을 차단했거나 너무 잦은 요청으로 제한됐습니다. 잠시 후 다시 시도하세요.';
  }
  if (has(/timeout|timed out|etimedout|navigation timeout|시간 초과/)) {
    return '페이지 로딩이 제한 시간을 넘겼습니다(타임아웃). 네트워크가 느리거나 페이지가 응답하지 않았어요.';
  }
  if (has(/selector|waiting for|element|no node found|queryselector|locator|not found.*element/)) {
    return '페이지에서 예상한 항목을 찾지 못했습니다. 네이버 페이지 구조가 바뀌었을 수 있어요(스크래퍼 점검 필요).';
  }
  if (has(/enotfound|eai_again|econnreset|getaddrinfo|network|dns/)) {
    return '네트워크 연결 오류가 발생했습니다. (일시적 연결 문제일 수 있어요)';
  }
  if (has(/pgrst|duplicate key|violates|relation .* does not exist|column .* does not exist|supabase|insert|upsert.*fail/)) {
    return '수집한 데이터를 DB에 저장하는 중 오류가 발생했습니다.';
  }
  if (has(/spawn/)) {
    return '수집 프로그램(스크립트) 실행 자체에 실패했습니다. (워커의 파이썬/노드 환경 문제)';
  }
  if (has(/no keyword|키워드(가)? 없|대상(이)? 없|빈 목록|empty/)) {
    return '수집할 대상(키워드 등)이 없습니다. 해당 병원 설정을 확인하세요.';
  }
  return null;
}

// 다시 시작 시 재수집할 단계 키 목록을 계산한다.
// - 단계별 에러가 있으면(부분 실패) 그 실패한 단계만 골라 재시도(성공 단계 불필요 재수집 방지).
// - 단계별 에러가 없으면(리퍼/타임아웃/크래시로 통째 실패) 원래 잡의 범위(stepsFilter) 그대로 재시도.
//   stepsFilter 도 없으면 undefined → run API 가 전체 단계로 처리.
function retrySteps(item: HistoryItem): string[] | undefined {
  const labelToKey = new Map(COLLECT_STEPS.map((s) => [s.label, s.key]));
  const failedKeys = (item.failedSteps ?? [])
    .map((s) => labelToKey.get(s.name))
    .filter((k): k is string => Boolean(k));
  if (failedKeys.length > 0) return failedKeys;
  return item.stepsFilter ?? undefined;
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
  const [retryingKey, setRetryingKey] = useState<string | null>(null);

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

  // 실패한 자동 수집을 다시 큐에 넣는다(실패 단계만, 또는 원래 범위 그대로). 성공 시 목록을 새로고침.
  const retry = useCallback(
    async (item: HistoryItem) => {
      if (!item.hospitalId) return;
      setRetryingKey(item.key);
      setError(null);
      try {
        const steps = retrySteps(item);
        const res = await fetch('/api/admin/collect/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobs: [{ hospitalId: item.hospitalId, ...(steps ? { steps } : {}) }] }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error ?? '다시 시작에 실패했습니다.');
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '다시 시작에 실패했습니다.');
      } finally {
        setRetryingKey(null);
      }
    },
    [load],
  );

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
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>수집 내역</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            경영통계 수동 업로드와 자동 수집(수동 실행·스케줄)이 한 곳에 시간순으로 모입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }}
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
            // 다시 시작: 자동 수집(auto)이고 병원이 지정돼 있으며 실패(또는 일부 단계 실패)한 경우에만.
            // 경영통계 수동 업로드(manual_stats)는 파일 재업로드가 필요해 재시도 대상이 아니다.
            const canRetry =
              item.kind === 'auto' &&
              !!item.hospitalId &&
              (item.status === 'failed' || (item.failedSteps?.length ?? 0) > 0);
            const isRetrying = retryingKey === item.key;
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
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{nameOf(item.hospitalId)}</span>
                      <Badge {...src} />
                      {item.kind === 'manual_stats' && item.chartType && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {CHART_TYPE_LABEL[item.chartType] ?? item.chartType}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {formatKst(item.at)}
                      {dur && ` · ${dur}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {canRetry && (
                      <button
                        type="button"
                        onClick={() => void retry(item)}
                        disabled={isRetrying}
                        title="이 수집을 다시 실행합니다(실패한 단계 위주)"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--accent)',
                          background: 'var(--accent-subtle)',
                          border: '1px solid rgba(29,78,216,0.22)',
                          borderRadius: 8,
                          padding: '5px 10px',
                          cursor: isRetrying ? 'default' : 'pointer',
                          opacity: isRetrying ? 0.6 : 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <RotateCcw size={12} className={isRetrying ? 'adminSpin' : undefined} />
                        {isRetrying ? '요청 중…' : '다시 시작'}
                      </button>
                    )}
                    <Badge {...sv} />
                  </div>
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
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-secondary)' }}>
                                {stepDone ? (
                                  <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
                                ) : running ? (
                                  <Loader2 size={13} className="adminSpin" style={{ color: 'var(--accent)', flexShrink: 0 }} />
                                ) : (
                                  <Clock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                )}
                                {s.label}
                              </span>
                              <span style={{ fontSize: 11, color: stepDone ? 'var(--success)' : 'var(--text-muted)' }}>
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
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
                    <span>적재 <strong style={{ color: 'var(--accent)' }}>{(item.importedRows ?? 0).toLocaleString()}</strong>행</span>
                    <span>전체 {(item.totalRows ?? 0).toLocaleString()}행</span>
                    {(item.errorRows ?? 0) > 0 && <span style={{ color: 'var(--danger)' }}>오류 {item.errorRows}행</span>}
                    {item.sourceFileName && (
                      <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{item.sourceFileName}</span>
                    )}
                  </div>
                ) : (
                  ((item.upserts?.length ?? 0) > 0 || (item.failedSteps?.length ?? 0) > 0 || item.status === 'failed') && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'grid', gap: 4, fontSize: 13 }}>
                      {item.failedSteps?.map((s) => {
                        const human = humanizeCollectError(s.error);
                        return (
                          <div key={`${s.index}-${s.name}`} style={{ display: 'grid', gap: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, color: 'var(--danger)' }}>
                              <XCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                              <span><span style={{ fontWeight: 600 }}>{s.name}</span>{(human || s.error) && <span> — {human ?? s.error}</span>}</span>
                            </div>
                            {/* 풀어쓴 설명을 띄운 경우, 원시 에러는 디버깅용으로 작게 보조 표기 */}
                            {human && s.error && (
                              <div style={{ marginLeft: 18, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>
                                {s.error}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* steps 에 에러가 없는데 실패한 경우(리퍼/타임아웃/크래시) — output 로그 기반 사유 */}
                      {(item.failedSteps?.length ?? 0) === 0 && item.status === 'failed' && (() => {
                        const human = humanizeCollectError(item.outputTail);
                        const tail = (item.outputTail ?? '').trim();
                        const main = human ?? (tail ? tail.slice(-300) : '실패 사유가 기록되지 않았습니다. (로그 미기록)');
                        return (
                          <div style={{ display: 'grid', gap: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, color: 'var(--danger)' }}>
                              <XCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                              <span><span style={{ fontWeight: 600 }}>수집 실패</span> — {main}</span>
                            </div>
                            {human && tail && (
                              <div style={{ marginLeft: 18, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4, maxHeight: 96, overflowY: 'auto' }}>
                                {tail.slice(-600)}
                              </div>
                            )}
                          </div>
                        );
                      })()}
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
