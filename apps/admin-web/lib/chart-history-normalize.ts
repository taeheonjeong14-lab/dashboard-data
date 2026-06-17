import { parseChartAdminHospitalsResponse } from '@/lib/chart-extraction/chart-admin-hospitals';
import type { BlogStage, HealthStage } from '@/lib/case-status';

export type HistoryItem = {
  id: string;
  createdAt: string;
  friendlyId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  isHealthCheckup: boolean;
  isBlog: boolean;
  blogStage: BlogStage;
  healthStage: HealthStage;
};

const BLOG_STAGES = new Set(['none', 'requested', 'writing', 'done']);
const HEALTH_STAGES = new Set(['none', 'requested', 'done']);

export function pickNonEmptyString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t.length > 0) return t;
  }
  return null;
}

/** 단일 행 또는 PostgREST 스타일 1-원 관계 배열 모두 흡수 */
export function firstNestedRecord(v: unknown): Record<string, unknown> | null {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (Array.isArray(v) && v.length > 0 && v[0] != null && typeof v[0] === 'object') {
    return v[0] as Record<string, unknown>;
  }
  return null;
}

/**
 * 백엔드가 camelCase 든 snake_case 든, 병원/기본정보가 join 객체로 와도 흡수.
 */
export function normalizeHistoryApiItem(raw: unknown): HistoryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id =
    typeof o.id === 'string' && o.id.trim()
      ? o.id.trim()
      : o.id != null && String(o.id).trim()
        ? String(o.id).trim()
        : null;
  if (!id) return null;
  const createdAt =
    typeof o.createdAt === 'string'
      ? o.createdAt
      : typeof o.created_at === 'string'
        ? o.created_at
        : '';
  const friendlyId =
    typeof o.friendlyId === 'string'
      ? o.friendlyId
      : typeof o.friendly_id === 'string'
        ? o.friendly_id
        : null;
  const hospJoin =
    firstNestedRecord(o.hospitals) ??
    firstNestedRecord(o.hospital) ??
    firstNestedRecord(o.core_hospitals);
  const basic =
    firstNestedRecord(o.result_basic_info) ??
    firstNestedRecord(o.basic_info) ??
    firstNestedRecord(o.basicInfo);
  const hospitalName = pickNonEmptyString(
    o.hospitalName,
    o.hospital_name,
    o.hospitalNameKo,
    o.hospital_name_ko,
    o.name_ko,
    hospJoin?.name_ko,
    hospJoin?.nameKo,
    hospJoin?.name_en,
    basic?.hospital_name,
    basic?.hospitalName,
    basic?.name_ko,
  );
  const ownerName = pickNonEmptyString(o.ownerName, o.owner_name, basic?.owner_name, basic?.ownerName);
  const patientName = pickNonEmptyString(o.patientName, o.patient_name, basic?.patient_name, basic?.patientName);
  const isHealthCheckup = o.isHealthCheckup === true;
  const isBlog = o.isBlog === true;
  const blogStage = (typeof o.blogStage === 'string' && BLOG_STAGES.has(o.blogStage) ? o.blogStage : 'none') as BlogStage;
  const healthStage = (typeof o.healthStage === 'string' && HEALTH_STAGES.has(o.healthStage) ? o.healthStage : 'none') as HealthStage;
  return { id, createdAt, friendlyId, hospitalName, ownerName, patientName, isHealthCheckup, isBlog, blogStage, healthStage };
}

export function extractHospitalId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const v = o.hospital_id ?? o.hospitalId;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export async function fetchHospitalNameMapById(): Promise<Map<string, string>> {
  const res = await fetch('/api/admin/data/hospitals', { credentials: 'include' });
  const body: unknown = await res.json();
  const map = new Map<string, string>();
  if (!res.ok) return map;
  for (const h of parseChartAdminHospitalsResponse(body)) {
    const label = h.name_ko.trim() ? h.name_ko : '';
    if (label) map.set(h.id, label);
  }
  return map;
}

export function hospitalGroupKey(name: string | null | undefined): string {
  const t = name?.trim();
  return t && t.length > 0 ? t : '병원명 없음';
}
