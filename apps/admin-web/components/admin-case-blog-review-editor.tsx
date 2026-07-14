'use client';

/**
 * 진료케이스 위저드 4단계 — 글 검수 편집기.
 * 3단계에서 쓴 글을 그대로 펼쳐 보여주고, 검수 지적을 글 안에 하이라이트한다.
 * 하이라이트를 누르면 그 자리에 카드가 열리고 거기서 바로 고친다:
 *   · 수정 수락 — AI 가 그 지적만 반영해 해당 섹션(또는 제목·태그)을 다시 씀
 *   · 수기 수정 — 그 섹션(또는 제목·태그)을 직접 편집
 * 3단계로 되돌아갔다 오지 않아도 되도록, 확정은 이 화면에서 한다(모달 푸터).
 * 고친 뒤 재검수는 하지 않는다 — 검수 1회를 꼼꼼히 보는 대신 토큰을 아끼는 설계.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { rubricItem, type BlogReview, type Finding } from '@dashboard/blog-review-rubric';
import { buildAnnotations, findQuote, sevColor, topSeverity } from '@/components/admin-blog-review-result';
import { parseBlogSections, rebuildBlogMarkdown, type BlogSection } from '@/lib/blog-sections';

export type ReviewBlog = { title: string; bodyMarkdown: string; tags: string[]; charCount: number };

/** 지적이 붙는 자리. body=본문 섹션 / title=제목 / tags=태그 / global=특정 위치 없음(분량·이미지 수 등) */
type AnchorKind = 'body' | 'title' | 'tags' | 'global';
type Keyed = Finding & { key: string };

const SEV_LABEL: Record<string, string> = { high: '높음', medium: '중간', low: '낮음' };
const card: CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' };
const cardBox: CSSProperties = { ...card, padding: '14px 16px' };
const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14, lineHeight: 1.6, color: 'var(--text)',
  background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const smallBtn: CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6,
  background: '#fff', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', cursor: 'pointer',
};
const acceptBtn: CSSProperties = { ...smallBtn, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' };

/** 지적이 제목/태그를 가리키는지 — 부재형(quote 없음) 지적을 가장 관계 깊은 자리에 붙이기 위한 판정. */
function anchorOf(f: Finding, title: string, bodyText: string): AnchorKind {
  if (f.quote && findQuote(bodyText, f.quote)) return 'body';
  if (f.quote && findQuote(title, f.quote)) return 'title';
  const text = `${f.issue} ${f.suggestion}`;
  if (f.rubricId === 'S1' || /제목/.test(text)) return 'title';
  if (/태그|해시태그/.test(text)) return 'tags';
  return 'global';
}

/** AI 에 넘길 수정 요청문 — 이 지적 하나만 반영하고 나머지는 유지하도록 못 박는다. */
function feedbackOf(f: Finding): string {
  const item = rubricItem(f.rubricId);
  return [
    `검수 지적 (${item ? item.label : f.rubricId} · 심각도 ${SEV_LABEL[f.severity] ?? f.severity}): ${f.issue}`,
    f.suggestion ? `개선 제안: ${f.suggestion}` : '',
    f.quote ? `문제가 된 부분: "${f.quote}"` : '',
    '',
    '이 지적만 반영해 고치고, 나머지 내용·사실·수치는 그대로 유지하세요.',
  ].filter(Boolean).join('\n');
}

/** 지적 카드 — 하이라이트를 누르면 그 자리 아래에 열린다. */
function FindingActionCard({
  f, resolved, busy, onAccept, onManual, onClose, acceptable,
}: {
  f: Finding;
  resolved: boolean;
  busy: boolean;
  onAccept: () => void;
  onManual: () => void;
  onClose: () => void;
  acceptable: boolean;
}) {
  const color = sevColor(f.severity);
  const item = rubricItem(f.rubricId);
  return (
    <div style={{ ...card, borderLeft: `3px solid ${color}`, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, border: `1px solid ${color}`, color }}>
          {SEV_LABEL[f.severity] ?? f.severity}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>{item ? item.label : f.rubricId}</span>
        {resolved ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>수정됨</span> : null}
        <button type="button" onClick={onClose} style={{ ...smallBtn, marginLeft: 'auto', padding: '2px 8px' }}>닫기</button>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text)' }}>{f.issue}</div>
      {f.suggestion ? (
        <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--accent)', fontWeight: 600, marginTop: 5 }}>→ {f.suggestion}</div>
      ) : null}
      {f.evidence ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>근거: {f.evidence}</div>
      ) : null}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        {acceptable ? (
          <button type="button" style={acceptBtn} onClick={onAccept} disabled={busy}>
            {busy ? '수정 중…' : '수정 수락'}
          </button>
        ) : null}
        <button type="button" style={smallBtn} onClick={onManual} disabled={busy}>수기 수정</button>
      </div>
    </div>
  );
}

