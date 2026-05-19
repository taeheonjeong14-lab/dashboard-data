'use client';

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChartType = 'intovet' | 'plusvet' | 'efriends' | 'other';

type UploadStage =
  | 'idle'
  | 'getting-url'
  | 'uploading-pdf'
  | 'extracting'
  | 'saving-images'
  | 'done'
  | 'error';

type ExtractionResult = {
  runId: string;
  friendlyId?: string;
  documentId?: string;
  chartType?: string;
  hospitalId?: string;
  numPages?: number;
  textLength?: number;
  buckets?: Record<string, string>;
};

type BasicInfo = {
  patientName?: string;
  ownerName?: string;
  species?: string;
  breed?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const CASE_IMAGE_BUCKET = 'case-image';

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  intovet: 'IntoVet EMR',
  plusvet: 'PlusVet EMR',
  efriends: 'eFriends EMR',
  other: '기타',
};

const STAGE_MESSAGES: Record<UploadStage, string> = {
  idle: '',
  'getting-url': '업로드 URL 생성 중…',
  'uploading-pdf': 'PDF 업로드 중…',
  extracting: '텍스트 추출 및 데이터 구조화 중…',
  'saving-images': '이미지 업로드 중…',
  done: '분석 완료',
  error: '오류 발생',
};

