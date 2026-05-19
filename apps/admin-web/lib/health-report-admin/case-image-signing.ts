import type { SupabaseClient } from '@supabase/supabase-js';
import { getCaseImageBucket, ADMIN_CASE_IMAGES_BUCKET } from '@/lib/chart-extraction/storage-config';

const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7;

/** DB에 저장된 키가 `버킷명/...` 형태로 중복되었거나 선행 슬래시만 붙은 경우 등 보정 후보 */
export function caseImageObjectKeyCandidates(raw: string, primaryBucket: string): string[] {
  let s = raw.trim();
  const out: string[] = [];
  const push = (x: string) => {
    const t = x.replace(/^\/+/, '');
    if (t && !out.includes(t)) out.push(t);
  };
  push(s);
  for (const b of [primaryBucket, 'case-image', 'image-case']) {
    const prefix = `${b}/`;
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length).replace(/^\/+/, '');
      push(s);
    }
  }
  return out;
}

export function caseImageCandidateBuckets(): string[] {
  const primary = getCaseImageBucket();
  return [...new Set([primary, ADMIN_CASE_IMAGES_BUCKET, 'case-image', 'image-case'])];
}

async function trySignOne(
  supabase: SupabaseClient,
  rawPath: string,
  ttlSec: number,
): Promise<{ url: string | null; err: string }> {
  if (rawPath == null || typeof rawPath !== 'string') {
    return { url: null, err: 'storage_path 가 비어 있거나 문자열이 아닙니다.' };
  }
  const primary = getCaseImageBucket();
  const keys = caseImageObjectKeyCandidates(rawPath, primary);
  if (keys.length === 0) {
    return { url: null, err: '유효한 storage 객체 키를 만들 수 없습니다.' };
  }
  let lastErr = '';
  for (const bucket of caseImageCandidateBuckets()) {
    for (const key of keys) {
      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(key, ttlSec);
        if (!error && data?.signedUrl) return { url: data.signedUrl, err: '' };
        lastErr = error?.message ?? 'no signedUrl';
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return { url: null, err: lastErr.slice(0, 200) };
}

export async function createCaseImageSignedUrl(
  supabase: SupabaseClient,
  rawPath: string,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<string | null> {
  const { url } = await trySignOne(supabase, rawPath, ttlSec);
  return url;
}

/** 요청 path 문자열을 키로 유지한 맵(원본 path → URL | null) */
export async function signCaseImagePathsOriginalKeys(
  supabase: SupabaseClient,
  originalPaths: readonly string[],
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<{ signed: Record<string, string | null>; errors: Record<string, string> }> {
  const signed: Record<string, string | null> = {};
  const errors: Record<string, string> = {};
  for (const originalPath of originalPaths) {
    const { url, err } = await trySignOne(supabase, originalPath, ttlSec);
    signed[originalPath] = url;
    if (!url) errors[originalPath] = err;
  }
  return { signed, errors };
}
