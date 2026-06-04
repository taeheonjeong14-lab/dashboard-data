'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isHospitalUuid } from '@/lib/admin-stats/hospital-id';

const divider = 'var(--border)';

export type PerformanceHospitalRow = {
  id: string;
  name: string;
  address?: string | null;
  addressDetail?: string | null;
  address_detail?: string | null;
};

export const PerformanceHospitalContext = createContext<{
  hospitalId: string;
  selectedHospital: PerformanceHospitalRow | null;
  hospitals: PerformanceHospitalRow[];
} | null>(null);

export function usePerformanceHospitalContext() {
  return useContext(PerformanceHospitalContext);
}

const TABS = [
  { suffix: 'hospital', label: '경영 통계' },
  { suffix: 'blog', label: '네이버 블로그 통계' },
  { suffix: 'place', label: '네이버 플레이스 통계' },
  { suffix: 'ads', label: '네이버 광고 통계' },
] as const;

function hospitalHref(id: string, suffix: string) {
  return `/admin/performance/${id}/${suffix || 'hospital'}`;
}

function tabActive(pathname: string, hospitalId: string, suffix: string): boolean {
  return pathname.startsWith(`/admin/performance/${hospitalId}/${suffix}`);
}

function formatHospitalAddress(h: PerformanceHospitalRow): string {
  const main = (h.address ?? '').trim();
  const detail = (h.addressDetail ?? h.address_detail ?? '').trim();
  if (main && detail) return `${main} ${detail}`;
  return main || detail || '주소 미입력';
}

export default function AdminPerformanceHospitalLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const rawId = typeof params.hospitalId === 'string' ? params.hospitalId : '';
  const hospitalId = rawId.trim();
  const tabSuffix = pathname.split('/').slice(4).join('/') || '';

  const [hospitals, setHospitals] = useState<PerformanceHospitalRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadHospitals = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const r = await fetch('/api/admin/data/hospitals', { credentials: 'include' });
      const data = (await r.json()) as { hospitals?: PerformanceHospitalRow[]; error?: string };
      setHospitals(Array.isArray(data.hospitals) ? data.hospitals : []);
      if (data.error) setListError(data.error);
    } catch {
      setListError('병원 목록을 불러오지 못했습니다.');
      setHospitals([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHospitals();
  }, [loadHospitals]);

  const filteredHospitals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hospitals;
    return hospitals.filter((h) => {
      const hay = [h.id, h.name ?? '', formatHospitalAddress(h)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [hospitals, search]);

  const valid = isHospitalUuid(hospitalId);

  const selectedHospital = useMemo(
    () => hospitals.find((h) => h.id === hospitalId) ?? null,
    [hospitals, hospitalId],
  );

  const ctx = useMemo(() => {
    if (!valid) return null;
    return { hospitalId, selectedHospital, hospitals };
  }, [valid, hospitalId, selectedHospital, hospitals]);

  if (!valid) {
    return (
      <div className="adminLayout2WithMain">
        <aside className="adminLayoutSecondaryRail" aria-label="병원 목록">
          <div className="adminRailToolbar">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="병원 검색"
              aria-label="병원 검색"
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
              disabled={listLoading}
            />
          </div>
          <div style={{ maxHeight: 'min(66vh, calc(100vh - 220px))', overflow: 'auto' }}>
            {listError ? (
              <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--danger)' }}>{listError}</p>
            ) : filteredHospitals.length === 0 ? (
              <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                {hospitals.length === 0 ? '등록된 병원이 없습니다.' : '검색 결과 없음'}
              </p>
            ) : (
              filteredHospitals.map((h) => (
                <Link
                  key={h.id}
                  href={hospitalHref(h.id, tabSuffix)}
                  className={`adminRailRow${h.id === hospitalId ? ' adminRailRowActive' : ''}`}
                  style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                >
                  <span style={{ display: 'block', fontWeight: 700, color: 'inherit' }}>
                    {h.name?.trim() || '(이름 없음)'}
                  </span>
                  <span className="adminRailSub">{formatHospitalAddress(h)}</span>
                </Link>
              ))
            )}
          </div>
        </aside>
        <div className="adminLayoutMainPane">
          <div className="adminLayoutMainColumnInset">
            <p className="adminLegacyStatus" style={{ color: 'var(--danger)' }}>
              유효하지 않은 병원 ID입니다. 왼쪽에서 병원을 선택하세요.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PerformanceHospitalContext.Provider value={ctx}>
      <div className="adminLayout2WithMain">
        <aside className="adminLayoutSecondaryRail" aria-label="병원 목록">
          <div className="adminRailToolbar">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="병원 검색"
              aria-label="병원 검색"
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
              disabled={listLoading}
            />
          </div>
          <div style={{ maxHeight: 'min(66vh, calc(100vh - 220px))', overflow: 'auto' }}>
            {listError ? (
              <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--danger)' }}>{listError}</p>
            ) : filteredHospitals.length === 0 ? (
              <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                {hospitals.length === 0 ? '등록된 병원이 없습니다.' : '검색 결과 없음'}
              </p>
            ) : (
              filteredHospitals.map((h) => {
                const active = h.id === hospitalId;
                return (
                  <Link
                    key={h.id}
                    href={hospitalHref(h.id, tabSuffix)}
                    className={`adminRailRow${active ? ' adminRailRowActive' : ''}`}
                    style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                  >
                    <span style={{ display: 'block', fontWeight: 700, color: 'inherit' }}>
                      {h.name?.trim() || '(이름 없음)'}
                    </span>
                    <span className="adminRailSub">{formatHospitalAddress(h)}</span>
                  </Link>
                );
              })
            )}
          </div>
        </aside>

        <div className="adminLayoutMainPane">
          <div className="adminLayoutMainColumnInset">
            <nav
              aria-label="통계 탭"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginBottom: 0,
                paddingBottom: 10,
                borderBottom: `1px solid ${divider}`,
              }}
            >
              {TABS.map((tab) => {
                const href = hospitalHref(hospitalId, tab.suffix);
                const active = tabActive(pathname, hospitalId, tab.suffix);
                return (
                  <Link
                    key={tab.suffix || 'home'}
                    href={href}
                    style={{
                      fontSize: 13,
                      fontWeight: active ? 800 : 600,
                      color: active ? 'var(--text)' : 'var(--text-muted)',
                      textDecoration: 'none',
                      padding: '8px 12px',
                      borderRadius: 0,
                      background: active ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    }}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>

            <div
              className="adminStatsTheme"
              style={{
                padding: '0 0 28px',
                minHeight: '56vh',
                boxSizing: 'border-box',
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </PerformanceHospitalContext.Provider>
  );
}
