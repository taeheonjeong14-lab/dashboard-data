const ROUTES: { method: string; path: string; note: string }[] = [
  { method: 'GET', path: '/api/auth/verify-email', note: '이메일 인증 링크' },
  { method: 'POST', path: '/api/auth/send-verify-email', note: '인증 메일' },
  { method: 'GET', path: '/api/auth/check-email', note: '이메일 중복 등' },
  { method: 'POST', path: '/api/users/profile', note: '프로필' },
  { method: 'GET,POST', path: '/api/hospitals', note: '병원 목록/등록' },
  { method: 'GET,PATCH', path: '/api/hospitals/me', note: '현재 유저·소속 병원' },
  { method: 'GET', path: '/api/hospitals/me/webhook-url', note: 'Tally 웹훅 URL' },
  { method: 'GET', path: '/api/pre-consultations', note: '사전문진 목록' },
  { method: 'GET,PATCH,POST', path: '/api/pre-consultations/[id]', note: '사전문진 단건' },
  { method: 'POST', path: '/api/pre-consultation-questions', note: '사전문진 질문 생성' },
  { method: 'GET,POST', path: '/api/tally-webhook', note: 'Tally 웹훅 (?hospitalId=)' },
  { method: 'GET,POST', path: '/api/survey', note: '공개 설문' },
  { method: 'GET,POST', path: '/api/surveys/sessions', note: '설문 세션' },
  { method: 'GET,POST', path: '/api/surveys/sessions/[id]', note: '설문 세션 단건' },
  { method: 'POST', path: '/api/surveys/generate-questions', note: '설문 질문 AI' },
  { method: 'POST,PATCH,GET,DELETE', path: '/api/consultations', note: '문진 CRUD' },
  { method: 'POST', path: '/api/questions', note: '문진 질문 생성' },
  { method: 'POST', path: '/api/cc', note: 'CC 요약' },
  { method: 'POST', path: '/api/summarize', note: '차트 요약' },
  { method: 'POST', path: '/api/ddx', note: 'DDx 후보' },
  { method: 'POST', path: '/api/followup-questions', note: '추가 질문' },
  { method: 'POST', path: '/api/realtime-questions', note: '실시간 질문' },
  { method: 'POST', path: '/api/transcribe', note: '음성→텍스트' },
  { method: 'GET', path: '/api/admin/check', note: '관리자 여부' },
  { method: 'GET', path: '/api/admin/users', note: '유저 목록' },
  { method: 'GET', path: '/api/admin/users/pending', note: '승인 대기' },
  { method: 'POST', path: '/api/admin/users/approve', note: '승인' },
  { method: 'POST', path: '/api/admin/users/reject', note: '거절' },
  { method: 'PATCH', path: '/api/admin/users/[id]', note: '유저 수정' },
  { method: 'POST', path: '/api/admin/users/[id]/delete', note: '유저 삭제' },
  { method: 'GET,POST', path: '/api/admin/hospitals', note: '관리자 병원' },
  { method: 'PATCH', path: '/api/admin/hospitals/[id]', note: '병원 수정' },
  { method: 'POST', path: '/api/admin/hospitals/[id]/logo', note: '로고 업로드' },
  { method: 'GET,POST', path: '/api/admin/surveys/sessions', note: '관리자 설문' },
  { method: 'GET', path: '/api/admin/surveys/sessions/[id]', note: '설문 단건' },
  { method: 'GET', path: '/api/cron/refresh-pet-age', note: '크론 (CRON_SECRET)' },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>ddx-api (BFF)</h1>
      <p>
        이 주소는 <strong>HTTP API 서버</strong>입니다. 루트(/)에는 스펙 문서 대신 아래 <strong>경로·메서드 목록</strong>만 둡니다.
      </p>
      <p>
        요청/응답 JSON 형식·환경 변수는 DDx 레포 <code>docs/BACKEND_HANDOFF.md</code> 와 동일한 계약을 따릅니다. 별도 OpenAPI(Swagger) 파일은 없습니다.
      </p>
      <h2 style={{ marginTop: 32 }}>엔드포인트 요약</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>Method</th>
            <th style={{ padding: 8 }}>Path</th>
            <th style={{ padding: 8 }}>비고</th>
          </tr>
        </thead>
        <tbody>
          {ROUTES.map((r) => (
            <tr key={r.path + r.method} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{r.method}</td>
              <td style={{ padding: 8 }}>
                <code>{r.path}</code>
              </td>
              <td style={{ padding: 8 }}>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
