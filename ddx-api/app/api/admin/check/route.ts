import { NextRequest, NextResponse } from 'next/server';
import { isAdminByUserId } from '@/lib/admin';

export async function GET(request: NextRequest) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, allowed: false }, { status: 400 });
    }
    const allowed = await isAdminByUserId(userId);
    return NextResponse.json({ success: true, allowed });
  } catch (e) {
    return NextResponse.json({ success: false, allowed: false }, { status: 500 });
  }
}
