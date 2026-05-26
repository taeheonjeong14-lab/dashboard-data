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

  // Fetch user profile from core.users
  // Note: core.users has both camelCase legacy columns and snake_case columns
  const { data: coreUser } = await supabase
    .schema('core')
    .from('users')
    .select('approved, emailVerified, email_verified, name, customHospitalName, custom_hospital_name, hospital_id')
    .eq('id', user.id)
    .single();

  const cu = coreUser as {
    approved?: boolean;
    emailVerified?: boolean;
    email_verified?: boolean;
    name?: string | null;
    customHospitalName?: string | null;
    custom_hospital_name?: string | null;
    hospital_id?: string | null;
  } | null;
  const isEmailVerified = cu?.emailVerified === true || cu?.email_verified === true;

  // hospital_name: prefer custom overrides, then fetch from core.hospitals via hospital_id
  let resolvedHospitalName: string | null =
    cu?.customHospitalName?.trim() || cu?.custom_hospital_name?.trim() || null;

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

  // 가입 흐름: ① 이메일 인증(emailVerified) → ② 관리자 승인(approved) 둘 다 만족해야 본문 진입.
  // whitelist 방식 — row 가 없거나(트리거/동기화 실패) 둘 중 하나가 true 가 아니면 차단.
  // 기존 fail-open(`cu && cu.approved === false`) 은 row 미존재 시 통과되어 미승인 사용자가 로그인되는 버그가 있었음.
  if (!cu || !isEmailVerified || cu.approved !== true) {
    const needsEmailVerification = !isEmailVerified;
    const pendingIcon = needsEmailVerification ? '📧' : '⏳';
    const pendingTitle = needsEmailVerification ? '이메일 인증을 완료해 주세요' : '승인 대기 중';
    const pendingBody = needsEmailVerification ? (
      <>
        가입 시 보낸 인증 메일의 링크를 클릭해 본인 인증을 완료해 주세요.
        <br />
        인증 후 관리자 승인이 완료되면 서비스를 이용할 수 있습니다.
      </>
    ) : (
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

  // 토큰 잔액 — 마이그레이션 전(컬럼 없음)에도 깨지지 않게 별도 방어적 조회
  let tokenBalance = 0;
  {
    const { data: tb } = await supabase
      .schema('core')
      .from('users')
      .select('token_balance')
      .eq('id', user.id)
      .single();
    const v = (tb as { token_balance?: number } | null)?.token_balance;
    if (typeof v === 'number') tokenBalance = v;
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