// ---------------------------------------------------------------------------
// Helper: format bytes
// ---------------------------------------------------------------------------
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Helper: extract basic info from buckets
// ---------------------------------------------------------------------------
function extractBasicInfo(buckets?: Record<string, string>): BasicInfo {
  if (!buckets?.patient_profile) return {};
  const text = buckets.patient_profile;
  const result: BasicInfo = {};

  const matchField = (patterns: string[]): string | undefined => {
    for (const p of patterns) {
      const re = new RegExp(`${p}[:\\s]+([^\\n,]+)`, 'i');
      const m = text.match(re);
      if (m?.[1]) return m[1].trim();
    }
    return undefined;
  };

  result.patientName = matchField(['환자명', '환자 이름', '이름', 'patient']);
  result.ownerName = matchField(['보호자명', '보호자', 'owner']);
  result.species = matchField(['종', '동물종', 'species']);
  result.breed = matchField(['품종', 'breed']);
  return result;
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------
export default function HealthReportPage() {
  // Form state
  const [chartType, setChartType] = useState<ChartType>('intovet');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [emphasisText, setEmphasisText] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Upload/processing state
  const [stage, setStage] = useState<UploadStage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [basicInfo, setBasicInfo] = useState<BasicInfo>({});
  const [labCount, setLabCount] = useState<number>(0);
  const [vitalCount, setVitalCount] = useState<number>(0);
  const [vaccineCount, setVaccineCount] = useState<number>(0);

  // Hospital ID (fetched on mount)
  const [hospitalId, setHospitalId] = useState<string | null>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Fetch hospitalId on mount
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .schema('core')
        .from('users')
        .select('hospital_id')
        .eq('id', user.id)
        .single();
      if (profile?.hospital_id) {
        setHospitalId(profile.hospital_id as string);
      }
    })();
  }, []);

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => {
      imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // PDF file handling
  // ---------------------------------------------------------------------------
  const handlePdfFile = useCallback((file: File) => {
    setPdfError(null);
    if (file.type !== 'application/pdf') {
      setPdfError('PDF 파일만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setPdfError(`파일 크기는 30MB 이하여야 합니다. (현재: ${formatBytes(file.size)})`);
      return;
    }
    setPdfFile(file);
  }, []);

  const onPdfDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handlePdfFile(file);
    },
    [handlePdfFile],
  );

  const onPdfDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onPdfDragLeave = () => setIsDragging(false);

  const onPdfInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePdfFile(file);
  };

  // ---------------------------------------------------------------------------
  // Image file handling
  // ---------------------------------------------------------------------------
  const onImageInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const previews = files.map((f) => URL.createObjectURL(f));
    setImageFiles((prev) => [...prev, ...files]);
    setImagePreviews((prev) => [...prev, ...previews]);
  };

  const removeImage = (idx: number) => {
    URL.revokeObjectURL(imagePreviews[idx]);
    setImageFiles((prev) => prev.filter((_, i) => i !== idx));
    setImagePreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  // ---------------------------------------------------------------------------
  // Upload PDF via signed URL (XMLHttpRequest for progress)
  // ---------------------------------------------------------------------------
  function uploadPdfWithProgress(
    signedUrl: string,
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signedUrl);
      // Supabase signed upload URL expects multipart/form-data (same as uploadToSignedUrl).
      // Do NOT set Content-Type manually — browser sets it with the multipart boundary.
      const formData = new FormData();
      formData.append('cacheControl', '3600');
      formData.append('', file); // Supabase Storage reads the file from field name ''
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) {
          onProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Storage upload failed: HTTP ${xhr.status}`));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('네트워크 오류로 PDF 업로드에 실패했습니다.')));
      xhr.send(formData);
    });
  }

  // ---------------------------------------------------------------------------
  // Upload images to Supabase Storage
  // ---------------------------------------------------------------------------
  async function uploadImages(runId: string, hId: string): Promise<string[]> {
    const supabase = createClient();
    const paths: string[] = [];

    await Promise.all(
      imageFiles.map(async (file, idx) => {
        const imageId = crypto.randomUUID();
        const storagePath = `${hId}/${runId}/${imageId}.webp`;
        const { error } = await supabase.storage
          .from(CASE_IMAGE_BUCKET)
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (error) {
          console.error(`Image ${idx} upload error:`, error);
        } else {
          paths.push(storagePath);
        }
      }),
    );

    return paths;
  }

  // ---------------------------------------------------------------------------
  // Save metadata to Supabase
  // ---------------------------------------------------------------------------
  async function saveMetadata(runId: string, imagePaths: string[]): Promise<void> {
    const supabase = createClient();
    await supabase.schema('health_report').from('generated_run_content').upsert(
      {
        parse_run_id: runId,
        content_type: 'hospital_notes',
        payload: {
          source: 'hospital_web',
          emphasis_text: emphasisText,
          image_paths: imagePaths,
        },
      },
      { onConflict: 'parse_run_id,content_type' },
    );
  }

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------
  const handleSubmit = async () => {
    if (!pdfFile) return;
    if (!hospitalId) {
      setErrorMessage('병원 정보를 불러올 수 없습니다. 다시 로그인해 주세요.');
      setStage('error');
      return;
    }

    setStage('getting-url');
    setProgressMessage('업로드 URL 생성 중…');
    setUploadProgress(0);
    setErrorMessage('');
    setResult(null);

    try {
      // Step 1: Get signed URL
      const urlRes = await fetch('/api/health-report/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: pdfFile.name,
          fileType: pdfFile.type,
          fileSize: pdfFile.size,
        }),
      });

      if (!urlRes.ok) {
        const err = (await urlRes.json()) as { error?: string };
        throw new Error(err.error ?? '업로드 URL 생성에 실패했습니다.');
      }

      const { signedUrl, storagePath, bucket } = (await urlRes.json()) as {
        signedUrl: string;
        storagePath: string;
        bucket: string;
      };

      // Step 2: Upload PDF
      setStage('uploading-pdf');
      setProgressMessage('PDF 업로드 중…');

      await uploadPdfWithProgress(signedUrl, pdfFile, (pct) => {
        setUploadProgress(pct);
        setProgressMessage(`PDF 업로드 중… ${pct}%`);
      });

      setProgressMessage('PDF 업로드 완료');
      setUploadProgress(100);

      // Step 3: Extract
      setStage('extracting');
      setProgressMessage('텍스트 추출 중…');

      // Animate progress message while waiting
      const extractMessages = [
        '텍스트 추출 중…',
        '데이터 구조화 중…',
        'AI 분석 중…',
        '결과 저장 중…',
      ];
      let msgIdx = 0;
      const msgInterval = setInterval(() => {
        msgIdx = (msgIdx + 1) % extractMessages.length;
        setProgressMessage(extractMessages[msgIdx]);
      }, 4000);

      let extractData: ExtractionResult & { error?: string };
      try {
        const extractRes = await fetch('/api/health-report/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storagePath,
            storageBucket: bucket,
            chartType,
            hospitalId,
            emphasisText,
          }),
        });

        extractData = (await extractRes.json()) as typeof extractData;

        if (!extractRes.ok) {
          throw new Error(extractData.error ?? '차트 분석에 실패했습니다.');
        }
      } finally {
        clearInterval(msgInterval);
      }

      const runId = extractData.runId;

      // Step 4: Upload images (parallel, non-blocking on failure)
      let imagePaths: string[] = [];
      if (imageFiles.length > 0) {
        setStage('saving-images');
        setProgressMessage('이미지 업로드 중…');
        imagePaths = await uploadImages(runId, hospitalId);
      }

      // Step 5: Save metadata
      await saveMetadata(runId, imagePaths);

      // Derive summary counts from buckets
      const buckets = extractData.buckets ?? {};
      const labText = buckets.lab_results ?? '';
      const vitalsText = buckets.vitals ?? '';
      const vaccineText = buckets.vaccines ?? '';
      const countLines = (s: string) => (s.trim() ? s.trim().split('\n').length : 0);

      setLabCount(countLines(labText));
      setVitalCount(countLines(vitalsText));
      setVaccineCount(countLines(vaccineText));
      setBasicInfo(extractBasicInfo(buckets));
      setResult(extractData);
      setStage('done');
      setProgressMessage('분석 완료');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.';
      setErrorMessage(msg);
      setStage('error');
    }
  };

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  const handleReset = () => {
    setPdfFile(null);
    setPdfError(null);
    setImageFiles([]);
    imagePreviews.forEach((u) => URL.revokeObjectURL(u));
    setImagePreviews([]);
    setEmphasisText('');
    setStage('idle');
    setUploadProgress(0);
    setProgressMessage('');
    setErrorMessage('');
    setResult(null);
    setBasicInfo({});
    setLabCount(0);
    setVitalCount(0);
    setVaccineCount(0);
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const isProcessing =
    stage === 'getting-url' ||
    stage === 'uploading-pdf' ||
    stage === 'extracting' ||
    stage === 'saving-images';

  const canSubmit = !!pdfFile && !isProcessing && stage !== 'done';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ maxWidth: '680px' }}>
      {/* Page header */}
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            margin: '0 0 6px',
            fontSize: '20px',
            fontWeight: 700,
            color: 'var(--text)',
          }}
        >
          건강검진 리포트
        </h1>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
          차트 PDF를 업로드하면 AI가 데이터를 구조화합니다.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* SUCCESS STATE                                                        */}
      {/* ------------------------------------------------------------------ */}
      {stage === 'done' && result && (
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          {/* Banner */}
          <div
            style={{
              background: 'var(--success-subtle)',
              borderBottom: '1px solid var(--border)',
              padding: '16px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '20px' }}>✓</span>
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '15px',
                  color: 'var(--success)',
                }}
              >
                분석 완료
              </div>
              {result.friendlyId && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  ID: {result.friendlyId}
                </div>
              )}
            </div>
          </div>

          {/* Details */}
          <div style={{ padding: '24px' }}>
            {/* Basic info */}
            {(basicInfo.patientName ||
              basicInfo.ownerName ||
              basicInfo.species ||
              basicInfo.breed) && (
              <div style={{ marginBottom: '20px' }}>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '10px',
                  }}
                >
                  기본 정보
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                  }}
                >
                  {basicInfo.patientName && (
                    <InfoItem label="환자명" value={basicInfo.patientName} />
                  )}
                  {basicInfo.ownerName && (
                    <InfoItem label="보호자명" value={basicInfo.ownerName} />
                  )}
                  {basicInfo.species && (
                    <InfoItem label="종" value={basicInfo.species} />
                  )}
                  {basicInfo.breed && (
                    <InfoItem label="품종" value={basicInfo.breed} />
                  )}
                </div>
              </div>
            )}

            {/* Counts */}
            <div style={{ marginBottom: '20px' }}>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '10px',
                }}
              >
                추출 항목 수
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <CountBadge label="검사 항목" count={labCount} />
                <CountBadge label="활력징후" count={vitalCount} />
                <CountBadge label="예방접종" count={vaccineCount} />
                {result.numPages && (
                  <CountBadge label="PDF 페이지" count={result.numPages} />
                )}
              </div>
            </div>

            {/* Admin note */}
            <div
              style={{
                fontSize: '13px',
                color: 'var(--text-muted)',
                background: 'var(--bg-subtle)',
                borderRadius: 'var(--radius)',
                padding: '10px 14px',
                marginBottom: '20px',
              }}
            >
              관리자에서 전체 결과 확인 가능합니다.
            </div>

            {/* Reset button */}
            <button
              onClick={handleReset}
              style={{
                padding: '9px 18px',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius)',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              새 차트 분석
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ERROR BANNER                                                         */}
      {/* ------------------------------------------------------------------ */}
      {stage === 'error' && (
        <div
          style={{
            background: 'var(--danger-subtle)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius)',
            padding: '14px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <span style={{ color: 'var(--danger)', fontWeight: 700, flexShrink: 0 }}>오류</span>
          <div style={{ flex: 1, fontSize: '13px', color: 'var(--text)' }}>{errorMessage}</div>
          <button
            onClick={() => setStage('idle')}
            style={{
              background: 'none',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              borderRadius: 'var(--radius)',
              padding: '4px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* FORM (visible unless done)                                           */}
      {/* ------------------------------------------------------------------ */}
      {stage !== 'done' && (
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
          }}
        >
          {/* 1. Chart type */}
          <FormField label="차트 종류" required>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value as ChartType)}
              disabled={isProcessing}
              style={selectStyle}
            >
              {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((k) => (
                <option key={k} value={k}>
                  {CHART_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </FormField>

          {/* 2. PDF upload */}
          <FormField label="차트 PDF 업로드" required>
            <div
              onDrop={onPdfDrop}
              onDragOver={onPdfDragOver}
              onDragLeave={onPdfDragLeave}
              onClick={() => !isProcessing && pdfInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--accent)' : pdfError ? 'var(--danger)' : 'var(--border-strong)'}`,
                borderRadius: 'var(--radius)',
                padding: '28px 20px',
                textAlign: 'center',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                style={{ display: 'none' }}
                onChange={onPdfInputChange}
              />
              {pdfFile ? (
                <div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--text)',
                      marginBottom: '4px',
                    }}
                  >
                    {pdfFile.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {formatBytes(pdfFile.size)}
                  </div>
                  {!isProcessing && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--accent)',
                        marginTop: '6px',
                      }}
                    >
                      클릭하여 다시 선택
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      fontSize: '24px',
                      marginBottom: '8px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    📄
                  </div>
                  <div
                    style={{
                      fontSize: '14px',
                      color: 'var(--text-secondary)',
                      marginBottom: '4px',
                    }}
                  >
                    PDF를 여기에 끌어다 놓거나 클릭하여 선택
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    .pdf 형식, 최대 30MB
                  </div>
                </div>
              )}
            </div>
            {pdfError && (
              <div
                style={{
                  marginTop: '6px',
                  fontSize: '12px',
                  color: 'var(--danger)',
                }}
              >
                {pdfError}
              </div>
            )}

            {/* Progress bar */}
            {(stage === 'uploading-pdf' || stage === 'getting-url') && (
              <div style={{ marginTop: '12px' }}>
                <div
                  style={{
                    height: '6px',
                    background: 'var(--bg-raised)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${uploadProgress}%`,
                      background: 'var(--accent)',
                      borderRadius: '3px',
                      transition: 'width 0.2s',
                    }}
                  />
                </div>
                <div
                  style={{
                    marginTop: '4px',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                  }}
                >
                  {progressMessage}
                </div>
              </div>
            )}
          </FormField>

          {/* 3. Image upload */}
          <FormField label="이미지 업로드" hint="선택사항 — jpg, png, webp">
            <div
              onClick={() => !isProcessing && imageInputRef.current?.click()}
              style={{
                border: `1px dashed var(--border-strong)`,
                borderRadius: 'var(--radius)',
                padding: '16px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                background: 'var(--bg-subtle)',
                textAlign: 'center',
              }}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={onImageInputChange}
              />
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                클릭하여 이미지 추가
              </div>
            </div>

            {imagePreviews.length > 0 && (
              <div
                style={{
                  marginTop: '12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                {imagePreviews.map((src, idx) => (
                  <div
                    key={idx}
                    style={{ position: 'relative', width: '72px', height: '72px' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={imageFiles[idx]?.name ?? `image-${idx}`}
                      style={{
                        width: '72px',
                        height: '72px',
                        objectFit: 'cover',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                      }}
                    />
                    {!isProcessing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(idx);
                        }}
                        style={{
                          position: 'absolute',
                          top: '-6px',
                          right: '-6px',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'var(--danger)',
                          color: '#fff',
                          border: 'none',
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </FormField>

          {/* 4. Emphasis text */}
          <FormField label="강조사항" hint="선택사항">
            <textarea
              value={emphasisText}
              onChange={(e) => setEmphasisText(e.target.value)}
              disabled={isProcessing}
              rows={4}
              placeholder="보호자에게 강조할 사항이나 특이사항을 입력하세요"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: 'var(--bg)',
                color: 'var(--text)',
                resize: 'vertical',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
            />
          </FormField>

          {/* Extraction progress */}
          {(stage === 'extracting' || stage === 'saving-images') && (
            <ExtractionProgress message={progressMessage} />
          )}

          {/* 5. Submit */}
          <div>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: canSubmit ? 'var(--accent)' : 'var(--bg-raised)',
                color: canSubmit ? '#fff' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 'var(--radius)',
                fontSize: '15px',
                fontWeight: 600,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background 0.15s',
              }}
            >
              {isProcessing ? (
                <>
                  <Spinner />
                  분석 중…
                </>
              ) : (
                '차트 분석 시작'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '6px',
          marginBottom: '8px',
        }}
      >
        <label
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          {label}
          {required && (
            <span style={{ color: 'var(--danger)', marginLeft: '3px' }}>*</span>
          )}
        </label>
        {hint && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '14px',
  appearance: 'none',
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%236b7280\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: '32px',
  cursor: 'pointer',
};

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-subtle)',
        borderRadius: 'var(--radius)',
        padding: '8px 12px',
      }}
    >
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function CountBadge({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        background: 'var(--accent-subtle)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '6px 12px',
        textAlign: 'center',
        minWidth: '80px',
      }}
    >
      <div
        style={{
          fontSize: '18px',
          fontWeight: 700,
          color: 'var(--accent)',
          lineHeight: 1.2,
        }}
      >
        {count}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
        {label}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '14px',
        height: '14px',
        border: '2px solid rgba(255,255,255,0.35)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function ExtractionProgress({ message }: { message: string }) {
  return (
    <div
      style={{
        background: 'var(--accent-subtle)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <Spinner />
      <div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)' }}>
          분석 진행 중
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {message} (30초~2분 소요)
        </div>
      </div>
    </div>
  );
}
