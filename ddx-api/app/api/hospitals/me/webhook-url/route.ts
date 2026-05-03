import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/hospitals/me/webhook-url?userId=xxx — Tally 웹훅 등록용 URL (hospitalId 쿼리 포함)
export async function GET(request: NextRequest) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { hospital: true },
    });

    if (!user?.hospitalId || !user.hospital) {
      return NextResponse.json(
        { success: false, error: 'No hospital linked. Create a hospital first.' },
        { status: 404 }
      );
    }

    const baseUrl = request.nextUrl?.origin ?? new URL(request.url).origin;
    const webhookUrl = `${baseUrl}/api/tally-webhook?hospitalId=${user.hospital.id}`;

    return NextResponse.json({ success: true, webhookUrl });
  } catch (e) {
    console.error('GET /api/hospitals/me/webhook-url error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
