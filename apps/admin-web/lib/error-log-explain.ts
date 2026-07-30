/**
 * 에러 로그 한 줄 설명. 개발자가 아닌 사람이 "무슨 일이 났는지" 알 수 있게 한다.
 *
 * DB 에 저장하지 않고 조회 시점에 만든다 — 규칙을 고치면 이미 쌓인 로그에도 바로 반영된다.
 * 기술적 원인은 message/stack 이 이미 갖고 있으니, 여기서는 "사용자에게 무엇이 실패했나"만 말한다.
 */

export type ExplainInput = {
  source: 'server' | 'client' | 'worker';
  feature: string | null;
  route: string | null;
  status_code: number | null;
  message: string;
};

/**
 * 메시지에서 디버그 포트를 뽑는다. 순위 수집은 병원별/용도별로 포트가 달라(7000~7012, 9222, 9223)
 * "어느 포트가 문제였나"가 곧 조치 대상이다. 못 찾으면 null.
 */
function debugPortOf(message: string): string | null {
  const m =
    /remote-debugging-port=(\d{2,5})/.exec(message) ??
    /127\.0\.0\.1:(\d{2,5})/.exec(message) ??
    /localhost:(\d{2,5})/.exec(message);
  return m ? m[1] : null;
}

/**
 * 메시지 본문에서 원인 유형을 추린다. 위에서부터 먼저 맞는 것을 쓴다.
 *
 * 두 번째 요소가 함수면 매치 결과로 문구를 만든다(포트 번호처럼 값을 넣어야 하는 경우).
 * **수집(워커) 규칙을 맨 위에 둔다** — 아래 일반 규칙이 더 넓어서(예: ECONNREFUSED →
 * "외부 서비스에 연결하지 못했습니다") 먼저 걸리면 정작 필요한 "어느 포트의 Chrome이 죽었나"가
 * 묻혀 버린다. 그게 지금까지 수집 실패 원인을 못 짚던 이유다.
 */
type CauseRule = [RegExp, string | ((message: string) => string)];

const CAUSE_RULES: Array<CauseRule> = [
  // ── 수집 워커 ────────────────────────────────────────────────
  [
    /디버깅 Chrome\(CDP\) 연결 실패|connect_over_cdp|CDP 연결 재시도/i,
    (msg) => {
      const port = debugPortOf(msg);
      const where = port ? `디버그 Chrome(포트 ${port})` : '디버그 Chrome';
      return `${where}에 연결하지 못했습니다. 그 포트의 Chrome이 꺼져 있거나, 오래 켜져 있어 응답하지 않는 상태입니다. 워커 머신에서 해당 Chrome을 재시작하세요`;
    },
  ],
  [
    /순위를 한 건도 수집하지 못했습니다/,
    '네이버 순위를 한 건도 수집하지 못했습니다. 디버그 Chrome 연결 실패·타임아웃·네이버 차단 중 하나입니다',
  ],
  [
    /Target closed|browser has been closed|Protocol error|Target page.*closed/i,
    '수집 중 브라우저 세션이 끊겼습니다. Chrome이 도중에 닫혔거나 응답을 멈췄습니다',
  ],
  [/캡차|captcha|비정상적인 접근|접근이 차단/i, '네이버가 접근을 차단한 것으로 보입니다'],
  [
    /진행이 없어 워커 중단|고아 잡/,
    '수집 도중 워커가 멈춰 작업이 자동 회수됐습니다. 워커 프로세스가 죽었거나 머신이 재부팅됐을 수 있습니다',
  ],
  [
    /종료 코드 \d+\.\s*(콘솔 출력|로그 파일)/,
    '수집 스크립트가 비정상 종료했지만 사유가 출력에 남지 않았습니다. 수집 이력의 전체 로그를 확인하세요',
  ],
  [
    /OAuthException|access token|Error validating access token|토큰이 만료/i,
    '외부 서비스(Meta 등) 액세스 토큰이 만료되었거나 유효하지 않습니다. 토큰을 갱신하세요',
  ],

  // ── 웹(기존) ────────────────────────────────────────────────
  [/너무 깁니다|페이지까지만/i, 'PDF 페이지 수가 한도를 넘었습니다'],
  [/용량 초과|파일 크기|너무 큽니다/i, '파일 용량이 한도를 넘었습니다'],
  [/timeout|timed out|ETIMEDOUT|시간 초과/i, '처리 시간이 초과됐습니다'],
  [/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up|network/i, '외부 서비스에 연결하지 못했습니다'],
  [/unauthorized|not authenticated|401/i, '로그인이 풀렸거나 인증되지 않았습니다'],
  [/forbidden|permission|not allowed|403/i, '권한이 없습니다'],
  [/not found|does not exist|404/i, '대상을 찾지 못했습니다'],
  [/duplicate key|already exists|unique constraint/i, '이미 등록된 데이터와 충돌했습니다'],
  // 저장소 규칙이 DB 규칙보다 먼저다. "Supabase storage download failed" 는 DB 가 아니라 파일 문제인데,
  // 'supabase' 가 DB 규칙에 먼저 걸려 엉뚱한 설명이 나갔다.
  // 'bucket' 은 쓰지 않는다 — chart-api 의 "Text bucket pipeline failed" 이 오검출된다(버켓팅 ≠ 저장소).
  [/storage|저장소/i, '파일 저장소 처리에 실패했습니다'],
  [/violates|constraint|PGRST|supabase|database/i, '데이터베이스에 저장하지 못했습니다'],
  [/unexpected token|JSON|parse|malformed|invalid format/i, '데이터 형식이 올바르지 않습니다'],
  [/토큰|token_balance|잔액|insufficient/i, '토큰 잔액이 부족하거나 차감에 실패했습니다'],
  [/quota|rate limit|429/i, '요청 한도를 초과했습니다'],
  [/payload too large|413|file size/i, '파일 또는 요청이 너무 큽니다'],
];

