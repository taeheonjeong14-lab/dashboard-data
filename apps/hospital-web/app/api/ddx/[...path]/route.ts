// 로그인 사용자용 ddx-api 프록시 (미들웨어 인증 적용 — 브라우저 쿠키로 통과).
import { ddxProxy } from '@/lib/ddx-proxy';

export const dynamic = 'force-dynamic';

export {
  ddxProxy as GET,
  ddxProxy as POST,
  ddxProxy as PUT,
  ddxProxy as PATCH,
  ddxProxy as DELETE,
};
