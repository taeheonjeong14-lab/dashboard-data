import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/assert-admin-api';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { formatSupabaseError } from '@/lib/format-supabase-error';

const HOSPITAL_ASSETS_BUCKET = process.env.SUPABASE_HOSPITAL_ASSETS_BUCKET?.trim() || 'hospital-assets';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const hospitalId = String(id || '').trim();
  if (!hospitalId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const form = await request.formData();
    const assetType = String(form.get('asset_type') ?? form.get('assetType') ?? '')
      .trim()
      .toLowerCase();
    const file = form.get('file');
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }
    if (assetType !== 'logo' && assetType !== 'seal') {
      return NextResponse.json({ error: 'asset_type must be logo or seal' }, { status: 400 });
    }

    const f = file as File;
    const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
    const allowed = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);
    if (!allowed.has(ext)) {
      return NextResponse.json({ error: 'unsupported file type' }, { status: 400 });
    }

    const bytes = Buffer.from(await f.arrayBuffer());
    const objectPath = `${hospitalId}/${assetType}.${ext || 'png'}`;
    const supabase = createServiceRoleClient();

    const up = await supabase.storage.from(HOSPITAL_ASSETS_BUCKET).upload(objectPath, bytes, {
      contentType: f.type || 'application/octet-stream',
      upsert: true,
    });
    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 });
    }

    const pub = supabase.storage.from(HOSPITAL_ASSETS_BUCKET).getPublicUrl(objectPath);
    const url = pub.data.publicUrl;
    if (!url) {
      return NextResponse.json({ error: 'could not resolve uploaded URL' }, { status: 500 });
    }

    const updateCandidates =
      assetType === 'logo'
        ? [{ logoUrl: url }, { logo_url: url }]
        : [{ seal_url: url }, { sealUrl: url }];

    let updated = false;
    let lastErr: unknown = null;
    for (const patch of updateCandidates) {
      const res = await supabase
        .schema('core')
        .from('hospitals')
        .update(patch)
        .eq('id', hospitalId);
      if (!res.error) {
        updated = true;
        break;
      }
      lastErr = res.error;
    }
    if (!updated && lastErr) throw lastErr;

    return NextResponse.json({ ok: true, assetType, url, path: objectPath, bucket: HOSPITAL_ASSETS_BUCKET });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}

// DELETE /api/admin/data/hospitals/[id]/assets?asset_type=logo|seal — 자산 삭제(스토리지 + DB 컬럼 null)
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const hospitalId = String(id || '').trim();
  if (!hospitalId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const assetType = (request.nextUrl.searchParams.get('asset_type') ?? request.nextUrl.searchParams.get('assetType') ?? '')
    .trim()
    .toLowerCase();
  if (assetType !== 'logo' && assetType !== 'seal') {
    return NextResponse.json({ error: 'asset_type must be logo or seal' }, { status: 400 });
  }

  try {
    const supabase = createServiceRoleClient();

    // 스토리지 객체 삭제 — 업로드 시 확장자를 모르므로 후보 경로 전부 제거(없는 건 무시됨).
    const exts = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
    const paths = exts.map((e) => `${hospitalId}/${assetType}.${e}`);
    await supabase.storage.from(HOSPITAL_ASSETS_BUCKET).remove(paths);

    // DB 컬럼 null 처리(컬럼명 호환: snake/camel 둘 다 시도).
    const updateCandidates =
      assetType === 'logo'
        ? [{ logoUrl: null }, { logo_url: null }]
        : [{ seal_url: null }, { sealUrl: null }];

    let updated = false;
    let lastErr: unknown = null;
    for (const patch of updateCandidates) {
      const res = await supabase.schema('core').from('hospitals').update(patch).eq('id', hospitalId);
      if (!res.error) {
        updated = true;
        break;
      }
      lastErr = res.error;
    }
    if (!updated && lastErr) throw lastErr;

    return NextResponse.json({ ok: true, assetType });
  } catch (e) {
    return NextResponse.json({ error: formatSupabaseError(e) }, { status: 500 });
  }
}

