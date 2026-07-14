'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HospitalStatsSubmissionItem } from '@/lib/hospital-stats-submissions';

const divider = 'var(--border)';
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const CHART_TYPE_LABELS: Record<string, string> = {
  intovet: 'IntoVet',
  woorien_pms: '우리엔',
  efriends: 'eFriends',
};

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

function toKstDateString(iso: string): string {
  try {
    const d = new Date(iso);
    return d
      .toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
      .replace(/\. /g, '-')
      .replace('.', '')
      .trim();
  } catch {
    return '';
  }
}

export function HospitalStatsSubmissionsPanel() {
  const [items, setItems] = useState<HospitalStatsSubmissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterHospital, setFilterHospital] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/data/hospital-stats-submissions?limit=60', {
        credentials: 'include',
      });
      const data = (await res.json()) as { items?: HospitalStatsSubmissionItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '불러오기 실패');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(true), AUTO_REFRESH_MS);
    return () => {
      if (timerRef.current != null) clearInterval(timerRef.current);
    };
  }, [load]);

  const filteredItems = items.filter((item) => {
    if (filterHospital) {
      const haystack = (item.hospitalName ?? item.hospitalId ?? '').toLowerCase();
      if (!haystack.includes(filterHospital.toLowerCase())) return false;
    }
    if (filterDate) {
      if (!toKstDateString(item.createdAt).startsWith(filterDate)) return false;
    }
    return true;
  });

  const selected = filteredItems.find((i) => i.id === selectedId) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 헤더 */}
      <div
        style={{
          padding: '12px 14px 10px',
          borderBottom: `1px solid ${divider}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            병원 제출 내역
            {!loading && items.length > 0 && (
              <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 13, color: 'var(--text-muted)' }}>
                {filteredItems.length !== items.length
                  ? `${filteredItems.length} / ${items.length}건`
                  : `${items.length}건`}
              </span>
            )}
          </span>
          {loading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>불러오는 중…</span>}
        </div>

        {/* 필터 */}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            placeholder="병원명"
            value={filterHospital}
            onChange={(e) => setFilterHospital(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 11,
              padding: '4px 7px',
              border: `1px solid ${divider}`,
              borderRadius: 4,
              outline: 'none',
              color: 'var(--text)',
              background: '#fff',
            }}
          />
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            style={{
              fontSize: 11,
              padding: '4px 6px',
              border: `1px solid ${divider}`,
              borderRadius: 4,
              outline: 'none',
              color: filterDate ? 'var(--text)' : 'var(--text-muted)',
              background: '#fff',
              width: 120,
            }}
          />
          {(filterHospital || filterDate) && (
            <button
              type="button"
              onClick={() => {
                setFilterHospital('');
                setFilterDate('');
              }}
              style={{
                background: 'none',
                border: `1px solid ${divider}`,
                borderRadius: 4,
                padding: '3px 7px',
                fontSize: 11,
                cursor: 'pointer',
                color: 'var(--text-muted)',
                flexShrink: 0,
              }}
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {/* 목록 */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading ? (
          <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>
        ) : error ? (
          <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--danger)' }}>{error}</p>
        ) : filteredItems.length === 0 ? (
          <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--text-muted)' }}>
            {items.length === 0 ? '제출된 데이터가 없습니다.' : '필터 결과가 없습니다.'}
          </p>
        ) : (
          filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId((cur) => (cur === item.id ? null : item.id))}
              style={{
                width: '100%',
                textAlign: 'left',
                background: selectedId === item.id ? 'var(--accent-subtle)' : 'transparent',
                border: 'none',
                borderBottom: `1px solid ${divider}`,
                padding: '9px 14px',
                cursor: 'pointer',
                display: 'block',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 6,
                  marginBottom: 3,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text)',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.hospitalName?.trim() || item.hospitalId || '—'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {formatDateShort(item.createdAt)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    background: 'var(--accent-subtle)',
                    color: 'var(--accent)',
                    borderRadius: 3,
                    padding: '1px 5px',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {CHART_TYPE_LABELS[item.chartType] ?? item.chartType}
                </span>
                <span>{item.rowCount.toLocaleString()}건</span>
                {item.dateFrom && item.dateTo && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {item.dateFrom} ~ {item.dateTo}
                  </span>
                )}
                {item.status === 'error' && (
                  <span
                    style={{
                      background: 'var(--danger-subtle)',
                      color: 'var(--danger)',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    오류
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* 선택된 항목 상세 */}
      {selected && (
        <div
          style={{
            borderTop: `1px solid ${divider}`,
            padding: '12px 14px',
            background: 'var(--bg-subtle)',
            flexShrink: 0,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: 'var(--text)' }}>
            {selected.hospitalName?.trim() || selected.hospitalId || '—'}
          </div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
            차트: {CHART_TYPE_LABELS[selected.chartType] ?? selected.chartType}
          </div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>파일: {selected.fileName}</div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
            처리: {selected.rowCount.toLocaleString()}건
          </div>
          {selected.dateFrom && selected.dateTo && (
            <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
              기간: {selected.dateFrom} ~ {selected.dateTo}
            </div>
          )}
          {selected.errorMessage && (
            <div
              style={{
                background: 'var(--danger-subtle)',
                border: '1px solid rgba(185,28,28,0.2)',
                borderRadius: 4,
                padding: '6px 8px',
                color: 'var(--danger)',
                marginTop: 6,
                lineHeight: 1.5,
                wordBreak: 'break-all',
              }}
            >
              {selected.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
