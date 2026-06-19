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
    .select('approved, name, customHospitalName, hospital_id, hospital_role, staff_approved, emailVerified')
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
    hospital_role?: string | null;
    staff_approved?: boolean | null;
    emailVerified?: boolean | null;
  } | null;

  // 이용 가능 조건.
  //  - 신규 흐름(hospital_role 있음): 이메일 인증 완료 AND (마스터=approved / 스태프=staff_approved)
  //  - 레거시(role 없음): 기존대로 approved 만 (이메일 인증 미적용 운영자 보호)
  const canUse = !!cu && (
    cu.hospital_role
      ? (cu.emailVerified === true && (cu.hospital_role === 'master' ? cu.approved === true : cu.staff_approved === true))
      : cu.approved === true
  );

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
  if (!canUse) {
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

  // 마스터 최초 로그인 온보딩 미완료 → 온보딩 설문으로 보냄 (/onboarding 은 (app) 밖이라 루프 없음)
  // redirect() 는 내부적으로 throw 하므로 try/catch 밖에서 호출한다.
  let masterNeedsOnboarding = false;
  if (cu?.hospital_role === 'master' && cu?.hospital_id) {
    try {
      const srvc = createServiceRoleClient();
      const { data: ob } = await srvc
        .schema('core')
        .from('hospitals')
        .select('onboarding_done')
        .eq('id', cu.hospital_id)
        .single();
      masterNeedsOnboarding = (ob as { onboarding_done?: boolean } | null)?.onboarding_done !== true;
    } catch {
      masterNeedsOnboarding = false; // 컬럼 미존재 등 → 막지 않음
    }
  }
  if (masterNeedsOnboarding) redirect('/onboarding');

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
      isStaff={cu?.hospital_role === 'staff'}
    >
      {children}
    </HospitalShell>
  );
}
