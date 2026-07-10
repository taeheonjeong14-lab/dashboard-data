/**
 * 에러 로그 한 줄 설명. 개발자가 아닌 사람이 "무슨 일이 났는지" 알 수 있게 한다.
 *
 * DB 에 저장하지 않고 조회 시점에 만든다 — 규칙을 고치면 이미 쌓인 로그에도 바로 반영된다.
 * 기술적 원인은 message/stack 이 이미 갖고 있으니, 여기서는 "사용자에게 무엇이 실패했나"만 말한다.
 */

export type ExplainInput = {
  source: 'server' | 'client';
  feature: string | null;
  route: string | null;
  status_code: number | null;
  message: string;
};

/** 메시지 본문에서 원인 유형을 추린다. 위에서부터 먼저 맞는 것을 쓴다. */
const CAUSE_RULES: Array<[RegExp, string]> = [
  [/timeout|timed out|ETIMEDOUT|시간 초과/i, '처리 시간이 초과됐습니다'],
  [/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up|network/i, '외부 서비스에 연결하지 못했습니다'],
  [/unauthorized|not authenticated|401/i, '로그인이 풀렸거나 인증되지 않았습니다'],
  [/forbidden|permission|not allowed|403/i, '권한이 없습니다'],
  [/not found|does not exist|404/i, '대상을 찾지 못했습니다'],
  [/duplicate key|already exists|unique constraint/i, '이미 등록된 데이터와 충돌했습니다'],
  [/violates|constraint|PGRST|supabase|database/i, '데이터베이스에 저장하지 못했습니다'],
  [/storage|bucket|upload/i, '파일 저장소 처리에 실패했습니다'],
  [/unexpected token|JSON|parse|malformed|invalid format/i, '데이터 형식이 올바르지 않습니다'],
  [/토큰|token_balance|잔액|insufficient/i, '토큰 잔액이 부족하거나 차감에 실패했습니다'],
  [/quota|rate limit|429/i, '요청 한도를 초과했습니다'],
  [/payload too large|413|file size/i, '파일 또는 요청이 너무 큽니다'],
];

function causeOf(message: string): string | null {
  for (const [re, text] of CAUSE_RULES) if (re.test(message)) return text;
  return null;
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

  if (input.source === 'client') {
    const where = input.route ? `'${input.route}' 화면` : '병원 화면';
    return cause
      ? `병원 사용자가 ${where}을 보다가 오류 화면을 만났습니다 — ${cause}.`
      : `병원 사용자가 ${where}을 보다가 오류 화면을 만났습니다.`;
  }

  const subject = subjectOf(input);
  return cause
    ? `병원 사용자가 ${subject} 작업을 하다 실패했습니다 — ${cause}.`
    : `병원 사용자가 ${subject} 작업을 하다 서버 오류로 실패했습니다.`;
}
