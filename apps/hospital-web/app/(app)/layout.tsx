import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { HospitalShell } from '@/components/shell/hospital-shell';
import type { ReactNode } from 'react';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // core.users 컬럼명은 prisma schema 기준 camelCase(approved/customHospitalName) + snake_case(hospital_id).
  // emailVerified 가드는 임시 제거 — 기존 운영자 row 들이 false/null 상태라 신규 가드가 본인까지 막는 회귀가 있었음.
  // 이메일 인증 강제는 운영자 row 일괄 업데이트(혹은 verify-email 흐름 완성) 후 다시 추가.
  const { data: coreUser, error: coreUserErr } = await supabase
    .schema('core')
    .from('users')
    .select('approved, name, customHospitalName, hospital_id')
    .eq('id', user.id)
    .single();
  if (coreUserErr) {
    console.warn('[hospital-web layout] core.users select error:', coreUserErr.message);
  }

  const cu = coreUser as {
    approved?: boolean;
    name?: string | null;
    customHospitalName?: string | null;
    hospital_id?: string | null;
  } | null;

  // hospital_name: prefer custom overrides, then fetch from core.hospitals via hospital_id
  let resolvedHospitalName: string | null = cu?.customHospitalName?.trim() || null;

  if (!resolvedHospitalName && cu?.hospital_id) {
    try {
      const srvc = createServiceRoleClient();
      const { data: hospital } = await srvc
        .schema('core')
        .from('hospitals')
        .select('name')
        .eq('id', cu.hospital_id)
        .single();
      resolvedHospitalName =
        (hospital as { name?: string | null } | null)?.name?.trim() || null;
    } catch {
      // service role key not configured — skip hospital name lookup
    }
  }

  // 승인 가드 — whitelist 방식. row 가 없거나(트리거/동기화 실패) approved !== true 면 차단.
  // 기존 fail-open(`cu && cu.approved === false`) 은 row 미존재 시 통과되어 미승인 사용자가 로그인되는 버그가 있었음.
  if (!cu || cu.approved !== true) {
    const pendingIcon = '⏳';
    const pendingTitle = '승인 대기 중';
    const pendingBody = (
      <>
        관리자 승인 후 서비스를 이용할 수 있습니다.
        <br />
        승인 완료 시 가입하신 이메일로 안내드립니다.
      </>
    );
    return (
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-subtle)',
          padding: '16px',
        }}
      >
        <div
          style={{
            maxWidth: '420px',
            width: '100%',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '40px 32px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>{pendingIcon}</div>
          <h1
            style={{
              margin: '0 0 12px',
              fontSize: '17px',
              fontWeight: 700,
              color: 'var(--text)',
            }}
          >
            {pendingTitle}
          </h1>
          <p
            style={{
              margin: '0 0 20px',
              fontSize: '14px',
              color: 'var(--text-secondary)',
              lineHeight: 1.7,
            }}
          >
            {pendingBody}
          </p>
          <a
            href="/auth/signout"
            style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              textDecoration: 'underline',
            }}
          >
            로그아웃
          </a>
        </div>
      </div>
    );
  }

  const userName =
    cu?.name?.trim() ||
    (user.user_metadata?.name as string | undefined)?.trim() ||
    user.email ||
    null;
  const hospitalName =
    resolvedHospitalName ||
    (user.user_metadata?.hospital_name as string | undefined)?.trim() ||
    null;

  // 토큰 잔액 — 병원 단위(core.hospitals.token_balance). 과금은 병원 잔액에서 차감되므로 여기를 본다.
  // (옛 core.users.token_balance 아님) 마이그레이션 전/권한 없음이면 0.
  let tokenBalance = 0;
  if (cu?.hospital_id) {
    try {
      const srvc = createServiceRoleClient();
      const { data: hb } = await srvc
        .schema('core')
        .from('hospitals')
        .select('token_balance')
        .eq('id', cu.hospital_id)
        .single();
      const v = (hb as { token_balance?: number | string | null } | null)?.token_balance;
      if (v != null) tokenBalance = Number(v) || 0;
    } catch {
      /* 미설정/권한 등 → 0 */
    }
  }

  return (
    <HospitalShell
      userName={userName}
      hospitalName={hospitalName}
      tokenBalance={tokenBalance}
      userId={user.id}
      hospitalId={cu?.hospital_id ?? null}
    >
      {children}
    </HospitalShell>
  );
}
