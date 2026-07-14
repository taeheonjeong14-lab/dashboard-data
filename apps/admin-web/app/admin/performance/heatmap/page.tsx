import AdminStatsOverview from '@/components/admin-stats-overview';

export const dynamic = 'force-dynamic';

export default function AdminHeatmapPage() {
  return (
    <div className="adminMainSingleGutter">
      <AdminStatsOverview />
    </div>
  );
}
