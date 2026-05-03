import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { isAdminByUserId } from '@/lib/admin';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')?.trim();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }
    if (!(await isAdminByUserId(userId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id: hospitalId } = await params;
    const formData = await request.formData();
    const file = formData.get('logo') as File | null;
    if (!file || !file.size) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const allowed = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
    if (!allowed.includes(ext)) {
      return NextResponse.json({ success: false, error: 'Unsupported file type' }, { status: 400 });
    }

    const fileName = `${hospitalId}.${ext}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, fileName), buffer);

    const logoUrl = `/uploads/${fileName}?t=${Date.now()}`;

    await prisma.hospital.update({
      where: { id: hospitalId },
      data: { logoUrl },
    });

    return NextResponse.json({ success: true, logoUrl });
  } catch (e) {
    console.error('POST /api/admin/hospitals/[id]/logo error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
