'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CaseBlogButton } from './admin-case-blog-modal';
import { StatusBadge } from '@/components/status-badge';

type CaseBlogItem = {
  runId: string;
  friendlyId: string | null;
  hospitalName: string;
  patientName: string;
  ownerName: string;
  finalDiagnosis: string;
  title: string;
  bodyMarkdown: string;
  tags: string[];
  stage: 'writing' | 'done';
  createdAt: string;
  updatedAt: string;
};

function StageSticker({ stage }: { stage: 'writing' | 'done' }) {
  return <StatusBadge category="blog" stage={stage} style={{ marginLeft: 6 }} />;
}

const btnSecondary: CSSProperties = {
  padding: '5px 10px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  background: '#fff',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  cursor: 'pointer',
};
const ctaBtnStyle: CSSProperties = {
  padding: '10px 22px',
  fontSize: 14,
  fontWeight: 700,
  borderRadius: 8,
  background: 'var(--accent)',
  color: '#fff',
  border: '1px solid var(--accent)',
  cursor: 'pointer',
};
const editBtnStyle: CSSProperties = {
  flexShrink: 0,
  padding: '3px 9px',
  fontSize: 11.5,
  fontWeight: 600,
  borderRadius: 6,
  background: '#fff',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  cursor: 'pointer',
};

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// 진료케이스 ID — 차트 고유 ID(friendly_id)와 구분되게 끝에 C 를 붙인다. (병원코드-날짜-순번C)
function caseId(friendlyId: string | null): string {
  return friendlyId ? `${friendlyId}C` : '';
}

// 검사 타입 → 한글 검사명 (chart-api image-case-types 와 동기화). 'other'/null 은 일반 사진 → 캡션 자유.
const EXAM_NAME_KO: Record<string, string> = {
  radiology: '방사선검사',
  ultrasound: '초음파검사',
  microscopy: '현미경검사',
  endoscopy: '검이경검사',
  slit_lamp: '슬릿램프검사',
};

/** 검사 이미지면 [부위] [검사명] (예: "흉부 방사선검사"), 일반 사진이면 AI 자유 캡션(briefComment). */
function buildImageCaption(im: { examType?: unknown; bodyPart?: unknown; briefComment?: unknown }): string {
  const part = typeof im.bodyPart === 'string' ? im.bodyPart.trim() : '';
  const examName = typeof im.examType === 'string' ? EXAM_NAME_KO[im.examType] : undefined;
  if (examName) return part ? `${part} ${examName}` : examName;
  const brief = typeof im.briefComment === 'string' ? im.briefComment.trim() : '';
  return brief || part || '';
}

