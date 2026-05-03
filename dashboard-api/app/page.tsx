/** 라우트 추가 시 여기 목록도 갱신 (루트는 경로·메서드 스펙만 표시). */

const ROUTES: { method: string; path: string; note: string }[] = [
  { method: 'GET', path: '/api/health', note: '동작 확인' },
  { method: 'GET', path: '/api/blog/preview?url=', note: '블로그 HTML 메타 파싱 (네이버 등)' },
  { method: 'GET', path: '/api/blog/preview-image?url=', note: '이미지 프록시' },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>dashboard-api</h1>
      <p>
        <strong>dashboard-ui</strong> 전용 BFF. 문진·가입·병원 관리 등은 <strong>ddx-api</strong>와 경로
        중복 금지.
      </p>
      <h2 style={{ marginTop: 24, fontSize: '1.1rem' }}>경로</h2>
      <ul style={{ paddingLeft: 20 }}>
        {ROUTES.map((r) => (
          <li key={`${r.method}-${r.path}`}>
            <code>{r.method}</code> <code>{r.path}</code> — {r.note}
          </li>
        ))}
      </ul>
    </main>
  );
}
