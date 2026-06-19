import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/hospitals/search?q= — 가입 시 소속 병원 검색.
// core.hospitals 는 '승인된 병원'만 존재(등록 승인 시 생성)하므로 그대로 검색.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 1) return NextResponse.json({ hospitals: [] });
  try {
    const hospitals = await prisma.hospital.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true, address: true },
      take: 20,
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ hospitals });
  } catch (e) {
    console.error('GET /api/hospitals/search error:', e);
    return NextResponse.json({ hospitals: [], error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