export default function AdminCaseBlog() {
  const [items, setItems] = useState<CaseBlogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filterHospital, setFilterHospital] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [pseudoOpen, setPseudoOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/case-blog/list', { credentials: 'include' });
      const data = (await res.json()) as { items?: CaseBlogItem[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? '목록을 불러오지 못했습니다.');
      setItems(data.items ?? []);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hospitalOptions = useMemo(
    () => [...new Set(items.map((it) => it.hospitalName?.trim()).filter((h): h is string => Boolean(h)))].sort(),
    [items],
  );
  const monthOptions = useMemo(
    () => [...new Set(items.map((it) => (it.createdAt || '').slice(0, 7)).filter((m) => m.length === 7))].sort().reverse(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (filterHospital && (it.hospitalName?.trim() || '') !== filterHospital) return false;
      if (filterMonth && (it.createdAt || '').slice(0, 7) !== filterMonth) return false;
      if (!q) return true;
      return [it.title, it.hospitalName, it.patientName, it.ownerName, it.finalDiagnosis, it.friendlyId ?? '', caseId(it.friendlyId), it.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [items, query, filterHospital, filterMonth]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId('');
      return;
    }
    setSelectedId((cur) => (cur && filtered.some((it) => it.runId === cur) ? cur : filtered[0]!.runId));
  }, [filtered]);

  const selected = useMemo(() => items.find((it) => it.runId === selectedId) ?? null, [items, selectedId]);

  // 선택한 케이스의 사진 — 케이스 이미지 전체(URL·캡션) + AI 추천 여부(blog_outline 섹션 imageFileNames).
  type CaseImage = { fileName: string; url: string | null; caption: string; aiPicked: boolean };
  const [caseImages, setCaseImages] = useState<CaseImage[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setCaseImages([]);
    setChecked(new Set());
    if (!selectedId) return;
    (async () => {
      try {
        const [cRes, iRes] = await Promise.all([
          fetch(`/api/admin/health-report/content?runId=${encodeURIComponent(selectedId)}`, { credentials: 'include' }),
          fetch(`/api/admin/runs/${encodeURIComponent(selectedId)}/case-images`, { credentials: 'include' }),
        ]);
        const cData = (await cRes.json()) as { items?: { contentType?: string; payload?: unknown }[] };
        const iData = (await iRes.json()) as { images?: { fileName?: string; signedUrl?: string | null; briefComment?: string; bodyPart?: string | null; examType?: string | null }[] };
        // blog_outline 저장 구조는 { outline: { sections: [...] }, caseOverview } — payload.outline.sections 가 정확.
        // (구버전 호환으로 payload.sections 도 폴백)
        const outlinePayload = (cData.items ?? []).find((i) => i.contentType === 'blog_outline')?.payload as
          | { outline?: { sections?: { imageFileNames?: unknown }[] }; sections?: { imageFileNames?: unknown }[] }
          | undefined;
        const sections = outlinePayload?.outline?.sections ?? outlinePayload?.sections ?? [];
        const aiNames = new Set<string>();
        for (const s of sections) {
          const fns = Array.isArray(s.imageFileNames) ? (s.imageFileNames as unknown[]).filter((x): x is string => typeof x === 'string') : [];
          for (const fn of fns) aiNames.add(fn);
        }
        const seen = new Set<string>();
        const raw: { fileName: string; url: string | null; aiPicked: boolean; caption: string }[] = [];
        for (const im of iData.images ?? []) {
          const fn = String(im.fileName ?? '');
          if (!fn || seen.has(fn)) continue;
          seen.add(fn);
          raw.push({ fileName: fn, url: im.signedUrl ?? null, aiPicked: aiNames.has(fn), caption: buildImageCaption(im) });
        }
        // 케이스 내 동일 캡션은 넘버링("심장 초음파검사 1", "심장 초음파검사 2") — 100% 중복 방지.
        const capCount = new Map<string, number>();
        for (const r of raw) if (r.caption) capCount.set(r.caption, (capCount.get(r.caption) ?? 0) + 1);
        const capSeen = new Map<string, number>();
        const imgs: CaseImage[] = raw.map((r) => {
          let caption = r.caption;
          if (caption && (capCount.get(caption) ?? 0) > 1) {
            const n = (capSeen.get(caption) ?? 0) + 1;
            capSeen.set(caption, n);
            caption = `${caption} ${n}`;
          }
          return { fileName: r.fileName, url: r.url, caption, aiPicked: r.aiPicked };
        });
        if (!cancelled) {
          setCaseImages(imgs);
          // 기본 선택 = AI 추천 사진(다운로드 가능한 것).
          setChecked(new Set(imgs.filter((x) => x.aiPicked && x.url).map((x) => x.fileName)));
        }
      } catch {
        if (!cancelled) {
          setCaseImages([]);
          setChecked(new Set());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const toggleChecked = useCallback((fn: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(fn)) next.delete(fn);
      else next.add(fn);
      return next;
    });
  }, []);

  async function downloadSelectedImages() {
    const targets = caseImages.filter((im) => checked.has(im.fileName) && im.url);
    if (targets.length === 0) return;
    setDownloading(true);
    try {
      for (const t of targets) {
        const res = await fetch(t.url as string);
        if (!res.ok) throw new Error(`다운로드 실패: ${t.fileName}`);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const ext = (t.fileName.split('.').pop() || 'jpg').toLowerCase();
        const downloadName = t.caption
          ? `${t.caption.replace(/[\\/:*?"<>|\n\r]+/g, '_').trim()}.${ext}`
          : t.fileName;
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
        await new Promise((r) => setTimeout(r, 300)); // 브라우저가 연속 다운로드를 막지 않도록 약간 텀
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '다운로드 중 오류가 발생했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="adminLayout2WithMain">
      <aside className="adminLayoutSecondaryRail" aria-label="진료케이스 목록">
        <div className="adminRailToolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목·병원·환자·태그 검색"
            aria-label="진료케이스 검색"
            disabled={loading}
            style={{ flex: 1, minWidth: 0, padding: '8px 0', background: 'transparent', border: 0, borderRadius: 0, outline: 'none', font: 'inherit', fontSize: 13 }}
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="새로고침"
            title="새로고침"
            style={{ flexShrink: 0, border: 0, background: 'transparent', cursor: loading ? 'default' : 'pointer', fontSize: 15, color: 'var(--text-muted)', padding: '0 2px' }}
          >
            ↻
          </button>
        </div>
        {!loading && items.length > 0 && (
          <div className="adminRailFilterBar">
            <select
              className="adminRailFilterSelect"
              style={{ flexBasis: '100%' }}
              value={filterHospital}
              onChange={(e) => setFilterHospital(e.target.value)}
              aria-label="병원 필터"
            >
              <option value="">병원 전체</option>
              {hospitalOptions.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <select
              className="adminRailFilterSelect"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              aria-label="작성월 필터"
            >
              <option value="">작성월 전체</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>{`${m.slice(2, 4)}년 ${String(Number(m.slice(5, 7)))}월`}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ maxHeight: 'min(72vh, calc(100vh - 200px))', overflow: 'auto' }}>
          {loading ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--text-muted)' }}>불러오는 중…</p>
          ) : error ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>
          ) : items.length === 0 ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>작성된 진료케이스가 없습니다.</p>
          ) : filtered.length === 0 ? (
            <p style={{ margin: '10px 10px', fontSize: 12, color: 'var(--text-muted)' }}>검색 결과 없음</p>
          ) : (
            filtered.map((it) => (
              <button
                key={it.runId}
                type="button"
                className={`adminRailRow${selectedId === it.runId ? ' adminRailRowActive' : ''}`}
                onClick={() => setSelectedId(it.runId)}
                disabled={loading}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontWeight: 700, color: 'inherit', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.hospitalName || '병원명 없음'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{formatDate(it.createdAt)}</span>
                </div>
                <span className="adminRailSub">
                  {it.patientName?.trim() ? `${it.patientName.trim()} · ` : ''}
                  {caseId(it.friendlyId) || it.runId.slice(0, 8)}
                  <StageSticker stage={it.stage} />
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="adminLayoutMainPane">
        <div className="adminLayoutMainColumnInset">
          {selected && selected.stage === 'writing' ? (
            <div style={{ padding: '64px 18px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}>
                {selected.friendlyId ? `진료케이스 ID · ${caseId(selected.friendlyId)}` : ''}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                {[selected.hospitalName, selected.patientName].filter(Boolean).join(' · ') || '진료케이스'}
              </div>
              <div style={{ fontSize: 13, marginBottom: 20 }}>아직 작성 중인 진료케이스입니다.</div>
              <CaseBlogButton runId={selected.runId} label="작성 이어가기" triggerStyle={ctaBtnStyle} onClose={() => void load()} />
            </div>
          ) : selected ? (
            <article>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <div style={{ minWidth: 0, fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {selected.friendlyId ? `진료케이스 ID · ${caseId(selected.friendlyId)}` : ''}
                </div>
                <div style={{ display: 'flex', flexShrink: 0, gap: 6 }}>
                  {selected.patientName ? (
                    <button type="button" style={editBtnStyle} onClick={() => setPseudoOpen(true)}>
                      후처리 및 복사
                    </button>
                  ) : null}
                  <CaseBlogButton runId={selected.runId} label="수정" triggerStyle={editBtnStyle} onClose={() => void load()} />
                </div>
              </div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)', lineHeight: 1.35 }}>{selected.title}</h2>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {[selected.hospitalName, selected.patientName ? `${selected.patientName}${selected.ownerName ? ` (${selected.ownerName})` : ''}` : '', selected.finalDiagnosis, `작성 ${formatDate(selected.createdAt)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {selected.tags.length > 0 ? (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.tags.map((t) => (
                    <span key={t} style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-subtle)', padding: '2px 8px', borderRadius: 999 }}>
                      #{t}
                    </span>
                  ))}
                </div>
              ) : null}
              <div
                style={{
                  marginTop: 16,
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  // 본문은 고정 높이 + 내부 스크롤 — 글이 길어도 아래 사진 섹션이 한 화면에 같이 보이게.
                  maxHeight: '46vh',
                  overflowY: 'auto',
                  paddingRight: 8,
                }}
              >
                {stripFormatMarkers(selected.bodyMarkdown) || '본문이 없습니다.'}
              </div>

              <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      사진 {caseImages.length}장
                      <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>
                        · AI 추천 {caseImages.filter((i) => i.aiPicked).length}장
                      </span>
                    </div>
                    {caseImages.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" style={btnSecondary} onClick={() => setChecked(new Set(caseImages.filter((i) => i.aiPicked && i.url).map((i) => i.fileName)))}>
                        AI 추천 선택
                      </button>
                      <button type="button" style={btnSecondary} onClick={() => setChecked(new Set(caseImages.filter((i) => i.url).map((i) => i.fileName)))}>
                        전체 선택
                      </button>
                      <button type="button" style={btnSecondary} onClick={() => setChecked(new Set())}>
                        선택 해제
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadSelectedImages()}
                        disabled={checked.size === 0 || downloading}
                        style={{
                          padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                          background: checked.size === 0 || downloading ? 'var(--bg-raised)' : 'var(--accent)',
                          color: checked.size === 0 || downloading ? 'var(--text-muted)' : '#fff',
                          border: 'none', cursor: checked.size === 0 || downloading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {downloading ? '다운로드 중…' : `선택 다운로드 (${checked.size})`}
                      </button>
                    </div>
                    )}
                  </div>
                  {caseImages.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {caseImages.map((im) => {
                      const isChecked = checked.has(im.fileName);
                      return (
                        <figure
                          key={im.fileName}
                          onClick={() => im.url && toggleChecked(im.fileName)}
                          style={{ width: 150, margin: 0, cursor: im.url ? 'pointer' : 'default' }}
                        >
                          <div style={{ position: 'relative' }}>
                            {im.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={im.url} alt={im.fileName} title={im.fileName} style={{ width: 150, height: 110, objectFit: 'cover', borderRadius: 8, border: isChecked ? '2px solid var(--accent)' : '1px solid var(--border)', display: 'block' }} />
                            ) : (
                              <div style={{ width: 150, height: 110, borderRadius: 8, border: '1px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: 6, wordBreak: 'break-all' }}>{im.fileName}</div>
                            )}
                            {im.url ? (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleChecked(im.fileName)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`${im.fileName} 선택`}
                                style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, cursor: 'pointer' }}
                              />
                            ) : null}
                            {im.aiPicked ? (
                              <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, fontWeight: 700, color: '#fff', background: 'var(--accent)', padding: '1px 6px', borderRadius: 999 }}>
                                AI 추천
                              </span>
                            ) : null}
                          </div>
                          {im.caption ? (
                            <figcaption style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, wordBreak: 'break-word' }}>{im.caption}</figcaption>
                          ) : null}
                        </figure>
                      );
                    })}
                  </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 0' }}>등록된 사진이 없습니다.</div>
                  )}
                </div>
            </article>
          ) : (
            <div style={{ padding: '64px 18px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📝</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>선택된 진료케이스가 없습니다</div>
              <div style={{ fontSize: 13 }}>좌측 목록에서 글을 선택하세요.</div>
            </div>
          )}
        </div>
      </div>
      {pseudoOpen && selected ? (
        <PostProcessModal
          runId={selected.runId}
          patientName={selected.patientName}
          body={selected.bodyMarkdown}
          onClose={() => setPseudoOpen(false)}
        />
      ) : null}
    </div>
  );
}

