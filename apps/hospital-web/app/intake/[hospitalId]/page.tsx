import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { IntakeWizard } from './intake-wizard';

export const dynamic = 'force-dynamic';

export default async function IntakePage({
  params,
}: {
  params: Promise<{ hospitalId: string }>;
}) {
  const { hospitalId } = await params;

  let hospitalName = '';
  let brandColor: string | null = null;
  try {
    const svc = createServiceRoleClient();
    const { data } = await svc
      .schema('core')
      .from('hospitals')
      .select('name, brandColor')
      .eq('id', hospitalId)
      .maybeSingle();
    const row = data as { name?: string | null; brandColor?: string | null } | null;
    hospitalName = row?.name?.trim() ?? '';
    brandColor = row?.brandColor?.trim() || null;
  } catch {
    // service role 미설정 등 — 아래에서 안내 처리
  }

  if (!hospitalName) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#ffffff' }}>
        <p style={{ textAlign: 'center', maxWidth: 360, fontSize: 15, color: '#71717a', lineHeight: 1.7, margin: 0 }}>
          유효하지 않은 접수 링크입니다.<br />병원에 문의해 주세요.
        </p>
      </div>
    );
  }

  return <IntakeWizard hospitalId={hospitalId} hospitalName={hospitalName} accent={brandColor} />;
}
