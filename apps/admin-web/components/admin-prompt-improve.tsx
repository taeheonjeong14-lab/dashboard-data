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
  fontSize: 14,
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

/** 카테고리 표시 순서 — 중요도 높은 것 먼저(사실 정정 → … → 사소). */
const KIND_ORDER = ['factual', 'detail', 'format', 'tone', 'trivial'];

/** 변경 항목 하나 — 겉엔 한 줄(what)만, 클릭/호버 시 '왜·프롬프트'가 펼쳐진다. */
function ChangeRow({ c }: { c: Change }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(c.reason || c.promptFix);
  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <button
        type="button"
        className="adminBtnFree"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', textAlign: 'left', display: 'flex', gap: 6, alignItems: 'center',
          padding: '7px 2px', background: 'none', border: 'none', cursor: hasDetail ? 'pointer' : 'default',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0 }}>{c.what || '(내용 없음)'}</span>
        {c.field ? <code style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{c.field}</code> : null}
        {hasDetail ? <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{open ? '▾' : '▸'}</span> : null}
      </button>
      {open && hasDetail ? (
        <div style={{ display: 'grid', gap: 4, padding: '0 2px 9px 2px' }}>
          {c.reason ? <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>왜: {c.reason}</div> : null}
          {c.promptFix ? <div style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 600, lineHeight: 1.5 }}>프롬프트: {c.promptFix}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** 한 카테고리(사실 정정 등) 박스 — 그 카테고리 항목들을 담는다. */
function KindGroup({ kind, items }: { kind: string; items: Change[] }) {
  const color = KIND_COLOR[kind] ?? 'var(--text-muted)';
  return (
    <div style={{ border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: 8, background: `${color}0a`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ ...badge(color), background: color, color: '#fff', borderColor: color }}>{KIND_LABEL[kind] || '기타'}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length}건</span>
      </div>
      <div style={{ padding: '0 12px' }}>
        {items.map((c, i) => <ChangeRow key={i} c={c} />)}
      </div>
    </div>
  );
}