// 마크다운 서식(**볼드** / ==형광== / !!포인트!! / ## 소제목)을 네이버 붙여넣기용 HTML로 변환.
// 색·배경은 여기서 고정(나중에 한 곳에서 변경). 인라인 스타일이라 네이버 에디터가 붙여넣기 시 유지한다.
function inlineFormatToHtml(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/==([^=\n]+)==/g, '<span style="background-color:#fff3a3">$1</span>')
    .replace(/!!([^!\n]+)!!/g, '<span style="color:#d92d20">$1</span>');
}
function mdToNaverHtml(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((blk) => {
      const t = blk.trim();
      if (!t) return '';
      if (!t.includes('\n') && /^#{1,6}\s+/.test(t)) {
        return `<p><strong>${inlineFormatToHtml(t.replace(/^#{1,6}\s+/, ''))}</strong></p>`;
      }
      return `<p>${inlineFormatToHtml(t).replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}
// 서식 마커를 제거한 평문(text/plain 폴백·일반 붙여넣기용).
function stripFormatMarkers(md: string): string {
  return md
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/==([^=\n]+)==/g, '$1')
    .replace(/!!([^!\n]+)!!/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}
// 클립보드에 HTML+평문 동시 write(네이버는 HTML을 읽어 서식 반영). 미지원 시 평문만.
async function copyRichHtml(html: string, plain: string): Promise<void> {
  const hasClipboardItem = typeof window !== 'undefined' && 'ClipboardItem' in window;
  if (navigator.clipboard && hasClipboardItem) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(plain);
  }
}

// 후처리 및 복사 모달 — 환자명 가명 치환 + (AI) 서식화 → 네이버용 HTML 복사. 저장하지 않음.
function PostProcessModal({ runId, patientName, body, onClose }: { runId: string; patientName: string; body: string; onClose: () => void }) {
  const [pseudo, setPseudo] = useState('');
  const [copied, setCopied] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [formattedMd, setFormattedMd] = useState<string | null>(null); // AI 서식 적용 결과(마커 포함). null = 미적용
  const [formatError, setFormatError] = useState<string | null>(null);

  const occurrences = patientName ? body.split(patientName).length - 1 : 0;
  // 가명 치환(환자명 있으면). 가명 비면 원문 환자명 유지.
  const pseudonymizedMd = patientName ? body.split(patientName).join(pseudo.trim() || patientName) : body;
  // 표시·복사 대상: 서식 적용했으면 그 결과, 아니면 평문(치환본).
  const displayMd = formattedMd ?? pseudonymizedMd;
  const previewHtml = mdToNaverHtml(displayMd);
  const plainText = stripFormatMarkers(displayMd);

  // 가명이 바뀌면 이전 서식 결과는 무효(다른 텍스트 기준이므로).
  const onPseudoChange = (v: string) => { setPseudo(v); setFormattedMd(null); };

  const handleFormat = async () => {
    setFormatting(true); setFormatError(null);
    try {
      const res = await fetch('/api/admin/health-report/generate', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, contentType: 'blog_format', text: pseudonymizedMd }),
      });
      const data = (await res.json()) as { error?: string; generated?: { text?: string } };
      if (!res.ok) throw new Error(data.error ?? '서식 적용 실패');
      setFormattedMd(data.generated?.text || pseudonymizedMd);
    } catch (e) {
      setFormatError(e instanceof Error ? e.message : '서식 적용 실패');
    } finally {
      setFormatting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await copyRichHtml(previewHtml, plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('복사에 실패했습니다. 미리보기를 직접 선택해 복사해주세요.');
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(92vw, 760px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>후처리 및 복사</h2>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ border: 0, background: 'transparent', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: 'var(--text-muted)' }}>
            ×
          </button>
        </div>

        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 8 }}>
            실제 환자명 <b style={{ color: 'var(--text)' }}>{patientName || '—'}</b> 을(를) 본문에서{' '}
            <b style={{ color: 'var(--text)' }}>{occurrences}곳</b> 찾았습니다. 가명을 입력하면 치환되고(선택),
            아래 미리보기처럼 <b style={{ color: 'var(--text)' }}>서식 포함</b>으로 복사되어 네이버에 그대로 붙여넣을 수 있습니다.
          </div>
          <input
            autoFocus
            value={pseudo}
            onChange={(e) => onPseudoChange(e.target.value)}
            placeholder="가명 입력 (예: OO)"
            style={{ width: '100%', padding: '9px 12px', fontSize: 14, border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }}
          />
          {formatError ? (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{formatError}</div>
          ) : null}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            미리보기 {formattedMd ? '· 서식 적용됨' : '· 평문 ("서식 적용"을 누르면 AI가 꾸밈)'} (복사되는 그대로)
          </div>
          <div
            style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text)', wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
          <button type="button" onClick={onClose} style={{ ...btnSecondary, padding: '8px 14px' }}>
            닫기
          </button>
          <button
            type="button"
            onClick={() => void handleFormat()}
            disabled={formatting}
            style={{ ...btnSecondary, padding: '8px 14px', opacity: formatting ? 0.6 : 1, cursor: formatting ? 'not-allowed' : 'pointer' }}
          >
            {formatting ? '서식 적용 중…' : formattedMd ? '서식 다시 적용' : '서식 적용 (AI)'}
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={formatting}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              cursor: formatting ? 'not-allowed' : 'pointer',
              opacity: formatting ? 0.6 : 1,
            }}
          >
            {copied ? '복사됨!' : '서식 포함 복사'}
          </button>
        </div>
      </div>
    </div>
  );
}
