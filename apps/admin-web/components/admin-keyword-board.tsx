'use client';

/**
 * 키워드 순위 보드 — 전 병원의 키워드를 한 표로, 기본은 '많이 떨어진 순'.
 * 떨어진 키워드가 곧 admin 의 작업 목록이 된다(그 키워드로 글을 다시 쓰거나 플레이스를 손본다).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

type Kind = 'blog_tab' | 'blog_general' | 'blog_integrated' | 'blog_pet_popular' | 'place';
type Row = {
  hospitalId: string;
  hospitalName: string;
  keyword: string;
  importance: 'high' | 'medium' | 'low';
  kind: Kind;
  current: number | null;
  previous: number | null;
  drop: number | null;
  url: string | null;
  fellOffFirstPage: boolean;
  nearFirstPage: boolean;
  latestDateKey: string | null;
  baselineDateKey: string | null;
};

const KIND_LABEL: Record<Kind, string> = {
  blog_tab: '블로그 탭',
  blog_general: '블로그 일반',
  blog_integrated: '블로그 통합',
  blog_pet_popular: '펫 인기',
  place: '플레이스',
};
const IMPORTANCE_LABEL: Record<Row['importance'], string> = { high: '상', medium: '중', low: '하' };

/** 프리셋 — admin 이 실제로 묻는 질문들. */
type Preset = 'drops' | 'fell_off' | 'near' | 'entered' | 'all';
const PRESETS: { key: Preset; label: string; hint: string }[] = [
  { key: 'drops', label: '하락', hint: '4주 전보다 순위가 떨어진 키워드' },
  { key: 'fell_off', label: '첫 페이지 이탈', hint: '10위 이내였는데 밀려난 키워드 — 가장 아픈 사건' },
  { key: 'near', label: '문턱 (11~15위)', hint: '조금만 올리면 첫 페이지 — 작업 우선순위 1순위' },
  { key: 'entered', label: '신규 진입', hint: '4주 전엔 없었는데 노출되기 시작한 키워드' },
  { key: 'all', label: '전체', hint: '' },
];

const th: CSSProperties = {
  padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
  textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
};
const td: CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 14 };

function rankText(v: number | null): string {
  return v == null ? '없음' : `${v}위`;
}

function DropCell({ row }: { row: Row }) {
  if (row.drop == null) {
    return <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>신규 진입</span>;
  }
  if (row.drop === 999) {
    return <span style={{ fontSize: 14, fontWeight: 800, color: '#b91c1c' }}>노출 사라짐</span>;
  }
  if (row.drop > 0) {
    return <span style={{ fontSize: 14, fontWeight: 800, color: '#b91c1c' }}>▼ {row.drop}</span>;
  }
  if (row.drop < 0) {
    return <span style={{ fontSize: 14, fontWeight: 800, color: '#15803d' }}>▲ {Math.abs(row.drop)}</span>;
  }
  return <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>—</span>;
}

export default function AdminKeywordBoard() {
  const searchParams = useSearchParams();
  const initHospital = searchParams.get('hospitalId') ?? '';

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('drops');
  const [hospital, setHospital] = useState(initHospital);
  const [importance, setImportance] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [kind, setKind] = useState<'' | Kind>('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats/keyword-board', { credentials: 'include' });
      const data = (await res.json()) as { rows?: Row[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '불러오지 못했습니다.');
      setRows(data.rows ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const hospitals = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.hospitalId, r.hospitalName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (hospital && r.hospitalId !== hospital) return false;
      if (importance && r.importance !== importance) return false;
      if (kind && r.kind !== kind) return false;
      if (q && !r.keyword.toLowerCase().includes(q)) return false;
      switch (preset) {
        case 'drops': return r.drop != null && r.drop > 0;
        case 'fell_off': return r.fellOffFirstPage;
        case 'near': return r.nearFirstPage;
        case 'entered': return r.drop == null && r.current != null;
        default: return true;
      }
    });
  }, [rows, hospital, importance, kind, query, preset]);

  const presetHint = PRESETS.find((p) => p.key === preset)?.hint ?? '';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>키워드 순위</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>4주 전 대비 · 전 병원 · 많이 떨어진 순</span>
        <button type="button" className="adminLegacySmallBtn" style={{ marginLeft: 'auto' }} onClick={() => void load()} disabled={loading}>
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      {/* 프리셋 — admin 이 실제로 묻는 질문 */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {PRESETS.map((p) => {
          const on = preset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              className="adminBtnFree"
              onClick={() => setPreset(p.key)}
              title={p.hint}
              style={{
                padding: '4px 11px', fontSize: 11, fontWeight: 700, borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
                background: on ? 'var(--accent-subtle)' : '#fff',
                color: on ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          );
        })}
        {presetHint ? <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-muted)' }}>{presetHint}</span> : null}
      </div>

      {/* 필터 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={hospital} onChange={(e) => setHospital(e.target.value)} style={{ padding: '5px 8px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border-strong)', background: '#fff' }}>
          <option value="">병원 전체</option>
          {hospitals.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={importance} onChange={(e) => setImportance(e.target.value as typeof importance)} style={{ padding: '5px 8px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border-strong)', background: '#fff' }}>
          <option value="">중요도 전체</option>
          <option value="high">상</option>
          <option value="medium">중</option>
          <option value="low">하</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={{ padding: '5px 8px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border-strong)', background: '#fff' }}>
          <option value="">순위 종류 전체</option>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="키워드 검색"
          style={{ padding: '5px 9px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border-strong)', background: '#fff', minWidth: 160 }}
        />
        <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-muted)' }}>{filtered.length}건</span>
      </div>

      {error ? (
        <div style={{ padding: 12, border: '1px solid var(--danger)', borderRadius: 8, background: 'var(--danger-subtle)', color: 'var(--danger)', fontSize: 14, marginBottom: 10 }}>
          {error}
        </div>
      ) : null}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr>
              <th style={th}>병원</th>
              <th style={th}>키워드</th>
              <th style={th}>중요도</th>
              <th style={th}>종류</th>
              <th style={th}>4주 전</th>
              <th style={th}>현재</th>
              <th style={th}>변동</th>
              <th style={th}>노출 문서</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={`${r.hospitalId}-${r.keyword}-${r.kind}-${i}`}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <Link href={`/admin/performance/${r.hospitalId}/blog`} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
                    {r.hospitalName}
                  </Link>
                </td>
                <td style={{ ...td, fontWeight: 700 }}>
                  {r.keyword}
                  {r.fellOffFirstPage ? (
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c' }}>첫 페이지 이탈</span>
                  ) : null}
                  {r.nearFirstPage ? (
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8' }}>문턱</span>
                  ) : null}
                </td>
                <td style={{ ...td, color: r.importance === 'high' ? 'var(--danger)' : 'var(--text-muted)', fontWeight: r.importance === 'high' ? 800 : 500, fontSize: 11 }}>
                  {IMPORTANCE_LABEL[r.importance]}
                </td>
                <td style={{ ...td, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{KIND_LABEL[r.kind]}</td>
                <td style={{ ...td, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{rankText(r.previous)}</td>
                <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{rankText(r.current)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}><DropCell row={r} /></td>
                <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.url}</a>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ ...td, padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>해당하는 키워드가 없습니다.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
