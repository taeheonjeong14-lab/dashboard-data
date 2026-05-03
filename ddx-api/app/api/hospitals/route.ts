import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/hospitals — 병원 목록 (설정·회원가입용, 주소 포함)
export async function GET() {
  try {
    const hospitals = await prisma.hospital.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, address: true, addressDetail: true },
    });
    return NextResponse.json({ success: true, hospitals });
  } catch (e) {
    console.error('GET /api/hospitals error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/hospitals — 병원 생성 후 현재 사용자를 해당 병원에 연결 (관리자용)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = (body.name as string)?.trim();
    const userId = (body.userId as string)?.trim();
    if (!name || !userId) {
      return NextResponse.json(
        { success: false, error: 'name and userId required' },
        { status: 400 }
      );
    }

    const hospital = await prisma.hospital.create({ data: { name } });
    await prisma.user.update({
      where: { id: userId },
      data: { hospitalId: hospital.id },
    });

    return NextResponse.json({
      success: true,
      hospital: { id: hospital.id, name: hospital.name },
    });
  } catch (e) {
    console.error('POST /api/hospitals error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
