export function getPdfUploadsBucket(): string {
  const name = process.env.SUPABASE_PDF_UPLOADS_BUCKET?.trim();
  return name || 'pdf-uploads';
}

export function getCaseImageBucket(): string {
  const name = process.env.SUPABASE_IMAGE_CASE_BUCKET?.trim();
  return name || 'case-image';
}

/** Admin case image uploads use this bucket (chart-case-images route). */
export const ADMIN_CASE_IMAGES_BUCKET = 'chart-case-images';

