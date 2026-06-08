'use client';

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useHospital } from '@/components/shell/hospital-context';
import { CenteredSpinner } from '@/components/ui/loading-spinner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ChartType = 'intovet' | 'plusvet' | 'efriends' | 'other';

type Stage =
  | 'idle'
  | 'getting-url'
  | 'uploading-pdf'
  | 'extracting'
  | 'saving'
  | 'done'
  | 'error';

type CaseItem = {
  runId: string;
  friendlyId: string | null;
  patientName: string;
  ownerName: string;
  finalDiagnosis: string;
  imageCount: number;
  createdAt: string;
};

type Overview = {
  finalDiagnosis: string;
  visitBackground: string;
  patientNotes: string;
  diagnosisMethod: string;
  treatmentProcess: string;
  aftercarePlan: string;
  emphasis: string;
};

const CASE_IMAGE_BUCKET = 'case-image';
const MAX_FILE_SIZE = 30 * 1024 * 1024;

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  intovet: 'IntoVet EMR',
  plusvet: 'PlusVet EMR',
  efriends: 'eFriends EMR',
  other: '기타',
};

// 케이스 개요 — 차트에 나와있지 않은 내용을 한 줄씩 채운다. finalDiagnosis 만 숏필드.
const LONG_FIELDS: { key: keyof Overview; label: string; placeholder: string }[] = [
  { key: 'visitBackground', label: '내원 배경', placeholder: '보호자가 내원하게 된 배경 (차트에 없는 맥락)' },
  { key: 'patientNotes', label: '환자 특이사항', placeholder: '성격·기왕력 등 차트에 없는 환자 정보' },
  { key: 'diagnosisMethod', label: '진단 방식', placeholder: '진단에 사용한 방법과 과정' },
  { key: 'treatmentProcess', label: '치료 과정', placeholder: '치료 경과와 과정' },
  { key: 'aftercarePlan', label: '사후 관리 계획', placeholder: '퇴원 후 관리·재진 계획' },
  { key: 'emphasis', label: '강조 희망 사항', placeholder: '블로그에서 강조하고 싶은 점' },
];

// 강조 희망 사항을 제외한 개요 항목은 필수.
const REQUIRED_OVERVIEW_KEYS: (keyof Overview)[] = [
  'finalDiagnosis',
  'visitBackground',
  'patientNotes',
  'diagnosisMethod',
  'treatmentProcess',
  'aftercarePlan',
];

const EMPTY_OVERVIEW: Overview = {
  finalDiagnosis: '',
  visitBackground: '',
  patientNotes: '',
  diagnosisMethod: '',
  treatmentProcess: '',
  aftercarePlan: '',
  emphasis: '',
};

