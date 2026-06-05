import { Suspense } from 'react';
import AdminDataUpload from '@/components/admin-data-upload';
import { HospitalWebRunsPanel } from '@/components/hospital-web-runs-panel';
import { HospitalStatsSubmissionsPanel } from '@/components/hospital-stats-submissions-panel';

export default async function AdminDataUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  const showPdfPanel = !section || section === 'pdf';
  const showStatsPanel = section === 'stats';

  const upload = (
    <Suspense fallback={<p style={{ padding: 16, color: '#64748b', fontSize: 14 }}>불러오는 중…</p>}>
      <AdminDataUpload />
    </Suspense>
  );

  const panelStyle = {
    borderRight: '1px solid rgba(15,23,42,0.1)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
  };

  const splitLayout = (panel: React.ReactNode) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        height: 'calc(100vh - 60px)',
        overflow: 'hidden',
      }}
    >
      <div style={panelStyle}>{panel}</div>
      <div style={{ overflowY: 'auto' }}>{upload}</div>
    </div>
  );

  return showPdfPanel
    ? splitLayout(<HospitalWebRunsPanel />)
    : showStatsPanel
      ? splitLayout(<HospitalStatsSubmissionsPanel />)
      : upload;
}
