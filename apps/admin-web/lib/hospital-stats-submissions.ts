import { getAdminWebPgPool } from '@/lib/db';

export type HospitalStatsSubmissionItem = {
  id: string;
  hospitalId: string;
  hospitalName: string | null;
  chartType: string;
  fileName: string;
  rowCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

export async function listHospitalStatsSubmissions(limit = 60): Promise<HospitalStatsSubmissionItem[]> {
  const pool = getAdminWebPgPool();
  try {
    const { rows } = await pool.query<{
      id: string;
      hospital_id: string;
      hospital_name: string | null;
      chart_type: string;
      file_name: string;
      row_count: number;
      date_from: string | Date | null;
      date_to: string | Date | null;
      status: string;
      error_message: string | null;
      created_at: string | Date;
    }>(
      `SELECT id, hospital_id, hospital_name, chart_type, file_name, row_count,
              date_from, date_to, status, error_message, created_at
       FROM analytics.hospital_stats_submissions
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );

    return rows.map((r) => ({
      id: r.id,
      hospitalId: r.hospital_id,
      hospitalName: r.hospital_name,
      chartType: r.chart_type,
      fileName: r.file_name,
      rowCount: r.row_count,
      dateFrom: r.date_from ? String(r.date_from).slice(0, 10) : null,
      dateTo: r.date_to ? String(r.date_to).slice(0, 10) : null,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return [];
    throw e;
  }
}
