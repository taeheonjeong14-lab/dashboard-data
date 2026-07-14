'use client';

/**
 * 문진·접수 콘솔 — '사전문진'과 '초진 접수' 두 메뉴를 한 화면으로 합친 것.
 * 병원 선택을 위로 올려 한 번만 고르면 두 탭이 같은 병원을 본다(예전엔 화면마다 따로 골라야 했다).
 * 목록/상세는 기존 두 컴포넌트를 embedded 모드로 그대로 재사용한다.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminIntake from '@/components/admin-intake';
import AdminPreConsultation from '@/components/admin-pre-consultation';
import { parseChartAdminHospitalsResponse, type ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';
import { PageHeader, Notice } from '@/components/ui/admin-ui';

const TABS = [
  { key: 'pre-consultation', label: '사전문진' },
  { key: 'intake', label: '초진 접수' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid var(--border)',
  overflowX: 'auto',
  marginBottom: 16,
};
function tabButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '9px 12px',
    fontSize: 14,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    marginBottom: -1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

export default function AdminFormsConsole() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabKey>(initTab === 'intake' ? 'intake' : 'pre-consultation');

  const [hospitals, setHospitals] = useState<ChartHospitalOption[]>([]);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/data/hospitals', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const list = parseChartAdminHospitalsResponse(d);
        setHospitals(list);
        setHospitalId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch(() => setError('병원 목록을 불러오지 못했습니다.'));
  }, []);

  // 탭을 URL 에 남겨 새로고침·뒤로가기에도 유지된다.
  const selectTab = useCallback((next: TabKey) => {
    setTab(next);
    router.replace(next === 'intake' ? '/admin/forms?tab=intake' : '/admin/forms', { scroll: false });
  }, [router]);

  const hospitalSelect = (
    <select
      value={hospitalId ?? ''}
      onChange={(e) => setHospitalId(e.target.value || null)}
      aria-label="병원 선택"
      style={{
        padding: '8px 10px', fontSize: 14, color: 'var(--text)', background: 'var(--bg)',
        border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none', cursor: 'pointer',
      }}
    >
      {hospitals.length === 0 ? <option value="">불러오는 중…</option> : null}
      {hospitals.map((h) => (
        <option key={h.id} value={h.id}>{h.name_ko}</option>
      ))}
    </select>
  );

  return (
    <div>
      <PageHeader
        title="문진·접수"
        description="병원을 고르고, 보호자가 제출한 사전문진과 초진 접수증을 확인합니다."
        actions={hospitalSelect}
      />

      {error ? <Notice danger>{error}</Notice> : null}

      <div style={tabBarStyle} className="adminUnderlineTabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="adminUnderlineTab"
            aria-selected={tab === t.key}
            onClick={() => selectTab(t.key)}
            style={tabButtonStyle(tab === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pre-consultation' ? (
        <AdminPreConsultation embedded hospitalId={hospitalId} />
      ) : (
        <AdminIntake embedded hospitalId={hospitalId} />
      )}
    </div>
  );
}
