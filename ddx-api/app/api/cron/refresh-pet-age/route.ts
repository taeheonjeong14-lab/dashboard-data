import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculatePetAgeCeilFromBirthday } from '@/lib/pet-age';

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (cronSecret) {
      const auth = request.headers.get('authorization') || '';
      if (auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
      }
    }

    const sessions = await prisma.surveySession.findMany({
      where: { petBirthday: { not: null } },
      select: { id: true, petBirthday: true, petAge: true },
      take: 5000,
    });

    let updated = 0;
    for (const s of sessions) {
      if (!s.petBirthday) continue;
      const age = calculatePetAgeCeilFromBirthday(s.petBirthday);
      if (age == null) continue;
      if (s.petAge === age) continue;
      await prisma.surveySession.update({
        where: { id: s.id },
        data: { petAge: age },
      });
      updated += 1;
    }

    return NextResponse.json({
      success: true,
      scanned: sessions.length,
      updated,
    });
  } catch (e) {
    console.error('GET /api/cron/refresh-pet-age error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
