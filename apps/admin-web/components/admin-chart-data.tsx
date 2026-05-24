'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChartExtraction } from '@/components/chart-extraction-provider';
import { AdminRunExtractionDetail } from '@/components/admin-run-extraction-detail';
import AdminDataUpload from '@/components/admin-data-upload';
import {
  extractHospitalId,
  fetchHospitalNameMapById,
  hospitalGroupKey,
  normalizeHistoryApiItem,
  type HistoryItem,
} from '@/lib/chart-history-normalize';

const divider = 'rgba(15, 23, 42, 0.1)';

function formatRunRailDateShort(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '—';
  }
}

export default function AdminChartData() {
  const { lastRunId } = useChartExtraction();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterHospital, setFilterHospital] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [serverMeta, setServerMeta] = useState<{ totalParseRuns: number; limit: number } | null>(null);
  const [selectedId, setSelectedId] = useState('');

  // 차트 데이터 수집(PDF 업로드) 모달
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const uploadModalRef = useRef<HTMLDialogElement>(null);

  const loadHistoryList = useCallback(async () => {
    setHistoryLoading(true);
    setListError(null);
    try {
      const response = await fetch('/api/admin/data/parse-runs?limit=80', { credentials: 'include' });
      const payload = (await response.json()) as {
        items?: unknown[];
        error?: string;
        pgCode?: string;
        meta?: { totalParseRuns?: number; limit?: number };
      };
      if (!response.ok) {
        const base = (payload.error ?? '').trim() || '이력을 불러오지 못했습니다.';
        const extra = payload.pgCode ? ` (PostgreSQL 코드: ${payload.pgCode})` : '';
        throw new Error(`${base}${extra}`);
      }
      setServerMeta(
        payload.meta != null &&
          typeof payload.meta.totalParseRuns === 'number' &&
          typeof payload.meta.limit === 'number'
          ? { totalParseRuns: payload.meta.totalParseRuns, limit: payload.meta.limit }
          : null,
      );
      const rawItems = Array.isArray(payload.items)
        ? payload.items
        : Array.isArray((payload as { data?: unknown[] }).data)
          ? (payload as { data: unknown[] }).data
          : [];
      const paired = rawItems
        .map((raw) => {
          const item = normalizeHistoryApiItem(raw);
          if (!item) return null;
          return { item, hospitalId: extractHospitalId(raw) };
        })
        .filter((row): row is { item: HistoryItem; hospitalId: string | null } => row != null);
      let items = paired.map((p) => p.item);
      const needsHospitalLookup = paired.some((p) => !p.item.hospitalName && p.hospitalId != null);
      if (needsHospitalLookup) {
        try {
          const idToName = await fetchHospitalNameMapById();
          items = paired.map(({ item, hospitalId }) => {
            if (item.hospitalName || !hospitalId) return item;
            const resolved = idToName.get(hospitalId);
            return resolved ? { ...item, hospitalName: resolved } : item;
          });
        } catch {
          /* 병원 목록 실패 시 hospitalName null 유지 */
        }
      }
      setHistory(items);
    } catch (loadError) {
      console.error(loadError);
      setServerMeta(null);
      setListError(loadError instanceof Error ? loadError.message : '이력을 불러오지 못했습니다.');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistoryList();
  }, [loadHistoryList]);

  useEffect(() => {
    if (lastRunId) void loadHistoryList();
  }, [lastRunId, loadHistoryList]);

  useEffect(() => {
    const dialog = uploadModalRef.current;
    if (!dialog) return;
    if (uploadModalOpen) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [uploadModalOpen]);

  const hospitalOptions = useMemo(
    () => [...new Set(history.map((h) => h.hospitalName?.trim() ?? '').filter(Boolean))].sort(),
    [history],
  );
  const monthOptions = useMemo(
    () => [...new Set(history.map((h) => h.createdAt.slice(0, 7)).filter(Boolean))].sort().reverse(),
    [history],
  );

  const filteredHistory = useMemo(() => {
    let items = history;
    if (filterHospital) items = items.filter((h) => (h.hospitalName?.trim() ?? '') === filterHospital);
    if (filterMonth) items = items.filter((h) => h.createdAt.startsWith(filterMonth));
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const hay = [
        item.id,
        item.friendlyId ?? '',
        item.hospitalName ?? '',
        item.ownerName ?? '',
        item.patientName ?? '',
        item.createdAt,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [history, filterHospital, filterMonth, search]);

  useEffect(() => {
    if (filteredHistory.length === 0) {
      setSelectedId('');
      return;
    }
    const last = lastRunId?.trim();
    if (last && filteredHistory.some((h) => h.id === last)) {
      setSelectedId(last);
      return;
    }
    setSelectedId((cur) =>
      cur && filteredHistory.some((h) => h.id === cur) ? cur : filteredHistory[0]!.id,
    );
  }, [filteredHistory, lastRunId]);

  async function deleteRun(item: HistoryItem) {
    if (
      !window.confirm(
        '이 케이스의 차트 추출 기록·연결된 DB 데이터·이미지 분석 Storage 파일을 삭제합니다. 계속할까요?',
      )
    ) {
      return;
    }
    setDeleteError(null);
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/admin/data/parse-runs/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setDeleteError(payload.error ?? '삭제에 실패했습니다.');
        return;
      }
      setHistory((prev) => prev.filter((h) => h.id !== item.id));
      if (selectedId === item.id) setSelectedId('');
    } catch {
      setDeleteError('삭제에 실패했습니다. 네트워크를 확인해 주세요.');
    } finally {
      setDeletingId(null);
    }
  }

  const selected = useMemo(
    () => filteredHistory.find((h) => h.id === selectedId) ?? null,
    [filteredHistory, selectedId],
  );

  return (
    <div className="adminLayout2WithMain">
      <aside className="adminLayoutSecondaryRail" aria-label="차트 추출 이력 목록">
        <div className="adminRailToolbar">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="병원·환자·기록번호 검색"
            aria-label="이력 검색"
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
            disabled={historyLoading}
          />
          {!historyLoading && history.length > 0 && (
            <span style={{ fontSize: 11.5, color: '#94a3b8', flexShrink: 0 }}>
              {search.trim() || filterHospital || filterMonth
                ? `${filteredHistory.length} / ${history.length}`
                : history.length}건
            </span>
          )}
        </div>
        {!historyLoading && history.length > 0 && (
          <div className="adminRailFilterBar">
            <select
              className="adminRailFilterSelect"
              value={filterHospital}
              onChange={(e) => setFilterHospital(e.target.value)}
              aria-label="병원 필터"
            >
              <option value="">병원 전체</option>
              {hospitalOptions.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <select
              className="adminRailFilterSelect"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              aria-label="추출 날짜 필터"
            >
              <option value="">추출월 전체</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {`${m.slice(2, 4)}년 ${String(Number(m.slice(5, 7)))}월`}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ maxHeight: 'min(66vh, calc(100vh - 260px))', overflow: 'auto' }}>
          {historyLoading ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: '#64748b' }}>불러오는 중…</p>
          ) : listError ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: '#b91c1c' }}>{listError}</p>
          ) : filteredHistory.length === 0 ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: '#64748b' }}>
              {history.length === 0 ? '이력 없음' : '검색 결과 없음'}
            </p>
          ) : (
            filteredHistory.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`adminRailRow${selectedId === item.id ? ' adminRailRowActive' : ''}`}
                onClick={() => setSelectedId(item.id)}
                disabled={historyLoading}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontWeight: 700, color: 'inherit', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hospitalGroupKey(item.hospitalName) || '—'}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>
                    {formatRunRailDateShort(item.createdAt)}
                  </span>
                </div>
                <span className="adminRailSub">
                  {item.patientName?.trim() ? `${item.patientName.trim()} · ` : ''}
                  {item.friendlyId?.trim() ?? '—'}
                  {item.fromHospital ? (
                    <span
                      style={{
                        marginLeft: 6,
                        display: 'inline-block',
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: '#dbeafe',
                        color: '#1d4ed8',
                        fontSize: 10,
                        fontWeight: 700,
                        verticalAlign: 'middle',
                      }}
                    >
                      병원 제출
                    </span>
                  ) : null}
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
            onClick={() => setUploadModalOpen(true)}
          >
            + 차트 데이터 수집
          </button>
        </div>
      </aside>

      <div className="adminLayoutMainPane">
        <div className="adminLayoutMainColumnInset">
          {listError && !historyLoading ? (
            <p style={{ margin: '0 0 12px', fontSize: 14, color: '#b91c1c' }}>{listError}</p>
          ) : null}
          {deleteError ? (
            <p style={{ margin: '0 0 12px', fontSize: 14, color: '#b91c1c' }}>{deleteError}</p>
          ) : null}

          {historyLoading ? (
            <p style={{ fontSize: 14, color: '#64748b' }}>이력 불러오는 중…</p>
          ) : history.length === 0 ? (
            <div
              style={{
                padding: 18,
                border: `1px solid ${divider}`,
                background: '#f8fafc',
                fontSize: 14,
                color: '#475569',
                lineHeight: 1.55,
              }}
            >
              {listError ? (
                <p style={{ margin: '0 0 10px', color: '#b91c1c', fontWeight: 600 }}>{listError}</p>
              ) : null}
              {serverMeta ? (
                <p style={{ margin: '0 0 10px', fontSize: 13, color: '#64748b' }}>
                  서버가 조회한 DB 기준: <code style={{ fontSize: 12 }}>chart_pdf.parse_runs</code> 전체{' '}
                  <strong>{serverMeta.totalParseRuns}</strong>건 · 이번 응답 목록 최대 <strong>{serverMeta.limit}</strong>
                  건
                </p>
              ) : null}
              저장된 이력이 없습니다. Supabase 프로젝트에 데이터가 있는지,{' '}
              <code style={{ fontSize: 12 }}>NEXT_PUBLIC_SUPABASE_URL</code>·서비스 롤 키가 맞는지 확인해 주세요.{' '}
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                style={{
                  fontWeight: 700,
                  color: '#0f172a',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                차트 데이터 수집
              </button>
              에서 PDF를 올려 보세요.
            </div>
          ) : filteredHistory.length === 0 ? (
            <p style={{ fontSize: 14, color: '#64748b' }}>검색 조건에 맞는 이력이 없습니다. 왼쪽 검색어를 바꿔 보세요.</p>
          ) : selected ? (
            <div style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', minHeight: 0 }}>
              <AdminRunExtractionDetail
                runId={selected.id}
                embedded
                onDelete={() => void deleteRun(selected)}
                deleting={deletingId === selected.id}
              />
            </div>
          ) : (
            <p style={{ fontSize: 14, color: '#64748b' }}>왼쪽에서 항목을 선택해 주세요.</p>
          )}
        </div>
      </div>

      <dialog
        ref={uploadModalRef}
        onClose={() => setUploadModalOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setUploadModalOpen(false); }}
        style={{
          position: 'fixed',
          inset: 0,
          margin: 'auto',
          width: 'min(96vw, 720px)',
          maxHeight: '88vh',
          border: '1px solid rgba(15,23,42,0.15)',
          borderRadius: 8,
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '88vh', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${divider}`, flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>차트 데이터 수집</span>
            <button type="button" className="adminLegacySmallBtn" onClick={() => setUploadModalOpen(false)}>닫기</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {uploadModalOpen && <AdminDataUpload />}
          </div>
        </div>
      </dialog>
    </div>
  );
}
