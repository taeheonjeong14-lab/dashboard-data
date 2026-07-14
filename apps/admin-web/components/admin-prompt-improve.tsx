'use client';

/**
 * admin '프롬프트 개선' 메뉴 — AI 초안이 실제로 어떻게 고쳐졌는지 보고 프롬프트를 다듬는다.
 * 탭: 블로그 컨텐츠(예정) · 검진 리포트(초안 vs 병원 최종본 비교 분석 결과).
 * 분석은 admin 이 고른 run 에 한해, 병원이 카카오 발송/공유 PDF 다운로드한 시점에 1회 돌아간다.
 */
import { useEffect, useState, type CSSProperties } from 'react';

type Change = { field?: string; kind?: string; what?: string; reason?: string; promptFix?: string };
type DiffEntry = { field: string; label: string; before: string; after: string };
type DiffResult = {
  changes?: Change[];
  promptSuggestions?: string[];
  summary?: string;
  noEdits?: boolean;
  changed?: DiffEntry[];
  unchanged?: string[];
};
type Item = {
  runId: string;
  status: string;
  triggeredBy: string | null;
  result: DiffResult | null;
  error: string | null;
  createdAt: string;
  analyzedAt: string | null;
  friendlyId: string | null;
  hospitalName: string | null;
};

const KIND_LABEL: Record<string, string> = {
  factual: '사실 정정',
  tone: '표현·말투',
  detail: '내용 가감',
  format: '구성·길이',
  trivial: '사소',
};
const KIND_COLOR: Record<string, string> = {
  factual: '#e5484d',
  tone: '#f5a623',
  detail: '#3b82f6',
  format: '#8b5cf6',
  trivial: 'var(--text-muted)',
};
const STATUS_LABEL: Record<string, string> = {
  selected: '대기 (병원 발송/다운로드 시 분석)',
  running: '분석 중',
  done: '완료',
  error: '실패',
};

const card: CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' };
const tabBtn = (active: boolean): CSSProperties => ({
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 700,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
});

function badge(color: string): CSSProperties {
  return { fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, border: `1px solid ${color}`, color, whiteSpace: 'nowrap' };
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

/** 한 건의 분석 결과 — 변경 목록 + 프롬프트 제안 + 원문 대조(접힘). */
function DiffCard({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const r = item.result;
  const changes = r?.changes ?? [];
  const suggestions = r?.promptSuggestions ?? [];
  const raw = r?.changed ?? [];

  return (
    <div style={{ ...card, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{item.hospitalName ?? '병원 미상'}</b>
        <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.friendlyId ?? item.runId.slice(0, 8)}</code>
        <span style={badge(item.status === 'error' ? '#e5484d' : 'var(--text-muted)')}>
          {STATUS_LABEL[item.status] ?? item.status}
        </span>
        {item.triggeredBy ? (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            트리거: {item.triggeredBy === 'kakao' ? '카카오 발송' : 'PDF 다운로드'}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          선택 {fmt(item.createdAt)} · 분석 {fmt(item.analyzedAt)}
        </span>
      </div>

      {item.error ? <div style={{ fontSize: 13, color: 'var(--danger)' }}>{item.error}</div> : null}
      {r?.summary ? <div style={{ fontSize: 13, color: 'var(--text)' }}>{r.summary}</div> : null}

      {r?.noEdits ? (
        <div style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
          병원이 초안을 그대로 발송 — 이 건은 프롬프트가 잘 맞았습니다.
        </div>
      ) : null}

      {changes.length ? (
        <div style={{ display: 'grid', gap: 7 }}>
          {changes.map((c, i) => (
            <div key={i} style={{ display: 'grid', gap: 3, paddingLeft: 10, borderLeft: `3px solid ${KIND_COLOR[c.kind ?? ''] ?? 'var(--border)'}` }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={badge(KIND_COLOR[c.kind ?? ''] ?? 'var(--text-muted)')}>{KIND_LABEL[c.kind ?? ''] ?? c.kind ?? '기타'}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{c.what}</span>
                <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.field}</code>
              </div>
              {c.reason ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>왜: {c.reason}</div> : null}
              {c.promptFix ? <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>프롬프트: {c.promptFix}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {suggestions.length ? (
        <div style={{ background: 'var(--bg-subtle)', borderRadius: 8, padding: '9px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 5 }}>프롬프트 개선 제안</div>
          <ul style={{ margin: 0, paddingLeft: 16, listStyleType: 'disc', display: 'grid', gap: 4 }}>
            {suggestions.map((s, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {raw.length ? (
        <div>
          <button type="button" onClick={() => setOpen((v) => !v)} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
            원문 대조 {open ? '▾' : '▸'} ({raw.length}개 필드)
          </button>
          {open ? (
            <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
              {raw.map((d, i) => (
                <div key={i} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)' }}>{d.label}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#fff5f5', borderRadius: 6, padding: '7px 9px', color: 'var(--text-secondary)' }}>
                      {d.before || '(없음)'}
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: '#f2fbf6', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }}>
                      {d.after || '(삭제됨)'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HealthReportTab() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/prompt-improve/health-report', { credentials: 'include' });
        const data = (await res.json()) as { items?: Item[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? '목록을 불러오지 못했습니다.');
        setItems(data.items ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</p>;
  if (error) return <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>;
  if (!items.length) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        분석 대상이 없습니다. 건강검진 리포트 화면에서 <b>&lsquo;비교 분석 대상&rsquo;</b>을 켜 두면,
        병원이 카카오로 발송하거나 공유 페이지에서 PDF를 받는 시점에 초안과 최종본을 비교해 여기에 쌓입니다.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((it) => (
        <DiffCard key={it.runId} item={it} />
      ))}
    </div>
  );
}

export default function AdminPromptImprove() {
  const [tab, setTab] = useState<'blog' | 'report'>('report');

  return (
    <div style={{ display: 'grid', gap: 16, paddingBottom: 32 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>프롬프트 개선</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '5px 0 0' }}>
          AI 초안이 사람 손을 거치며 어떻게 바뀌었는지 모아 보고, 초안 생성 프롬프트를 다듬습니다.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
        <button type="button" style={tabBtn(tab === 'blog')} onClick={() => setTab('blog')}>
          블로그 컨텐츠
        </button>
        <button type="button" style={tabBtn(tab === 'report')} onClick={() => setTab('report')}>
          검진 리포트
        </button>
      </div>

      {tab === 'blog' ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>준비 중입니다.</p>
      ) : (
        <HealthReportTab />
      )}
    </div>
  );
}
