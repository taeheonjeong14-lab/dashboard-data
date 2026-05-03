import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';

function getBaseUrl(request: NextRequest): string {
  return request.nextUrl?.origin ?? new URL(request.url).origin;
}

// GET /api/admin/hospitals?userId=xxx — 병원 목록 + 웹훅 URL (관리자만)
export async function GET(request: NextRequest) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(userId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const hospitals = await prisma.hospital.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, address: true, addressDetail: true, logoUrl: true, brandColor: true },
    });
    const baseUrl = getBaseUrl(request);
    type HospitalRow = { id: string; name: string; address: string | null; addressDetail: string | null; logoUrl: string | null; brandColor: string | null };
    const list = hospitals.map((h: HospitalRow) => ({
      id: h.id,
      name: h.name,
      address: h.address ?? undefined,
      addressDetail: h.addressDetail ?? undefined,
      logoUrl: h.logoUrl ?? undefined,
      brandColor: h.brandColor ?? undefined,
      webhookUrl: `${baseUrl}/api/tally-webhook?hospitalId=${h.id}`,
    }));

    return NextResponse.json({ success: true, hospitals: list });
  } catch (e) {
    console.error('GET /api/admin/hospitals error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/admin/hospitals?userId=xxx — 병원 생성 (관리자만)
export async function POST(request: NextRequest) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(userId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const name = (body.name as string)?.trim();
    const address = (body.address as string)?.trim() || null;
    const addressDetail = (body.addressDetail as string)?.trim() || null;
    const brandColor = (body.brandColor as string)?.trim() || null;
    if (!name) {
      return NextResponse.json({ success: false, error: 'name required' }, { status: 400 });
    }

    const hospital = await prisma.hospital.create({
      data: { name, address, addressDetail, brandColor },
    });
    const baseUrl = getBaseUrl(request);
    const webhookUrl = `${baseUrl}/api/tally-webhook?hospitalId=${hospital.id}`;
    return NextResponse.json({
      success: true,
      hospital: { id: hospital.id, name: hospital.name, address: hospital.address, addressDetail: hospital.addressDetail, webhookUrl },
    });
  } catch (e) {
    console.error('POST /api/admin/hospitals error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
