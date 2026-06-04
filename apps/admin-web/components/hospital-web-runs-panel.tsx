'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HospitalWebRunItem } from '@/lib/hospital-web-runs';

const divider = 'var(--border)';
const AUTO_REFRESH_MS = 5 * 60 * 1000;

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
    return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
      .replace(/\. /g, '-').replace('.', '').trim();
  } catch {
    return '';
  }
}

export function HospitalWebRunsPanel() {
  const [items, setItems] = useState<HospitalWebRunItem[]>([]);
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
      const res = await fetch('/api/admin/data/hospital-runs?limit=60', { credentials: 'include' });
      const data = (await res.json()) as { items?: HospitalWebRunItem[]; error?: string };
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
            병원 접수
            {!loading && items.length > 0 && (
              <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>
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
              onClick={() => { setFilterHospital(''); setFilterDate(''); }}
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
          <p style={{ margin: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>불러오는 중…</p>
        ) : error ? (
          <p style={{ margin: '12px 14px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>
        ) : filteredItems.length === 0 ? (
          <p style={{ margin: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
            {items.length === 0 ? '접수된 차트가 없습니다.' : '필터 결과가 없습니다.'}
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
                    fontSize: 12,
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
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {formatDateShort(item.createdAt)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  {[item.patientName?.trim(), item.ownerName?.trim()]
                    .filter(Boolean)
                    .join(' · ') || item.friendlyId || '—'}
                </span>
                {item.imageCount > 0 && (
                  <span
                    style={{
                      background: 'var(--accent-subtle)',
                      color: 'var(--accent)',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    이미지 {item.imageCount}
                  </span>
                )}
                {item.emphasisText && (
                  <span
                    style={{
                      background: 'var(--warning-subtle)',
                      color: 'var(--warning)',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    강조사항
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
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: 'var(--text)' }}>
            {selected.hospitalName?.trim() || selected.hospitalId || '—'}
          </div>
          {selected.patientName && (
            <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>환자: {selected.patientName}</div>
          )}
          {selected.ownerName && (
            <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>보호자: {selected.ownerName}</div>
          )}
          {selected.friendlyId && (
            <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>기록번호: {selected.friendlyId}</div>
          )}
          {selected.emphasisText && (
            <div
              style={{
                background: 'var(--warning-subtle)',
                border: '1px solid var(--warning-subtle)',
                borderRadius: 4,
                padding: '6px 8px',
                color: 'var(--warning)',
                marginBottom: 6,
                lineHeight: 1.5,
              }}
            >
              {selected.emphasisText}
            </div>
          )}
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <a
              href={`/admin/chart-data`}
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              차트 목록에서 보기 →
            </a>
            <span style={{ color: 'var(--border-strong)' }}>|</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10.5, fontFamily: 'monospace' }}>
              {selected.id.slice(0, 8)}…
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
