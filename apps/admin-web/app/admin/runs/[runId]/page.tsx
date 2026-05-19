import { AdminRunExtractionDetail } from '@/components/admin-run-extraction-detail';

export default async function AdminRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <div className="adminMainSingleGutter">
      <AdminRunExtractionDetail runId={runId} embedded={false} />
    </div>
  );
}
