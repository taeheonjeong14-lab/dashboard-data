/**
 * 운영자 에러 알림 발송 — 텔레그램 봇.
 * env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (둘 다 없으면 조용히 스킵).
 * 절대 throw 하지 않는다(알림 실패가 cron 을 깨면 안 됨).
 * 알리고(알림톡)와 달리 고정 IP 프록시가 필요 없다 — 서버리스에서 바로 나간다.
 *
 * 세팅: ① 텔레그램에서 @BotFather → /newbot → 토큰(TELEGRAM_BOT_TOKEN)
 *       ② 만든 봇에게 아무 메시지 전송 → https://api.telegram.org/bot<토큰>/getUpdates
 *          응답의 chat.id 를 TELEGRAM_CHAT_ID 로.
 */
export async function sendErrorAlert(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    console.warn('[error-alert] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 미설정 — 스킵');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3_900), // 텔레그램 4096자 한도 여유
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) console.error('[error-alert] telegram 실패:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error('[error-alert] 발송 예외:', e instanceof Error ? e.message : e);
    return false;
  }
}