/** 하이라이트된 본문 — 지적 span 을 심각도 색으로 칠하고, 클릭하면 그 지적을 연다. */
function HighlightedText({
  text, findings, openKey, onOpen, resolved,
}: {
  text: string;
  findings: Keyed[];
  openKey: string | null;
  onOpen: (key: string) => void;
  resolved: Set<string>;
}) {
  const { annos } = useMemo(() => buildAnnotations(text, findings), [text, findings]);
  if (!text.trim()) return <span style={{ color: 'var(--text-muted)' }}>(비어 있음)</span>;

  const nodes: React.ReactNode[] = [];
  let cur = 0;
  annos.forEach((a, i) => {
    if (a.start > cur) nodes.push(<span key={`t${i}`}>{text.slice(cur, a.start)}</span>);
    const keyed = a.findings as Keyed[];
    const allResolved = keyed.every((f) => resolved.has(f.key));
    const color = allResolved ? 'var(--success)' : sevColor(topSeverity(a.findings));
    const open = keyed.some((f) => f.key === openKey);
    nodes.push(
      <mark
        key={`m${i}`}
        onClick={() => onOpen(keyed[0].key)}
        title={allResolved ? '수정됨' : '눌러서 수정'}
        style={{
          background: allResolved ? 'transparent' : `${color}${open ? '55' : '2e'}`,
          borderBottom: `2px solid ${color}`,
          borderRadius: 2, padding: '1px 0', cursor: 'pointer', color: 'inherit',
          textDecoration: allResolved ? 'none' : undefined,
        }}
      >
        {text.slice(a.start, a.end)}
      </mark>,
    );
    cur = a.end;
  });
  if (cur < text.length) nodes.push(<span key="tail">{text.slice(cur)}</span>);
  return <>{nodes}</>;
}

