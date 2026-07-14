'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { HealthSystemsReportBlock } from '@/lib/health-report-admin/health-systems-types';
import { cloneBlocks, parseHealthSystemsBlocksFromUnknown } from '@/lib/health-report-admin/health-systems-blocks-parse';

const divider = 'var(--border)';

export type CaseImageCandidate = {
  id: string;
  examDate?: string;
  fileName?: string;
  examType?: string;
  radiologySub?: string;
  previewUrl?: string | null;
  storagePath?: string;
};

type HealthSystemsImageBlock = Extract<
  HealthSystemsReportBlock,
  | { variant: 'images' }
  | { variant: 'images4' }
  | { variant: 'imagesGrid2x3' }
  | { variant: 'imagesGrid3x3' }
>;

function isImageBlock(b: HealthSystemsReportBlock): b is HealthSystemsImageBlock {
  return (
    b.variant === 'images' ||
    b.variant === 'images4' ||
    b.variant === 'imagesGrid2x3' ||
    b.variant === 'imagesGrid3x3'
  );
}

function slotCount(b: HealthSystemsReportBlock): number {
  if (!isImageBlock(b)) return 0;
  return b.images.length;
}

function updateSlot(
  blocks: HealthSystemsReportBlock[],
  blockIndex: number,
  slotIndex: number,
  patch: { src?: string; caption?: string },
): HealthSystemsReportBlock[] {
  const out = cloneBlocks(blocks);
  const b = out[blockIndex];
  if (!b || !isImageBlock(b)) return out;
  const img = b.images[slotIndex];
  if (!img) return out;
  if ('src' in patch) img.src = patch.src;
  if ('caption' in patch) img.caption = patch.caption;
  return out;
}

function blocksFromUnknown(raw: unknown): HealthSystemsReportBlock[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return [];
  return parseHealthSystemsBlocksFromUnknown(raw);
}

function isSafePayloadStoragePath(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 512) return false;
  if (t.includes('..') || t.startsWith('/') || t.includes('\0')) return false;
  if (/^https?:\/\//i.test(t) || t.startsWith('blob:') || t.startsWith('data:')) return false;
  return true;
}

/** DB 행 없이도 슬롯 `src`에만 박힌 storage 키를 후보로 쓸 수 있게 수집 */
function collectPayloadStoragePaths(...raws: unknown[]): string[] {
  const out = new Set<string>();
  for (const raw of raws) {
    const blocks = blocksFromUnknown(raw);
    if (!blocks) continue;
    for (const b of blocks) {
      if (!isImageBlock(b)) continue;
      for (const slot of b.images) {
        const src = typeof slot?.src === 'string' ? slot.src.trim() : '';
        if (src && isSafePayloadStoragePath(src)) out.add(src);
      }
    }
  }
  return [...out];
}

function stablePayloadCandidateId(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (Math.imul(31, h) + path.charCodeAt(i)) | 0;
  return `payload:${(h >>> 0).toString(16)}`;
}

/**
 * 5p·6p 대응: `systemsPage4Blocks` / `systemsPage5Blocks` 안의 이미지 슬롯에
 * `report_case_images` 후보를 배치·캡션 편집합니다. 저장 시 `src`는 스토리지 경로 문자열로 둡니다 (chart-api 서명과 동일 계약).
 */
