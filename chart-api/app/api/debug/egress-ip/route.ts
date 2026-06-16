import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/debug/egress-ip
// chart-api 함수가 외부(알리고 등)로 호출할 때 쓰는 공인 아웃바운드 IP 확인용 진단 라우트.
// Vercel 함수의 egress IP는 유동적이라 호출마다 다를 수 있다 → 여러 번 새로고침해 확인.
export async function GET() {
  try {
    const sources = await Promise.allSettled([
      fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
        .then((r) => r.json() as Promise<{ ip?: string }>)
        .then((j) => j.ip ?? null),
      fetch('https://ifconfig.me/ip', { cache: 'no-store' })
        .then((r) => r.text())
        .then((t) => t.trim() || null),
    ]);
    const ipify = sources[0].status === 'fulfilled' ? sources[0].value : null;
    const ifconfig = sources[1].status === 'fulfilled' ? sources[1].value : null;
    return NextResponse.json({
      ip: ipify ?? ifconfig ?? null,
      sources: { ipify, ifconfig },
      region: process.env.VERCEL_REGION ?? null,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
