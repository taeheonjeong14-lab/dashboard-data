import { getAdminWebPgPool } from '@/lib/db';

export type HospitalWebRunItem = {
  id: string;
  createdAt: string;
  friendlyId: string | null;
  hospitalId: string | null;
  hospitalName: string | null;
  ownerName: string | null;
  patientName: string | null;
  emphasisText: string | null;
  imageCount: number;
};

export async function listHospitalWebRuns(limit = 60): Promise<HospitalWebRunItem[]> {
  const pool = getAdminWebPgPool();
  try {
    const { rows } = await pool.query<{
      id: string;
      created_at: string | Date;
      friendly_id: string | null;
      hospital_id: string | null;
      hospital_name: string | null;
      owner_name: string | null;
      patient_name: string | null;
      payload: unknown;
    }>(
      `SELECT
         pr.id,
         pr.created_at,
         pr.friendly_id,
         pr.hospital_id,
         rbi.hospital_name,
         rbi.owner_name,
         rbi.patient_name,
         grc.payload
       FROM chart_pdf.parse_runs pr
       INNER JOIN health_report.generated_run_content grc
         ON grc.parse_run_id = pr.id
         AND grc.content_type = 'hospital_notes'
       LEFT JOIN LATERAL (
         SELECT hospital_name, owner_name, patient_name
         FROM chart_pdf.result_basic_info
         WHERE parse_run_id = pr.id
         LIMIT 1
       ) rbi ON true
       ORDER BY pr.created_at DESC
       LIMIT $1`,
      [limit],
    );

    return rows.map((row) => {
      const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
      const emphasisText = typeof payload.emphasis_text === 'string' ? payload.emphasis_text.trim() || null : null;
      const imagePaths = Array.isArray(payload.image_paths) ? payload.image_paths : [];

      const ca = row.created_at;
      const createdAt = ca instanceof Date ? ca.toISOString() : String(ca);

      return {
        id: row.id,
        createdAt,
        friendlyId: row.friendly_id || null,
        hospitalId: row.hospital_id || null,
        hospitalName: row.hospital_name || null,
        ownerName: row.owner_name || null,
        patientName: row.patient_name || null,
        emphasisText,
        imageCount: imagePaths.length,
      };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return [];
    throw e;
  }
}