export function AdminHealthReportImageSlots({
  runId,
  page4Raw,
  page5Raw,
  onChangePage4,
  onChangePage5,
  hideSlots,
  onCandidatesLoaded,
  refreshKey,
}: {
  runId: string;
  page4Raw: unknown;
  page5Raw: unknown;
  onChangePage4: (blocks: HealthSystemsReportBlock[]) => void;
  onChangePage5: (blocks: HealthSystemsReportBlock[]) => void;
  hideSlots?: boolean;
  onCandidatesLoaded?: (candidates: CaseImageCandidate[], pathMap: Map<string, string>) => void;
  refreshKey?: number;
}) {
  const [candidates, setCandidates] = useState<CaseImageCandidate[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [signHint, setSignHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const page4Ref = useRef(page4Raw);
  const page5Ref = useRef(page5Raw);
  page4Ref.current = page4Raw;
  page5Ref.current = page5Raw;

  const loadRequestId = useRef(0);

  const payloadOnlyPaths = useMemo(() => collectPayloadStoragePaths(page4Raw, page5Raw), [page4Raw, page5Raw]);
  const placedStoragePaths = useMemo(
    () => new Set(collectPayloadStoragePaths(page4Raw, page5Raw)),
    [page4Raw, page5Raw],
  );
  const unplacedCandidates = useMemo(
    () => candidates.filter((c) => !c.storagePath || !placedStoragePaths.has(c.storagePath)),
    [candidates, placedStoragePaths],
  );

  const loadImages = useCallback(async () => {
    void refreshKey; // trigger re-fetch when refreshKey changes
    const reqId = ++loadRequestId.current;
    setLoading(true);
    setLoadErr(null);
    setSignHint(null);
    try {
      const res = await fetch(`/api/admin/health-report/image-case?runId=${encodeURIComponent(runId)}`, {
        credentials: 'include',
      });
      const data = (await res.json()) as { images?: CaseImageCandidate[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '이미지 목록 실패');
      const fromDb = Array.isArray(data.images) ? data.images : [];
      const seen = new Set(fromDb.map((c) => c.storagePath).filter(Boolean) as string[]);

      // await 이후에도 최신 페이로드를 읽고, 느린 GET이 나중에 도착해도 덮어쓰지 않도록 reqId 로 무시
      const extraPaths = collectPayloadStoragePaths(page4Ref.current, page5Ref.current).filter((p) => !seen.has(p));
      let merged = [...fromDb];

      let signed: Record<string, string | null> = {};
      let signHintLocal: string | null = null;
      if (extraPaths.length > 0) {
        const signRes = await fetch('/api/admin/health-report/image-case/sign-paths', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paths: extraPaths }),
        });
        const signData = (await signRes.json()) as {
          signed?: Record<string, string | null>;
          errors?: Record<string, string>;
          error?: string;
        };
        if (signRes.ok) {
          signed = signData.signed ?? {};
          const errs = signData.errors ?? {};
          const firstErr = Object.values(errs)[0];
          const anySigned = extraPaths.some((p) => Boolean(signed[p]));
          if (!anySigned && firstErr) {
            signHintLocal = `서명 실패(예: ${firstErr}). 시도한 버킷: case-image·image-case·환경변수 버킷. DB의 storage_path가 실제 Storage 객체 키와 같은지 확인해 주세요.`;
          }
        } else {
          signed = {};
          signHintLocal = signData.error ?? `서명 API HTTP ${signRes.status} — 후보는 경로만 표시됩니다.`;
        }
        for (const storagePath of extraPaths) {
          const base = storagePath.split('/').pop() ?? storagePath;
          merged.push({
            id: stablePayloadCandidateId(storagePath),
            storagePath,
            previewUrl: signed[storagePath] ?? null,
            fileName: base,
            examType: '페이로드',
          });
        }
      }

      if (reqId !== loadRequestId.current) return;
      setSignHint(signHintLocal);
      setCandidates(merged);
      if (onCandidatesLoaded) {
        const pathMap = new Map(merged.filter((c) => c.storagePath).map((c) => [c.id, c.storagePath as string]));
        onCandidatesLoaded(merged, pathMap);
      }
    } catch (e) {
      if (reqId !== loadRequestId.current) return;
      setLoadErr(e instanceof Error ? e.message : '이미지 목록 실패');
      setCandidates([]);
    } finally {
      if (reqId === loadRequestId.current) setLoading(false);
    }
  }, [runId, page4Raw, page5Raw, refreshKey]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const p4 = blocksFromUnknown(page4Raw);
  const p5 = blocksFromUnknown(page5Raw);

  const storagePathById = new Map(
    candidates.filter((c) => c.storagePath).map((c) => [c.id, c.storagePath as string]),
  );

  function onDragStartCandidate(e: DragEvent<HTMLDivElement>, id: string) {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'copy';
  }

  function onDropSlot(
    page: '4' | '5',
    blockIndex: number,
    slotIndex: number,
    e: DragEvent<HTMLDivElement>,
  ) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain').trim();
    const path = storagePathById.get(id);
    if (!path) return;
    if (page === '4' && p4) {
      onChangePage4(updateSlot(p4, blockIndex, slotIndex, { src: path }));
    }
    if (page === '5' && p5) {
      onChangePage5(updateSlot(p5, blockIndex, slotIndex, { src: path }));
    }
  }

  function renderPage(
    label: string,
    page: '4' | '5',
    blocks: HealthSystemsReportBlock[],
    onChange: (b: HealthSystemsReportBlock[]) => void,
  ) {
    const sections: Array<{ sectionTitle: string; blockIndex: number }> = [];
    let lastRowsTitle = '';
    blocks.forEach((b, i) => {
      if (b.variant === 'rows') {
        lastRowsTitle = b.titleKo || b.titleEn || `블록 ${i + 1}`;
      } else if (isImageBlock(b)) {
        sections.push({ sectionTitle: lastRowsTitle, blockIndex: i });
      }
    });

    if (sections.length === 0) {
      return (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {label}: 이미지 슬롯 블록이 없습니다 (LLM 생성 후 표시됩니다).
        </p>
      );
    }

    return (
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
        {sections.map(({ sectionTitle, blockIndex }) => {
          const b = blocks[blockIndex]!;
          const n = slotCount(b);
          return (
            <div
              key={`${label}-${blockIndex}`}
              style={{ border: `1px solid ${divider}`, borderRadius: 8, padding: 12, background: 'var(--bg-raised)' }}
            >
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {sectionTitle} · 이미지 ({n}장)
              </div>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                {Array.from({ length: n }, (_, slotIndex) => {
                  const slot = isImageBlock(b) ? b.images[slotIndex] : undefined;
                  const src = slot?.src ?? '';
                  const preview =
                    src && !src.startsWith('http') && !src.startsWith('blob:')
                      ? candidates.find((c) => c.storagePath === src)?.previewUrl
                      : src;
                  return (
                    <div
                      key={slotIndex}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDropSlot(page, blockIndex, slotIndex, e)}
                      style={{
                        border: `1px dashed ${divider}`,
                        borderRadius: 6,
                        padding: 8,
                        minHeight: 120,
                        background: '#fff',
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>슬롯 {slotIndex + 1}</div>
                      {preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" src={preview} style={{ width: '100%', maxHeight: 72, objectFit: 'cover', borderRadius: 4 }} />
                      ) : (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>이미지 없음 · 후보를 끌어다 놓기</div>
                      )}
                      <select
                        style={{ width: '100%', marginTop: 6, fontSize: 11 }}
                        value={candidates.find((c) => c.storagePath === src)?.id ?? ''}
                        onChange={(e) => {
                          const id = e.target.value;
                          const path = id ? (storagePathById.get(id) ?? '') : '';
                          onChange(updateSlot(blocks, blockIndex, slotIndex, { src: path || undefined }));
                        }}
                      >
                        <option value="">비움</option>
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {(c.examDate ?? '') + ' ' + (c.fileName ?? c.id).slice(0, 24)}
                          </option>
                        ))}
                      </select>
                      <input
                        style={{ width: '100%', marginTop: 6, fontSize: 11, padding: 4 }}
                        placeholder="캡션"
                        value={slot?.caption ?? ''}
                        onChange={(e) => onChange(updateSlot(blocks, blockIndex, slotIndex, { caption: e.target.value }))}
                      />
                      {src ? (
                        <button
                          type="button"
                          className="adminLegacySmallBtn"
                          style={{ marginTop: 6, fontSize: 11 }}
                          onClick={() => onChange(updateSlot(blocks, blockIndex, slotIndex, { src: undefined, caption: '' }))}
                        >
                          슬롯 비우기
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>이미지 배치 (5p·6p 슬롯)</span>
        <button type="button" className="adminLegacySmallBtn" disabled={loading} onClick={() => void loadImages()}>
          후보 새로고침
        </button>
      </div>
      {loading ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>후보 이미지 불러오는 중…</p> : null}
      {loadErr ? <p style={{ fontSize: 13, color: 'var(--danger)' }}>{loadErr}</p> : null}
      {!loading && !loadErr && signHint ? (
        <p style={{ fontSize: 13, color: 'var(--warning)', lineHeight: 1.5 }}>{signHint}</p>
      ) : null}
      {!loading && !loadErr && candidates.length === 0 && payloadOnlyPaths.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          이 run(<code style={{ fontSize: 11 }}>{runId}</code>)에 대해 <code>chart_pdf.report_case_images</code>·
          <code>public.report_case_images</code>에 행이 없고, 보고서 페이로드(4·5p 슬롯)에도 storage 경로가 없습니다. vet-report
          이미지 분석 업로드·다른 DB·<code>DATABASE_URL</code> 동일 여부를 확인해 주세요.
        </p>
      ) : null}
      {!loading && !loadErr && candidates.some((c) => c.examType === '페이로드') && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          일부 후보는 DB가 아니라 <strong>보고서 JSON 슬롯의 src</strong>에서만 가져왔습니다(생성 시 자동 배치 등). DB에 행을 쌓으려면
          이미지 분석 업로드 API를 쓰면 됩니다.
        </p>
      )}
      {unplacedCandidates.length > 0 ? (
        <div style={{ border: `1px solid ${divider}`, borderRadius: 8, padding: 12, background: 'var(--bg-subtle)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>후보 (드래그하여 슬롯에 놓기)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {unplacedCandidates.map((c) => (
              <div
                key={c.id}
                draggable
                onDragStart={(e) => onDragStartCandidate(e, c.id)}
                style={{
                  width: 88,
                  cursor: 'grab',
                  border: `1px solid ${divider}`,
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: '#fff',
                }}
              >
                {c.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={c.previewUrl} style={{ width: '100%', height: 64, objectFit: 'cover' }} />
                ) : (
                  <div style={{ height: 64, fontSize: 11, padding: 4, color: 'var(--text-muted)' }}>URL 없음</div>
                )}
                <div style={{ fontSize: 11, padding: 4, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{c.fileName ?? c.id}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!hideSlots && (p4 === null ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--warning)' }}>
          systemsPage4Blocks 가 스키마와 맞지 않아 이미지 슬롯 편집을 건너뜁니다. 위 시트에서 원시 JSON을 수정하세요.
        </p>
      ) : (
        renderPage('systemsPage4Blocks (치과·피부 등)', '4', p4, onChangePage4)
      ))}
      {!hideSlots && (p5 === null ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--warning)' }}>
          systemsPage5Blocks 가 스키마와 맞지 않아 이미지 슬롯 편집을 건너뜁니다. 위 시트에서 원시 JSON을 수정하세요.
        </p>
      ) : (
        renderPage('systemsPage5Blocks (방사선·초음파 등)', '5', p5, onChangePage5)
      ))}
    </div>
  );
}