/** 한 건의 분석 결과 — 변경 목록 + 프롬프트 제안 + 원문 대조(접힘). */
function DiffCard({ item, expandKey }: { item: Item; expandKey: number }) {
  const [open, setOpen] = useState(false); // 원문 대조 접힘
  const [cardOpen, setCardOpen] = useState(false); // 케이스 카드 전체 접힘(기본 접힘 — 여러 건 쌓이므로)
  // 상단 '모두 펼치기/접기'가 눌릴 때(expandKey 변화) 이 카드 상태를 그에 맞춘다.
  useEffect(() => {
    if (expandKey === 0) return;
    setCardOpen(expandKey > 0);
  }, [expandKey]);
  const r = item.result;
  const changes = r?.changes ?? [];
  const suggestions = r?.promptSuggestions ?? [];
  const raw = r?.changed ?? [];

  // 변경 항목을 카테고리(kind)별로 묶는다. 알 수 없는 kind 는 '기타'(빈 문자열)로.
  const byKind = new Map<string, Change[]>();
  for (const c of changes) {
    const k = c.kind && KIND_LABEL[c.kind] ? c.kind : '';
    byKind.set(k, [...(byKind.get(k) ?? []), c]);
  }
  const kinds = [...byKind.keys()].sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a); const ib = KIND_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return (
    <div style={{ ...card, display: 'grid', gap: cardOpen ? 10 : 0, padding: cardOpen ? '14px 16px' : '10px 16px' }}>
      {/* 헤더 = 접기/펼치기 토글. 접힌 상태에선 병원·요약만 보인다. */}
      <button
        type="button"
        className="adminBtnFree"
        onClick={() => setCardOpen((v) => !v)}
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{cardOpen ? '▾' : '▸'}</span>
        <b style={{ fontSize: 14 }}>{item.hospitalName ?? '병원 미상'}</b>
        <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.friendlyId ?? item.runId.slice(0, 8)}</code>
        <span style={badge(item.status === 'error' ? '#e5484d' : 'var(--text-muted)')}>
          {STATUS_LABEL[item.status] ?? item.status}
        </span>
        {/* 접힌 상태에서 한눈에: 변경 건수(또는 초안 그대로) */}
        {r?.noEdits ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>초안 그대로</span>
        ) : changes.length ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>변경 {changes.length}건</span>
        ) : null}
        {item.triggeredBy && cardOpen ? (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            트리거: {item.triggeredBy === 'kakao' ? '카카오 발송' : 'PDF 다운로드'}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {cardOpen ? `선택 ${fmt(item.createdAt)} · 분석 ${fmt(item.analyzedAt)}` : fmt(item.analyzedAt)}
        </span>
      </button>

      {!cardOpen ? null : (<>

      {item.error ? <div style={{ fontSize: 14, color: 'var(--danger)' }}>{item.error}</div> : null}
      {r?.summary ? <div style={{ fontSize: 14, color: 'var(--text)' }}>{r.summary}</div> : null}

      {r?.noEdits ? (
        <div style={{ fontSize: 14, color: 'var(--success)', fontWeight: 600 }}>
          병원이 초안을 그대로 발송 — 이 건은 프롬프트가 잘 맞았습니다.
        </div>
      ) : null}

      {changes.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {kinds.map((k) => <KindGroup key={k || 'etc'} kind={k} items={byKind.get(k)!} />)}
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>항목을 누르거나 커서를 올리면 상세가 열립니다.</div>
        </div>
      ) : null}

      {suggestions.length ? (
        <div style={{ background: 'var(--bg-subtle)', borderRadius: 8, padding: '9px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 5 }}>프롬프트 개선 제안</div>
          <ul style={{ margin: 0, paddingLeft: 16, listStyleType: 'disc', display: 'grid', gap: 4 }}>
            {suggestions.map((s, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.5 }}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {raw.length ? (
        <div>
          <button type="button" onClick={() => setOpen((v) => !v)} style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}>
            원문 대조 {open ? '▾' : '▸'} ({raw.length}개 필드)
          </button>
          {open ? (
            <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
              {raw.map((d, i) => (
                <div key={i} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)' }}>{d.label}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', background: '#fff5f5', borderRadius: 6, padding: '7px 9px', color: 'var(--text-secondary)' }}>
                      {d.before || '(없음)'}
                    </div>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', background: '#f2fbf6', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }}>
                      {d.after || '(삭제됨)'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      </>)}
    </div>
  );
}

function HealthReportTab() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 양수 = 모두 펼침, 음수 = 모두 접힘, 0 = 개별 제어. 값이 바뀔 때마다 카드가 반응하도록 타임스탬프를 쓴다.
  const [expandKey, setExpandKey] = useState(0);

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

  if (loading) return <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>불러오는 중…</p>;
  if (error) return <p style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</p>;
  if (!items.length) {
    return (
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        분석 대상이 없습니다. 건강검진 리포트 화면에서 <b>&lsquo;비교 분석 대상&rsquo;</b>을 켜 두면,
        병원이 카카오로 발송하거나 공유 페이지에서 PDF를 받는 시점에 초안과 최종본을 비교해 여기에 쌓입니다.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length}건</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" className="adminLegacySmallBtn" onClick={() => setExpandKey(Date.now())}>모두 펼치기</button>
          <button type="button" className="adminLegacySmallBtn" onClick={() => setExpandKey(-Date.now())}>모두 접기</button>
        </div>
      </div>
      {items.map((it) => (
        <DiffCard key={it.runId} item={it} expandKey={expandKey} />
      ))}
    </div>
  );
}

export default function AdminPromptImprove() {
  const [tab, setTab] = useState<'blog' | 'report'>('report');

  return (
    <div style={{ display: 'grid', gap: 16, paddingBottom: 32 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>프롬프트 개선</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '5px 0 0' }}>
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
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>준비 중입니다.</p>
      ) : (
        <HealthReportTab />
      )}
    </div>
  );
}