export default function CaseBlogReviewEditor({
  review, blog, setField, regenerateSection, regenerateMeta, confirmed,
}: {
  review: BlogReview;
  blog: ReviewBlog;
  setField: <K extends keyof ReviewBlog>(k: K, v: ReviewBlog[K]) => void;
  /** 섹션 하나를 지적 반영해 AI 로 다시 쓴다. 실패 시 null. */
  regenerateSection: (args: { heading: string; body: string; feedback: string }) => Promise<{ heading: string; body: string } | null>;
  /** 제목·태그를 지적 반영해 AI 로 고친다. 실패 시 null. */
  regenerateMeta: (feedback: string) => Promise<{ title: string; tags: string[] } | null>;
  confirmed: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<{ index: number; heading: string; body: string } | null>(null); // 수기 수정 중인 섹션
  const [metaEdit, setMetaEdit] = useState(false); // 제목·태그 수기 수정

  const sections = useMemo(() => parseBlogSections(blog.bodyMarkdown), [blog.bodyMarkdown]);

  // 합의(2/3+) + 단일 모델(1/3) 모두 표시한다 — 4단계는 '고칠 거리'를 빠짐없이 보는 화면.
  const all: Keyed[] = useMemo(() => {
    const list = [
      ...(review.medical.consensus ?? []), ...(review.medical.lowConfidence ?? []),
      ...(review.seo.consensus ?? []), ...(review.seo.lowConfidence ?? []),
    ];
    return list.map((f, i) => ({ ...f, key: `f${i}` }));
  }, [review]);

  // 지적을 붙을 자리별로 나눈다. 본문 지적은 다시 섹션별로.
  const { byAnchor, bySection } = useMemo(() => {
    const byAnchor: Record<AnchorKind, Keyed[]> = { body: [], title: [], tags: [], global: [] };
    for (const f of all) byAnchor[anchorOf(f, blog.title, blog.bodyMarkdown)].push(f);
    const bySection = new Map<number, Keyed[]>();
    for (const f of byAnchor.body) {
      // 인용문이 들어 있는 섹션을 찾는다. 못 찾으면(섹션 경계에 걸친 경우 등) 첫 섹션에 붙인다.
      const idx = sections.findIndex((s) => (f.quote ? findQuote(s.body, f.quote) : null) != null);
      const at = idx >= 0 ? idx : 0;
      bySection.set(at, [...(bySection.get(at) ?? []), f]);
    }
    return { byAnchor, bySection };
  }, [all, blog.title, blog.bodyMarkdown, sections]);

  const applySection = (index: number, next: BlogSection) => {
    setField('bodyMarkdown', rebuildBlogMarkdown(sections.map((s, j) => (j === index ? next : s))));
  };

  async function acceptSection(index: number, f: Keyed) {
    const sec = sections[index];
    if (!sec || busyKey) return;
    setBusyKey(f.key);
    const res = await regenerateSection({ heading: sec.heading, body: sec.body, feedback: feedbackOf(f) });
    if (res) {
      applySection(index, res);
      setResolved((prev) => new Set(prev).add(f.key));
      setOpenKey(null);
    }
    setBusyKey(null);
  }

  async function acceptMeta(f: Keyed) {
    if (busyKey) return;
    setBusyKey(f.key);
    const res = await regenerateMeta(feedbackOf(f));
    if (res) {
      if (res.title.trim()) setField('title', res.title.trim());
      if (res.tags.length) setField('tags', res.tags);
      setResolved((prev) => new Set(prev).add(f.key));
      setOpenKey(null);
    }
    setBusyKey(null);
  }

  const cardFor = (f: Keyed, opts: { onAccept: () => void; onManual: () => void; acceptable?: boolean }) =>
    openKey === f.key ? (
      <FindingActionCard
        key={f.key}
        f={f}
        resolved={resolved.has(f.key)}
        busy={busyKey === f.key}
        acceptable={opts.acceptable !== false && !confirmed}
        onAccept={opts.onAccept}
        onManual={opts.onManual}
        onClose={() => setOpenKey(null)}
      />
    ) : null;

  const legendDot = (c: string, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: `${c}2e`, borderBottom: `2px solid ${c}` }} /> {label}
    </span>
  );

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {legendDot('#e5484d', '높음')}{legendDot('#f5a623', '중간')}{legendDot('#8a8f98', '낮음')}
        <span>· 하이라이트를 누르면 그 자리에서 수정할 수 있습니다{confirmed ? ' (확정됨 — 수기 수정만 가능)' : ''}</span>
      </div>

      {/* 제목 — 제목 지적(지역 키워드 없음 등)은 여기에 붙는다 */}
      <div style={cardBox}>
        {metaEdit ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <input value={blog.title} onChange={(e) => setField('title', e.target.value)} placeholder="제목" style={{ ...inputStyle, fontSize: 20, fontWeight: 800 }} />
            <input
              value={blog.tags.join(', ')}
              onChange={(e) => setField('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
              placeholder="태그 (쉼표로 구분)"
              style={inputStyle}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" style={smallBtn} onClick={() => setMetaEdit(false)}>편집 완료</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.4 }}>
              {byAnchor.title.length ? (
                <mark
                  onClick={() => setOpenKey(byAnchor.title[0].key)}
                  title="눌러서 수정"
                  style={{
                    background: byAnchor.title.every((f) => resolved.has(f.key)) ? 'transparent' : `${sevColor(topSeverity(byAnchor.title))}2e`,
                    borderBottom: `2px solid ${byAnchor.title.every((f) => resolved.has(f.key)) ? 'var(--success)' : sevColor(topSeverity(byAnchor.title))}`,
                    cursor: 'pointer', color: 'inherit',
                  }}
                >
                  {blog.title || '(제목 없음)'}
                </mark>
              ) : (blog.title || '(제목 없음)')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {blog.tags.map((t) => (
                <span key={t} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px' }}>#{t}</span>
              ))}
              {byAnchor.tags.length ? (
                <button
                  type="button"
                  onClick={() => setOpenKey(byAnchor.tags[0].key)}
                  style={{ ...smallBtn, borderColor: sevColor(topSeverity(byAnchor.tags)), color: sevColor(topSeverity(byAnchor.tags)) }}
                >
                  태그 지적 {byAnchor.tags.length}
                </button>
              ) : null}
            </div>
          </>
        )}
        {[...byAnchor.title, ...byAnchor.tags].map((f) =>
          cardFor(f, { onAccept: () => void acceptMeta(f), onManual: () => { setMetaEdit(true); setOpenKey(null); } }),
        )}
      </div>

      {/* 본문 — 섹션별 카드. 지적은 해당 섹션 안에 하이라이트되고, 카드도 그 섹션 아래에 열린다. */}
      {sections.map((sec, i) => {
        const fs = bySection.get(i) ?? [];
        const editing = draft?.index === i;
        return (
          <div key={i} style={cardBox}>
            {editing ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <input value={draft.heading} onChange={(e) => setDraft({ ...draft, heading: e.target.value })} placeholder="섹션 제목" style={{ ...inputStyle, fontWeight: 800, color: 'var(--accent)' }} />
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={12} style={{ ...inputStyle, resize: 'vertical' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button type="button" style={smallBtn} onClick={() => setDraft(null)}>취소</button>
                  <button type="button" style={acceptBtn} onClick={() => { applySection(i, { heading: draft.heading, body: draft.body }); setDraft(null); }}>수정 반영</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)' }}>{sec.heading || '(섹션명 없음)'}</span>
                  <button type="button" style={{ ...smallBtn, marginLeft: 'auto' }} onClick={() => setDraft({ index: i, heading: sec.heading, body: sec.body })}>수기 수정</button>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.95, fontSize: 14, color: 'var(--text)' }}>
                  <HighlightedText text={sec.body} findings={fs} openKey={openKey} onOpen={setOpenKey} resolved={resolved} />
                </div>
              </>
            )}
            {fs.map((f) =>
              cardFor(f, {
                onAccept: () => void acceptSection(i, f),
                onManual: () => { setDraft({ index: i, heading: sec.heading, body: sec.body }); setOpenKey(null); },
              }),
            )}
          </div>
        );
      })}

      {/* 특정 위치가 없는 지적(분량·이미지 수·구성 등) — 글 전체에 해당하므로 목록으로 */}
      {byAnchor.global.length ? (
        <div style={cardBox}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 8 }}>글 전체 지적</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {byAnchor.global.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setOpenKey(openKey === f.key ? null : f.key)}
                style={{ ...smallBtn, width: '100%', justifyContent: 'flex-start', textAlign: 'left', padding: '7px 10px', fontWeight: 600, borderLeft: `3px solid ${resolved.has(f.key) ? 'var(--success)' : sevColor(f.severity)}` }}
              >
                {f.issue}
              </button>
            ))}
          </div>
          {byAnchor.global.map((f) =>
            cardFor(f, {
              // 위치를 특정할 수 없어 AI 자동 수정 대상이 아니다 — 어느 섹션을 고쳐야 할지 알 수 없기 때문.
              acceptable: false,
              onAccept: () => {},
              onManual: () => { setOpenKey(null); setDraft({ index: 0, heading: sections[0]?.heading ?? '', body: sections[0]?.body ?? '' }); },
            }),
          )}
        </div>
      ) : null}

    </div>
  );
}
