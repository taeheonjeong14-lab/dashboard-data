'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CaseBlogButton } from './admin-case-blog-modal';

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
  createdAt: string;
  updatedAt: string;
};

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

export default function AdminCaseBlog() {
  const [items, setItems] = useState<CaseBlogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      [it.title, it.hospitalName, it.patientName, it.ownerName, it.finalDiagnosis, it.friendlyId ?? '', caseId(it.friendlyId), it.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId('');
      return;
    }
    setSelectedId((cur) => (cur && filtered.some((it) => it.runId === cur) ? cur : filtered[0]!.runId));
  }, [filtered]);

  const selected = useMemo(() => items.find((it) => it.runId === selectedId) ?? null, [items, selectedId]);

  // 선택한 케이스의 "선정된 이미지" — 아웃라인(blog_outline)의 섹션별 imageFileNames + 케이스 이미지(URL·캡션).
  type ViewerImage = { fileName: string; url: string | null; caption: string };
  const [imageGroups, setImageGroups] = useState<{ label: string; imgs: ViewerImage[] }[]>([]);
  useEffect(() => {
    let cancelled = false;
    setImageGroups([]);
    if (!selectedId) return;
    (async () => {
      try {
        const [cRes, iRes] = await Promise.all([
          fetch(`/api/admin/health-report/content?runId=${encodeURIComponent(selectedId)}`, { credentials: 'include' }),
          fetch(`/api/admin/runs/${encodeURIComponent(selectedId)}/case-images`, { credentials: 'include' }),
        ]);
        const cData = (await cRes.json()) as { items?: { contentType?: string; payload?: unknown }[] };
        const iData = (await iRes.json()) as { images?: { fileName?: string; signedUrl?: string | null; briefComment?: string; bodyPart?: string | null }[] };
        const outline = (cData.items ?? []).find((i) => i.contentType === 'blog_outline')?.payload as
          | { sections?: { label?: string; imageFileNames?: unknown }[] }
          | undefined;
        const metaByName = new Map<string, { url: string | null; caption: string }>();
        for (const im of iData.images ?? []) {
          const fn = String(im.fileName ?? '');
          if (!fn) continue;
          const brief = typeof im.briefComment === 'string' ? im.briefComment.trim() : '';
          const part = typeof im.bodyPart === 'string' ? im.bodyPart.trim() : '';
          metaByName.set(fn, { url: im.signedUrl ?? null, caption: brief || part });
        }
        const groups: { label: string; imgs: ViewerImage[] }[] = [];
        for (const s of outline?.sections ?? []) {
          const fns = Array.isArray(s.imageFileNames) ? (s.imageFileNames as unknown[]).filter((x): x is string => typeof x === 'string') : [];
          if (!fns.length) continue;
          groups.push({
            label: typeof s.label === 'string' ? s.label : '',
            imgs: fns.map((fn) => ({ fileName: fn, url: metaByName.get(fn)?.url ?? null, caption: metaByName.get(fn)?.caption ?? '' })),
          });
        }
        if (!cancelled) setImageGroups(groups);
      } catch {
        if (!cancelled) setImageGroups([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div>
      {/* 헤더 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>진료케이스</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            전체 {items.length}건 — 차트 목록에서 작성한 진료케이스 블로그 글을 확인합니다.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loading ? '불러오는 중…' : error ?? ''}</span>
          <button type="button" style={btnSecondary} onClick={() => void load()} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>

      {/* 좌우 split */}
      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', width: '100%' }}>
        {/* LEFT — 진료케이스 목록 */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목·병원·환자·태그 검색"
            aria-label="진료케이스 검색"
            disabled={loading}
            style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: '#fff', color: 'var(--text)', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
          />
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
            {filtered.map((it, i) => {
              const active = selectedId === it.runId;
              return (
                <div
                  key={it.runId}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '10px 12px',
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 0,
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(it.runId)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(it.runId); }}
                    style={{ flex: 1, minWidth: 0, cursor: loading ? 'not-allowed' : 'pointer' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: active ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.hospitalName || '—'}
                        </span>
                        {it.friendlyId ? (
                          <span style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            {caseId(it.friendlyId)}
                          </span>
                        ) : null}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{formatDate(it.createdAt)}</span>
                    </span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[it.patientName, it.finalDiagnosis].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                  <CaseBlogButton runId={it.runId} label="수정" triggerStyle={editBtnStyle} onClose={() => void load()} />
                </div>
              );
            })}
            {filtered.length === 0 ? (
              <div style={{ padding: '40px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                {loading ? '불러오는 중…' : items.length === 0 ? '작성된 진료케이스가 없습니다.' : '검색 결과가 없습니다.'}
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT — 글 뷰어 */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', paddingLeft: 24 }}>
          {selected ? (
            <article>
              {selected.friendlyId ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginBottom: 4 }}>
                  진료케이스 ID · {caseId(selected.friendlyId)}
                </div>
              ) : null}
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
                }}
              >
                {selected.bodyMarkdown || '본문이 없습니다.'}
              </div>

              {imageGroups.length > 0 ? (
                <div style={{ marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>선정된 이미지</div>
                  <div style={{ display: 'grid', gap: 14 }}>
                    {imageGroups.map((g, gi) => (
                      <div key={gi}>
                        {g.label ? (
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{g.label}</div>
                        ) : null}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                          {g.imgs.map((im) => (
                            <figure key={im.fileName} style={{ width: 150, margin: 0 }}>
                              {im.url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={im.url} alt={im.fileName} title={im.fileName} style={{ width: 150, height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
                              ) : (
                                <div style={{ width: 150, height: 110, borderRadius: 8, border: '1px dashed var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: 6, wordBreak: 'break-all' }}>{im.fileName}</div>
                              )}
                              {im.caption ? (
                                <figcaption style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, wordBreak: 'break-word' }}>{im.caption}</figcaption>
                              ) : null}
                            </figure>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
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
    </div>
  );
}
