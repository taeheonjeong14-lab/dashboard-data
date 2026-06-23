import { redirect } from 'next/navigation';

// 사전문진 진입 페이지.
// 카카오 알림톡 사전문진 버튼이 고정 링크(.../survey)로 등록돼, 토큰을 ?token= 쿼리로 받는다.
// 토큰이 있으면 기존 /survey/[token] 페이지로 넘긴다.
export default async function SurveyEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.token) ? sp.token[0] : sp.token;
  const token = (raw ?? '').trim();
  if (token) redirect(`/survey/${encodeURIComponent(token)}`);

  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div>
        <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>사전문진 링크가 올바르지 않습니다.</p>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>병원에서 받은 알림톡의 버튼으로 다시 접속해 주세요.</p>
      </div>
    </main>
  );
}
