'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { AdminHealthCheckupWorkspace } from '@/components/admin-health-checkup-workspace';
import type { GeneratedContentListItem } from '@/lib/health-report-admin/types';
import {
  normalizeHistoryApiItem,
  extractHospitalId,
  hospitalGroupKey,
  fetchHospitalNameMapById,
  type HistoryItem,
} from '@/lib/chart-history-normalize';

const divider = 'var(--border)';

// 건강검진 리포트 ID — 차트 고유 ID(friendly_id)와 구분되게 끝에 R 을 붙인다. (병원코드-날짜-순번R)
function reportId(friendlyId: string | null | undefined): string {
  const t = friendlyId?.trim();
  return t ? `${t}R` : '';
}

function formatRailDateShort(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '—';
  }
}

export default function AdminHealthReport() {
  const [runs, setRuns] = useState<GeneratedContentListItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterHospital, setFilterHospital] = useState('');
  const [filterCheckupMonth, setFilterCheckupMonth] = useState('');
  const [filterReportMonth, setFilterReportMonth] = useState('');
  // 필터 패널: draft 로 고르고 '적용' 눌러야 목록에 반영.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftHospital, setDraftHospital] = useState('');
  const [draftCheckupMonth, setDraftCheckupMonth] = useState('');
  const [draftReportMonth, setDraftReportMonth] = useState('');
  const activeFilterCount = (filterHospital ? 1 : 0) + (filterCheckupMonth ? 1 : 0) + (filterReportMonth ? 1 : 0);
  const openFilters = () => {
    setDraftHospital(filterHospital); setDraftCheckupMonth(filterCheckupMonth); setDraftReportMonth(filterReportMonth);
    setFiltersOpen(true);
  };
  const applyFilters = () => {
    setFilterHospital(draftHospital); setFilterCheckupMonth(draftCheckupMonth); setFilterReportMonth(draftReportMonth);
    setFiltersOpen(false);
  };
  const clearDraft = () => { setDraftHospital(''); setDraftCheckupMonth(''); setDraftReportMonth(''); };

  // 차트 기록에서 리포트 만들기 모달
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const createModalRef = useRef<HTMLDialogElement>(null);
  const [chartRuns, setChartRuns] = useState<HistoryItem[]>([]);
  const [chartRunsLoading, setChartRunsLoading] = useState(false);
  const [chartRunsError, setChartRunsError] = useState<string | null>(null);
  const [chartSearch, setChartSearch] = useState('');
  const [chartFilterHospital, setChartFilterHospital] = useState('');
  const [chartFilterMonth, setChartFilterMonth] = useState('');
  const [newRunSelection, setNewRunSelection] = useState<{
    parseRunId: string;
    hospitalName?: string;
    patientName?: string;
  } | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const res = await fetch('/api/admin/health-report/runs', { credentials: 'include' });
      const data = (await res.json()) as { items?: GeneratedContentListItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '목록을 불러오지 못했습니다.');
      const items = Array.isArray(data.items) ? data.items : [];
      setRuns(items);
      setSelectedId((cur) => {
        if (cur && items.some((r) => r.parseRunId === cur)) return cur;
        return items[0]?.parseRunId ?? null;
      });
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : '목록 실패');
      setRuns([]);
      setSelectedId(null);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const deleteReport = useCallback(
    async (parseRunId: string) => {
      const target = runs.find((r) => r.parseRunId === parseRunId);
      const label =
        target?.hospitalName?.trim() || target?.patientName?.trim() || parseRunId.slice(0, 8);
      if (
        !window.confirm(
          `이 건강검진 리포트를 삭제할까요?\n(${label})\n\n생성된 리포트 내용이 삭제됩니다. 차트 추출 데이터는 유지되어 다시 생성할 수 있습니다.`,
        )
      ) {
        return;
      }
      setDeleting(true);
      setDeleteError(null);
      try {
        const res = await fetch(
          `/api/admin/health-report/content?runId=${encodeURIComponent(parseRunId)}`,
          { method: 'DELETE', credentials: 'include' },
        );
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error ?? '삭제 실패');
        if (selectedId === parseRunId) setSelectedId(null);
        await loadRuns();
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : '삭제 실패');
      } finally {
        setDeleting(false);
      }
    },
    [runs, loadRuns, selectedId],
  );

  const loadChartRuns = useCallback(async () => {
    setChartRunsLoading(true);
    setChartRunsError(null);
    try {
      const res = await fetch('/api/admin/data/parse-runs?limit=200', { credentials: 'include' });
      const payload = (await res.json()) as { items?: unknown[]; error?: string };
      if (!res.ok) throw new Error(payload.error ?? '차트 목록을 불러오지 못했습니다.');
      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      const paired = rawItems
        .map((raw) => {
          const item = normalizeHistoryApiItem(raw);
          if (!item) return null;
          return { item, hospitalId: extractHospitalId(raw) };
        })
        .filter((r): r is { item: HistoryItem; hospitalId: string | null } => r != null);
      let items = paired.map((p) => p.item);
      const needsLookup = paired.some((p) => !p.item.hospitalName && p.hospitalId != null);
      if (needsLookup) {
        try {
          const idToName = await fetchHospitalNameMapById();
          items = paired.map(({ item, hospitalId }) => {
            if (item.hospitalName || !hospitalId) return item;
            const resolved = idToName.get(hospitalId);
            return resolved ? { ...item, hospitalName: resolved } : item;
          });
        } catch { /* 병원 이름 조회 실패 시 null 유지 */ }
      }
      setChartRuns(items);
    } catch (e) {
      setChartRunsError(e instanceof Error ? e.message : '차트 목록 실패');
      setChartRuns([]);
    } finally {
      setChartRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    const dialog = createModalRef.current;
    if (!dialog) return;
    if (createModalOpen) {
      if (!dialog.open) dialog.showModal();
      void loadChartRuns();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [createModalOpen, loadChartRuns]);

  const reportByParseRunId = useMemo(
    () => new Map(runs.map((r) => [r.parseRunId, r.createdAt])),
    [runs],
  );

  const chartHospitalOptions = useMemo(
    () => [...new Set(chartRuns.map((r) => hospitalGroupKey(r.hospitalName) ?? '').filter(Boolean))].sort(),
    [chartRuns],
  );
  const chartMonthOptions = useMemo(
    () => [...new Set(chartRuns.map((r) => r.createdAt.slice(0, 7)).filter(Boolean))].sort().reverse(),
    [chartRuns],
  );
  const filteredChartRuns = useMemo(() => {
    let items = chartRuns;
    if (chartFilterHospital)
      items = items.filter((r) => (hospitalGroupKey(r.hospitalName) ?? '') === chartFilterHospital);
    if (chartFilterMonth)
      items = items.filter((r) => r.createdAt.startsWith(chartFilterMonth));
    const q = chartSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) =>
      [r.id, r.friendlyId ?? '', r.hospitalName ?? '', r.patientName ?? '', r.ownerName ?? '', r.createdAt]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [chartRuns, chartFilterHospital, chartFilterMonth, chartSearch]);

  const hospitalOptions = useMemo(
    () => [...new Set(runs.map((r) => r.hospitalName?.trim() ?? '').filter(Boolean))].sort(),
    [runs],
  );
  const checkupMonthOptions = useMemo(
    () =>
      [...new Set(runs.map((r) => (r.parseRunCreatedAt ?? '').slice(0, 7)).filter(Boolean))].sort().reverse(),
    [runs],
  );
  const reportMonthOptions = useMemo(
    () => [...new Set(runs.map((r) => r.createdAt.slice(0, 7)).filter(Boolean))].sort().reverse(),
    [runs],
  );

  const filteredRuns = useMemo(() => {
    let items = runs;
    if (filterHospital) items = items.filter((r) => (r.hospitalName?.trim() ?? '') === filterHospital);
    if (filterCheckupMonth)
      items = items.filter((r) => (r.parseRunCreatedAt ?? '').startsWith(filterCheckupMonth));
    if (filterReportMonth) items = items.filter((r) => r.createdAt.startsWith(filterReportMonth));
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => {
      const hay = [
        r.id,
        r.parseRunId,
        r.friendlyId ?? '',
        reportId(r.friendlyId),
        r.patientName ?? '',
        r.hospitalName ?? '',
        r.updatedAt,
        r.createdAt,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [runs, filterHospital, filterCheckupMonth, filterReportMonth, search]);

  useEffect(() => {
    if (filteredRuns.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((cur) => {
      if (cur && filteredRuns.some((r) => r.parseRunId === cur)) return cur;
      return filteredRuns[0]!.parseRunId;
    });
  }, [filteredRuns]);

  return (
    <div className="adminLayout2WithMain">
      <aside className="adminLayoutSecondaryRail" aria-label="건강검진 보고서 목록">
        <div style={{ position: 'relative', zIndex: 5 }}>
        <div className="adminRailToolbar">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="병원·환자·기록번호 검색"
            aria-label="보고서 목록 검색"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 0',
              background: 'transparent',
              border: 0,
              borderRadius: 0,
              outline: 'none',
              font: 'inherit',
              fontSize: 13,
            }}
            disabled={runsLoading}
          />
          {!runsLoading && runs.length > 0 && (
            <button
              type="button"
              onClick={() => (filtersOpen ? setFiltersOpen(false) : openFilters())}
              aria-label="필터"
              title="필터"
              style={{
                position: 'relative', flexShrink: 0, border: 0, background: 'transparent', cursor: 'pointer',
                padding: '2px 4px', display: 'inline-flex', alignItems: 'center',
                color: activeFilterCount > 0 || filtersOpen ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              <Filter size={16} fill={activeFilterCount > 0 ? 'currentColor' : 'none'} />
              {activeFilterCount > 0 && (
                <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 999, background: 'var(--accent)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
        </div>
        {!runsLoading && runs.length > 0 && filtersOpen && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, padding: '4px 10px 8px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', boxShadow: '0 8px 24px rgba(0,0,0,0.16)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>필터</span>
                <button type="button" onClick={clearDraft} style={{ border: 0, background: 'transparent', fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}>
                  초기화
                </button>
              </div>
              <select className="adminRailFilterSelect" value={draftHospital} onChange={(e) => setDraftHospital(e.target.value)} aria-label="병원 필터" style={{ width: '100%' }}>
                <option value="">병원 전체</option>
                {hospitalOptions.map((h) => (<option key={h} value={h}>{h}</option>))}
              </select>
              <select className="adminRailFilterSelect" value={draftCheckupMonth} onChange={(e) => setDraftCheckupMonth(e.target.value)} aria-label="검진 날짜 필터" style={{ width: '100%' }}>
                <option value="">검진월 전체</option>
                {checkupMonthOptions.map((m) => (<option key={m} value={m}>{`${m.slice(2, 4)}년 ${String(Number(m.slice(5, 7)))}월`}</option>))}
              </select>
              <select className="adminRailFilterSelect" value={draftReportMonth} onChange={(e) => setDraftReportMonth(e.target.value)} aria-label="리포트 생성 날짜 필터" style={{ width: '100%' }}>
                <option value="">생성월 전체</option>
                {reportMonthOptions.map((m) => (<option key={m} value={m}>{`${m.slice(2, 4)}년 ${String(Number(m.slice(5, 7)))}월`}</option>))}
              </select>
              <button
                type="button"
                onClick={applyFilters}
                style={{ marginTop: 2, padding: '8px 0', width: '100%', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                적용
              </button>
            </div>
          </div>
        )}
        </div>
        <div style={{ maxHeight: 'min(66vh, calc(100vh - 260px))', overflow: 'auto' }}>
          {runsLoading ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--text-muted)' }}>불러오는 중…</p>
          ) : runsError ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--danger)' }}>{runsError}</p>
          ) : runs.length === 0 ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              아직 저장된 건강검진 컨텐츠가 없습니다. chart-api에서 생성·저장된 뒤 여기 목록에 나타납니다.
            </p>
          ) : filteredRuns.length === 0 ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--text-muted)' }}>검색 결과 없음</p>
          ) : (
            filteredRuns.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`adminRailRow${selectedId === r.parseRunId ? ' adminRailRowActive' : ''}`}
                onClick={() => setSelectedId(r.parseRunId)}
                disabled={runsLoading}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontWeight: 700, color: 'inherit', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.hospitalName?.trim() || '병원명 없음'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatRailDateShort(r.updatedAt)}
                  </span>
                </div>
                <span className="adminRailSub">
                  {r.patientName?.trim() ? `${r.patientName.trim()} · ` : ''}
                  {reportId(r.friendlyId) || r.parseRunId.slice(0, 8)}
                </span>
              </button>
            ))
          )}
        </div>

        <div style={{ padding: '10px 10px 6px', borderTop: `1px solid ${divider}` }}>
          <button
            type="button"
            className="adminLegacyPrimaryBtn"
            style={{ width: '100%', fontSize: 13 }}
            onClick={() => setCreateModalOpen(true)}
          >
            + 건강검진 리포트 만들기
          </button>
        </div>
      </aside>

      <div className="adminLayoutMainPane">
        <div className="adminLayoutMainColumnInset">
          {selectedId ? (
            <div style={{ borderTop: `1px solid ${divider}`, paddingTop: 12 }}>
              {runs.some((r) => r.parseRunId === selectedId) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {reportId(runs.find((r) => r.parseRunId === selectedId)?.friendlyId)
                      ? `리포트 ID · ${reportId(runs.find((r) => r.parseRunId === selectedId)?.friendlyId)}`
                      : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {deleteError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{deleteError}</span>}
                    <button
                      type="button"
                      className="adminLegacySmallBtn"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger-subtle)' }}
                      disabled={deleting}
                      onClick={() => void deleteReport(selectedId)}
                      title="이 건강검진 리포트만 삭제 (차트 추출 데이터는 유지)"
                    >
                      {deleting ? '삭제 중…' : '리포트 삭제'}
                    </button>
                  </div>
                </div>
              )}
              <AdminHealthCheckupWorkspace
                runId={selectedId}
                hospitalName={runs.find((r) => r.parseRunId === selectedId)?.hospitalName ?? newRunSelection?.hospitalName}
                patientName={runs.find((r) => r.parseRunId === selectedId)?.patientName ?? newRunSelection?.patientName}
                onRunsChanged={() => { setNewRunSelection(null); void loadRuns(); }}
              />
            </div>
          ) : (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>목록에서 항목을 선택해 주세요.</p>
          )}
        </div>
      </div>
      <dialog
        ref={createModalRef}
        onClose={() => setCreateModalOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setCreateModalOpen(false); }}
        style={{
          position: 'fixed',
          inset: 0,
          margin: 'auto',
          width: 'min(96vw, 760px)',
          maxHeight: '88vh',
          border: '1px solid rgba(15,23,42,0.15)',
          borderRadius: 8,
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '88vh', maxHeight: '88vh', background: '#fff' }}>
          {/* 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${divider}`, flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>차트 기록에서 선택</span>
            <button type="button" className="adminLegacySmallBtn" onClick={() => setCreateModalOpen(false)}>닫기</button>
          </div>

          {/* 검색·필터 */}
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${divider}`, flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input
              type="search"
              placeholder="병원·환자·기록번호 검색"
              value={chartSearch}
              onChange={(e) => setChartSearch(e.target.value)}
              style={{ flex: '1 1 180px', minWidth: 0, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13, outline: 'none' }}
            />
            <select
              value={chartFilterHospital}
              onChange={(e) => setChartFilterHospital(e.target.value)}
              style={{ flex: '1 1 140px', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
            >
              <option value="">병원 전체</option>
              {chartHospitalOptions.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <select
              value={chartFilterMonth}
              onChange={(e) => setChartFilterMonth(e.target.value)}
              style={{ flex: '1 1 120px', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
            >
              <option value="">추출월 전체</option>
              {chartMonthOptions.map((m) => (
                <option key={m} value={m}>{`${m.slice(2, 4)}년 ${Number(m.slice(5, 7))}월`}</option>
              ))}
            </select>
          </div>

          {/* 목록 */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {chartRunsLoading ? (
              <p style={{ margin: '16px', fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
            ) : chartRunsError ? (
              <p style={{ margin: '16px', fontSize: 13, color: 'var(--danger)' }}>{chartRunsError}</p>
            ) : filteredChartRuns.length === 0 ? (
              <p style={{ margin: '16px', fontSize: 13, color: 'var(--text-muted)' }}>
                {chartRuns.length === 0 ? '차트 기록이 없습니다.' : '검색 결과가 없습니다.'}
              </p>
            ) : (
              filteredChartRuns.map((item) => {
                const reportCreatedAt = reportByParseRunId.get(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setNewRunSelection({
                        parseRunId: item.id,
                        hospitalName: item.hospitalName ?? undefined,
                        patientName: item.patientName ?? undefined,
                      });
                      setCreateModalOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 16px',
                      borderBottom: `1px solid ${divider}`,
                      background: 'transparent',
                      border: 'none',
                      borderBottomWidth: 1,
                      borderBottomStyle: 'solid',
                      borderBottomColor: divider,
                      cursor: 'pointer',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-subtle)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {hospitalGroupKey(item.hospitalName) || '병원명 없음'}
                        </span>
                        {item.patientName && (
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.patientName}</span>
                        )}
                        {item.friendlyId && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.friendlyId}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {new Date(item.createdAt).toLocaleDateString('ko-KR')} 추출
                      </div>
                    </div>
                    {reportCreatedAt ? (
                      <span style={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: 'var(--success-subtle)',
                        color: 'var(--success)',
                        whiteSpace: 'nowrap',
                      }}>
                        리포트 {new Date(reportCreatedAt).toLocaleDateString('ko-KR')}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
