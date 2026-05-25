// 보호자용 공개 사전문진(/survey/[token])이 로그인 없이 호출하는 ddx-api 프록시.
// 미들웨어 공개 목록에 포함되어야 한다. ddx-api 의 /api/survey(토큰 기반) 만 사용.
import { ddxProxy } from '@/lib/ddx-proxy';

export const dynamic = 'force-dynamic';

export { ddxProxy as GET, ddxProxy as POST };