// 날짜별 이미지 그룹 — 사용자가 "날짜 선택 → 그날 이미지" 를 여러 날짜로 나눠 올린다.
type ImageGroup = { id: string; date: string; files: File[]; previews: string[] };

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function newImageGroup(): ImageGroup {
  return { id: crypto.randomUUID(), date: todayDateStr(), files: [], previews: [] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function CaseTab() {
  // List
  const [items, setItems] = useState<CaseItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Form
  const [chartType, setChartType] = useState<ChartType>('intovet');
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [imageGroups, setImageGroups] = useState<ImageGroup[]>(() => [newImageGroup()]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);

  // Upload/processing
  const [stage, setStage] = useState<Stage>('idle');
  const [progressMessage, setProgressMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const { hospitalId } = useHospital();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageGroupsRef = useRef(imageGroups);
  imageGroupsRef.current = imageGroups;

  useEffect(() => {
    return () => {
      imageGroupsRef.current.forEach((g) => g.previews.forEach((u) => URL.revokeObjectURL(u)));
    };
  }, []);

  // ----- List -----
  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/blog/case/list');
      const data = (await res.json()) as { items?: CaseItem[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? '목록을 불러오지 못했습니다.');
      setItems(data.items ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // ----- PDF -----
  const handlePdfFiles = useCallback((files: File[]) => {
    setPdfError(null);
    const valid: File[] = [];
    for (const file of files) {
      if (file.type !== 'application/pdf') {
        setPdfError('PDF 파일만 업로드할 수 있습니다.');
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setPdfError(`각 파일은 30MB 이하여야 합니다. (${file.name}: ${formatBytes(file.size)})`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length > 0) {
      setPdfFiles((prev) => [...prev, ...valid]);
      setStage('idle');
    }
  }, []);

  const removePdfFile = useCallback((idx: number) => {
    setPdfFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const onPdfDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) handlePdfFiles(files);
    },
    [handlePdfFiles],
  );

  // ----- Images (날짜별 그룹) -----
  const addImagesToGroup = useCallback((groupId: string, files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    const previews = images.map((f) => URL.createObjectURL(f));
    setImageGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, files: [...g.files, ...images], previews: [...g.previews, ...previews] }
          : g,
      ),
    );
  }, []);

  const onGroupImageChange = (groupId: string, e: ChangeEvent<HTMLInputElement>) => {
    addImagesToGroup(groupId, Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const removeImageFromGroup = (groupId: string, idx: number) => {
    setImageGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        URL.revokeObjectURL(g.previews[idx]);
        return {
          ...g,
          files: g.files.filter((_, i) => i !== idx),
          previews: g.previews.filter((_, i) => i !== idx),
        };
      }),
    );
  };

  const setGroupDate = (groupId: string, date: string) =>
    setImageGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, date } : g)));

  const addGroup = () => setImageGroups((prev) => [...prev, newImageGroup()]);

  const removeGroup = (groupId: string) =>
    setImageGroups((prev) => {
      if (prev.length <= 1) return prev;
      const g = prev.find((x) => x.id === groupId);
      g?.previews.forEach((u) => URL.revokeObjectURL(u));
      return prev.filter((x) => x.id !== groupId);
    });

  const totalImageCount = imageGroups.reduce((s, g) => s + g.files.length, 0);

  // ----- PDF upload via signed URL -----
  function uploadPdf(signedUrl: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signedUrl);
      const formData = new FormData();
      formData.append('cacheControl', '3600');
      formData.append('', file);
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Storage upload failed: HTTP ${xhr.status}`));
      });
      xhr.addEventListener('error', () => reject(new Error('네트워크 오류로 PDF 업로드에 실패했습니다.')));
      xhr.send(formData);
    });
  }

  // 건강검진 리포트와 동일한 서명 URL 직접 업로드(case-image 버킷). 날짜 그룹별로 묶어 반환.
  async function uploadImageGroups(runId: string): Promise<{ date: string; paths: string[] }[]> {
    const flat: { groupIdx: number; file: File }[] = [];
    imageGroups.forEach((g, gi) => g.files.forEach((file) => flat.push({ groupIdx: gi, file })));
    if (flat.length === 0) return [];

    const supabase = createClient();
    const exts = flat.map(({ file }) => (file.name.split('.').pop() || 'jpg').toLowerCase());
    const signRes = await fetch('/api/health-report/case-images/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, exts }),
    });
    const signData = (await signRes.json()) as { uploads?: { path: string; token: string }[]; error?: string };
    if (!signRes.ok) throw new Error(signData.error ?? '이미지 업로드 URL 생성에 실패했습니다.');
    const uploads = signData.uploads ?? [];

    const pathByFlat: (string | null)[] = new Array(flat.length).fill(null);
    await Promise.all(
      uploads.map(async ({ path, token }, idx) => {
        const file = flat[idx]?.file;
        if (!file) return;
        const { error } = await supabase.storage
          .from(CASE_IMAGE_BUCKET)
          .uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (error) throw new Error(`이미지 업로드에 실패했습니다: ${error.message}`);
        pathByFlat[idx] = path;
      }),
    );

    return imageGroups
      .map((g, gi) => ({
        date: g.date,
        paths: flat
          .map((f, idx) => (f.groupIdx === gi ? pathByFlat[idx] : null))
          .filter((p): p is string => !!p),
      }))
      .filter((g) => g.paths.length > 0);
  }

  // ----- Submit -----
  const handleSubmit = async () => {
    if (pdfFiles.length === 0 || !hospitalId) {
      if (!hospitalId) {
        setErrorMessage('병원 정보를 불러올 수 없습니다. 다시 로그인해 주세요.');
        setStage('error');
      }
      return;
    }

    const missing = REQUIRED_OVERVIEW_KEYS.filter((k) => !overview[k].trim());
    if (missing.length > 0) {
      setErrorMessage('케이스 개요 필수 항목을 모두 입력해 주세요. (강조 희망 사항 제외)');
      setStage('error');
      return;
    }

    setStage('getting-url');
    setProgressMessage('업로드 URL 생성 중…');
    setErrorMessage('');

    try {
      // 1·2) 각 PDF 서명 URL 발급 + 업로드 (같은 진료분 차트본문/검사결과 등 여러 PDF 지원)
      //       — 건강검진 리포트와 동일한 차트 파싱 파이프라인 재사용
      const storagePaths: string[] = [];
      let bucket = '';
      for (let i = 0; i < pdfFiles.length; i++) {
        const f = pdfFiles[i];
        setStage('getting-url');
        setProgressMessage('업로드 URL 생성 중…');
        const urlRes = await fetch('/api/health-report/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: f.name, fileType: f.type, fileSize: f.size }),
        });
        if (!urlRes.ok) {
          const err = (await urlRes.json()) as { error?: string };
          throw new Error(err.error ?? '업로드 URL 생성에 실패했습니다.');
        }
        const { signedUrl, storagePath, bucket: b } = (await urlRes.json()) as {
          signedUrl: string;
          storagePath: string;
          bucket: string;
        };
        bucket = b;

        setStage('uploading-pdf');
        const label = pdfFiles.length > 1 ? `(${i + 1}/${pdfFiles.length}) ` : '';
        setProgressMessage(`PDF 업로드 중… ${label}`);
        await uploadPdf(signedUrl, f);
        storagePaths.push(storagePath);
      }

      // 3) 파싱(parse_run 생성) — 건강검진 리포트와 동일
      setStage('extracting');
      setProgressMessage('차트 분석 중…');
      const extractRes = await fetch('/api/health-report/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePaths, storageBucket: bucket, chartType, hospitalId }),
      });
      // 타임아웃/크래시 시 Vercel이 비-JSON 에러 페이지를 주므로 text로 받아 안전 파싱한다.
      const extractRaw = await extractRes.text();
      let extractData: { error?: string; runId?: string } = {};
      try { extractData = extractRaw ? JSON.parse(extractRaw) : {}; } catch { /* 비-JSON(타임아웃 등) */ }
      if (!extractRes.ok || !extractData.runId) {
        const timedOut =
          extractRes.status === 504 ||
          extractRes.status === 408 ||
          /FUNCTION_INVOCATION_TIMEOUT|timeout|timed out/i.test(extractRaw);
        throw new Error(
          timedOut
            ? '파일 용량 초과 - PDF파일이 너무 용량이 크거나 이미지 파일이 너무 많습니다.'
            : (extractData.error ?? '요청 처리에 실패했습니다.'),
        );
      }
      const runId = extractData.runId;

      // 4) 이미지 업로드 + 케이스 개요 저장(blog_case)
      setStage('saving');
      setProgressMessage('케이스 정보 저장 중…');
      const imageGroupsPayload = await uploadImageGroups(runId);
      const saveRes = await fetch('/api/blog/case/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, overview, imageGroups: imageGroupsPayload }),
      });
      if (!saveRes.ok) {
        const err = (await saveRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? '케이스 정보 저장에 실패했습니다.');
      }

      // 완료 — 폼 초기화
      setStage('done');
      setPdfFiles([]);
      setOverview(EMPTY_OVERVIEW);
      imageGroups.forEach((g) => g.previews.forEach((u) => URL.revokeObjectURL(u)));
      setImageGroups([newImageGroup()]);
      setProgressMessage('');
      await loadList();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.');
      setStage('error');
    }
  };

  const isProcessing =
    stage === 'getting-url' || stage === 'uploading-pdf' || stage === 'extracting' || stage === 'saving';
  const overviewComplete = REQUIRED_OVERVIEW_KEYS.every((k) => overview[k].trim());
  const canSubmit = pdfFiles.length > 0 && overviewComplete && !isProcessing;

  const setField = (key: keyof Overview, value: string) => setOverview((prev) => ({ ...prev, [key]: value }));

  // ----- Render -----
  return (
    <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', width: '100%', paddingTop: 18 }}>
      {/* LEFT — 제출한 케이스 목록 */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
        <div style={{ padding: '0 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>제출한 케이스</span>
          <button
            onClick={() => void loadList()}
            style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}
          >
            새로고침
          </button>
        </div>

        {listLoading ? (
          <CenteredSpinner minHeight={200} />
        ) : listError ? (
          <div style={{ padding: '20px 18px', fontSize: 13, color: 'var(--danger)' }}>{listError}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '48px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🩺</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>아직 제출한 케이스가 없습니다</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>오른쪽에서 차트 PDF와 케이스 개요를 등록하세요.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle)' }}>
                {['등록일', '환자 이름', '보호자 이름', '최종진단명', '사진'].map((h) => (
                  <th
                    key={h}
                    style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.runId} style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '11px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {formatDate(item.createdAt)}
                    {item.friendlyId && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>#{item.friendlyId}</div>}
                  </td>
                  <td style={{ padding: '11px 14px', color: 'var(--text)', whiteSpace: 'nowrap' }}>{item.patientName || '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{item.ownerName || '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text)' }}>{item.finalDiagnosis || '—'}</td>
                  <td style={{ padding: '11px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {item.imageCount > 0 ? `${item.imageCount}장` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* RIGHT — 새 케이스 등록 폼 */}
      <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', paddingLeft: 24 }}>
        <div style={{ padding: '0 0 10px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>진료케이스 등록</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>차트 PDF·케이스 개요·사진을 등록해 주세요</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {stage === 'error' && (
            <div style={{ background: 'var(--danger-subtle)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: 12, color: 'var(--text)' }}>
              <span style={{ fontWeight: 700, color: 'var(--danger)' }}>오류 </span>
              {errorMessage}
            </div>
          )}

          {/* 차트 종류 */}
          <FormField label="차트 종류">
            <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} disabled={isProcessing} style={selectStyle}>
              {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((k) => (
                <option key={k} value={k}>
                  {CHART_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </FormField>

          {/* 차트 PDF */}
          <FormField label="차트 PDF" required hint="여러 개 가능">
            <div
              onDrop={onPdfDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => !isProcessing && pdfInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? 'var(--accent)' : pdfError ? 'var(--danger)' : 'var(--border-strong)'}`,
                borderRadius: 'var(--radius)',
                padding: '18px 12px',
                textAlign: 'center',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                transition: 'border-color 0.15s',
              }}
            >
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                style={{ display: 'none' }}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const fs = Array.from(e.target.files ?? []);
                  if (fs.length) handlePdfFiles(fs);
                  e.target.value = '';
                }}
              />
              {pdfFiles.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
                  {pdfFiles.map((f, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 10px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all' }}>{f.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{formatBytes(f.size)}</div>
                      </div>
                      {!isProcessing && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removePdfFile(idx); }}
                          aria-label="삭제"
                          style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {!isProcessing && <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2, textAlign: 'center' }}>+ 클릭하여 PDF 추가</div>}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 20, marginBottom: 5 }}>📄</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>끌어다 놓거나 클릭하여 선택</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PDF · 최대 30MB · 여러 개 가능</div>
                </>
              )}
            </div>
            {pdfError && <div style={{ marginTop: 5, fontSize: 11, color: 'var(--danger)' }}>{pdfError}</div>}
          </FormField>

          {/* 케이스 개요 */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>케이스 개요</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>차트에 나와있지 않은 내용을 한 줄씩 채워 주세요.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FormField label="최종진단명" required>
                <input
                  type="text"
                  value={overview.finalDiagnosis}
                  onChange={(e) => setField('finalDiagnosis', e.target.value)}
                  disabled={isProcessing}
                  placeholder="예: 만성 신부전 2기"
                  style={inputStyle}
                />
              </FormField>

              {LONG_FIELDS.map(({ key, label, placeholder }) => (
                <FormField key={key} label={label} required={REQUIRED_OVERVIEW_KEYS.includes(key)}>
                  <textarea
                    value={overview[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    disabled={isProcessing}
                    rows={2}
                    placeholder={placeholder}
                    style={textareaStyle}
                  />
                </FormField>
              ))}
            </div>
          </div>

          {/* 사진 자료 (날짜별 그룹) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>사진 자료</label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                선택 · 날짜별로 나눠 올릴 수 있어요{totalImageCount > 0 ? ` · 총 ${totalImageCount}장` : ''}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {imageGroups.map((group) => {
                const inputId = `case-img-${group.id}`;
                const dragActive = dragGroupId === group.id;
                return (
                  <div key={group.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10, background: 'var(--bg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>날짜</span>
                      <input
                        type="date"
                        value={group.date}
                        max={todayDateStr()}
                        disabled={isProcessing}
                        onChange={(e) => setGroupDate(group.id, e.target.value)}
                        style={{ ...inputStyle, flex: 1, padding: '6px 8px' }}
                      />
                      {imageGroups.length > 1 && !isProcessing && (
                        <button
                          type="button"
                          onClick={() => removeGroup(group.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap' }}
                        >
                          날짜 삭제
                        </button>
                      )}
                    </div>

                    <div
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragGroupId(null);
                        if (!isProcessing) addImagesToGroup(group.id, Array.from(e.dataTransfer.files ?? []));
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!isProcessing) setDragGroupId(group.id);
                      }}
                      onDragLeave={() => setDragGroupId((id) => (id === group.id ? null : id))}
                      onClick={() => !isProcessing && document.getElementById(inputId)?.click()}
                      style={{
                        border: `2px dashed ${dragActive ? 'var(--accent)' : 'var(--border-strong)'}`,
                        borderRadius: 'var(--radius)',
                        padding: '14px 12px',
                        textAlign: 'center',
                        cursor: isProcessing ? 'not-allowed' : 'pointer',
                        background: dragActive ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
                        transition: 'border-color 0.15s',
                      }}
                    >
                      <input id={inputId} type="file" accept=".jpg,.jpeg,.png,.webp,image/*" multiple style={{ display: 'none' }} onChange={(e) => onGroupImageChange(group.id, e)} />
                      <div style={{ fontSize: 16, marginBottom: 3 }}>🖼️</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>이 날짜 이미지 끌어다 놓거나 클릭</div>
                    </div>

                    {group.previews.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {group.previews.map((src, idx) => (
                          <div key={idx} style={{ position: 'relative', width: 54, height: 54 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={group.files[idx]?.name ?? `img-${idx}`} style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} />
                            {!isProcessing && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeImageFromGroup(group.id, idx);
                                }}
                                style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!isProcessing && (
              <button
                type="button"
                onClick={addGroup}
                style={{ marginTop: 10, width: '100%', padding: 8, background: 'var(--bg-subtle)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                + 날짜 추가하기
              </button>
            )}
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              width: '100%',
              padding: 10,
              background: canSubmit ? 'var(--accent)' : 'var(--bg-subtle)',
              color: canSubmit ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${canSubmit ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              fontSize: 13,
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'background 0.15s',
            }}
          >
            {isProcessing ? (
              <>
                <Spinner />
                {progressMessage || '처리 중…'}
              </>
            ) : (
              '케이스 등록'
            )}
          </button>
          {stage === 'done' && (
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', textAlign: 'center' }}>등록 완료</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function FormField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
        </label>
        {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  appearance: 'none',
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%236b7280\' stroke-width=\'1.5\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: 28,
  cursor: 'pointer',
};

function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
}
