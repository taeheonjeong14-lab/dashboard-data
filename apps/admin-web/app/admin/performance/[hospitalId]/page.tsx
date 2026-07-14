import { redirect } from 'next/navigation';

export default async function AdminPerformanceHospitalRoot({
  params,
}: {
  params: Promise<{ hospitalId: string }>;
}) {
  const { hospitalId } = await params;
  redirect(`/admin/performance/${hospitalId}/sales`);
}
