'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

type CaseBlogItem = {
  runId: string;
  friendlyId: string | null;
  hospitalName: string;
  patientName: string;
  ownerName: string;
  title: string;
  excerpt: string;
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

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
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
      [it.title, it.hospitalName, it.patientName, it.ownerName, it.friendlyId ?? '', it.tags.join(' ')]
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
                <button
                  key={it.runId}
                  type="button"
                  onClick={() => setSelectedId(it.runId)}
                  disabled={loading}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    border: 0,
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 0,
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: active ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.title}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{formatDate(it.createdAt)}</span>
                  </span>
                  <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {[it.hospitalName, it.patientName].filter(Boolean).join(' · ') || '—'}
                  </span>
                </button>
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
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)', lineHeight: 1.35 }}>{selected.title}</h2>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {[selected.hospitalName, selected.patientName ? `${selected.patientName}${selected.ownerName ? ` (${selected.ownerName})` : ''}` : '', `작성 ${formatDate(selected.createdAt)}`]
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
              {selected.excerpt ? (
                <p style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 8, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {selected.excerpt}
                </p>
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