function causeOf(message: string): string | null {
  for (const [re, text] of CAUSE_RULES) {
    if (!re.test(message)) continue;
    return typeof text === 'function' ? text(message) : text;
  }
  return null;
}

/**
 * 사유만 뽑는다(주체 문장 없이). 텔레그램 다이제스트처럼 app·route 를 이미 한 줄로 보여주는
 * 곳에서 explainError() 를 쓰면 "자동으로 도는 '...' 작업이 실패했습니다" 가 헤더와 겹친다.
 * 매칭되는 규칙이 없으면 null — 호출부가 원문으로 폴백한다(정보를 잃지 않게).
 */
export function errorCauseOf(message: string): string | null {
  return causeOf(message);
}

/** 기능명이 없을 때 경로에서 대충이라도 사람말 이름을 만든다. */
function subjectOf(input: ExplainInput): string {
  if (input.feature) return `'${input.feature}'`;
  if (input.route) return `'${input.route}'`;
  return '알 수 없는 작업';
}

export function explainError(input: ExplainInput): string {
  const cause = causeOf(input.message);

  // 크론은 사용자 행동이 아니다. "사용자가 하다 실패" 로 쓰면 거짓말이 된다.
  if (input.route?.startsWith('/api/cron/')) {
    const subject = input.feature ? `'${input.feature}'` : `'${input.route}'`;
    return cause
      ? `자동 실행되는 ${subject} 작업이 실패했습니다 — ${cause}.`
      : `자동 실행되는 ${subject} 작업이 서버 오류로 실패했습니다.`;
  }

  // 수집 워커도 사용자 행동이 아니다(크론과 같은 이유) — 별도 머신에서 스스로 도는 배치다.
  // "병원 사용자가 하다 실패" 로 쓰면 거짓말이 된다.
  if (input.source === 'worker') {
    const subject = subjectOf(input);
    return cause
      ? `자동으로 도는 ${subject} 작업이 실패했습니다 — ${cause}.`
      : `자동으로 도는 ${subject} 작업이 실패했습니다.`;
  }

  if (input.source === 'client') {
    const where = input.route ? `'${input.route}' 화면` : '병원 화면';
    return cause
      ? `병원 사용자가 ${where}을 보다가 오류 화면을 만났습니다 — ${cause}.`
      : `병원 사용자가 ${where}을 보다가 오류 화면을 만났습니다.`;
  }

  const subject = subjectOf(input);
  if (cause) return `병원 사용자가 ${subject} 작업을 하다 실패했습니다 — ${cause}.`;

  // 4xx 는 서버가 고장난 게 아니라 요청이 거부된 것이다. '서버 오류' 라고 쓰면 원인을 오도한다.
  // (408 타임아웃·429 한도는 위 CAUSE_RULES 에서 이미 걸러진다.)
  const s = input.status_code;
  if (s && s >= 400 && s < 500) {
    return `병원 사용자가 ${subject} 작업을 시도했으나 요청이 거부됐습니다 (HTTP ${s}).`;
  }
  return `병원 사용자가 ${subject} 작업을 하다 서버 오류로 실패했습니다.`;
}
