'use client';

/**
 * 블로그 글 검수 결과 표시 — 위저드(내부)·admin 메뉴(외부) 공용.
 * 신호등(스캔) + findings(행동) + SEO 지표 스트립 + "평가 기준 보기" 드로어.
 * 기준·라벨은 @dashboard/blog-review-rubric 단일 소스에서 렌더(코드=화면 일치).
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  MEDICAL_ITEMS,
  METRIC_SPECS,
  SEO_ITEMS,
  SEVERITY_DEFS,
  lightLabel,
  rubricItem,
  type BlogReview,
  type Finding,
  type Light,
  type MetricStatus,
  type ReviewerBreakdown,
  type ReviewerFinding,
  type SeoMetric,
} from '@dashboard/blog-review-rubric';

/** provider/model 슬러그에서 표시용 짧은 이름(뒤 절반). */
function shortModel(model: string): string {
  const i = model.indexOf('/');
  return i >= 0 ? model.slice(i + 1) : model;
}

/** 칩용 더 짧은 이름 — 버전 꼬리를 떼어 계열만("claude-haiku-4.5" → "claude-haiku"). */
function modelChipLabel(model: string): string {
  return shortModel(model).replace(/[-_]?\d.*$/, '') || shortModel(model);
}

const LIGHT_COLOR: Record<Light, string> = { red: '#e5484d', yellow: '#f5a623', green: '#30a46c' };
const STATUS_COLOR: Record<MetricStatus, string> = { poor: '#e5484d', warn: '#f5a623', good: '#30a46c' };
const SEV_LABEL: Record<string, string> = { high: '높음', medium: '중간', low: '낮음' };

const card: CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' };

function Dot({ light }: { light: Light }) {
  return <span style={{ width: 10, height: 10, borderRadius: 999, background: LIGHT_COLOR[light], display: 'inline-block' }} />;
}

function LightChip({ axis, light }: { axis: string; light: Light }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 999, border: `1px solid ${LIGHT_COLOR[light]}`, background: `${LIGHT_COLOR[light]}14`, fontSize: 13, fontWeight: 700, color: LIGHT_COLOR[light] }}>
      <Dot light={light} />
      {axis} {lightLabel(light)}
    </span>
  );
}

function badge(color: string): CSSProperties {
  return { fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, border: `1px solid ${color}`, color, whiteSpace: 'nowrap' };
}

const fieldLabelStyle: CSSProperties = { fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', whiteSpace: 'nowrap', paddingTop: 2, letterSpacing: '-0.01em' };

/** 라벨(원문/문제점/…) + 값. grid(auto 1fr) 안에서 2칸을 차지하도록 Fragment 로 반환. */
function Field({ label, children, valueStyle }: { label: string; children: ReactNode; valueStyle?: CSSProperties }) {
  return (
    <>
      <span style={fieldLabelStyle}>{label}</span>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text)', ...valueStyle }}>{children}</div>
    </>
  );
}

/** 이 지적을 낸 모델들(집계가 알려준 것). 모델별 상세에서 쓰는 원본 finding 엔 없다. */
function ModelChips({ models }: { models?: string[] }) {
  if (!models?.length) return null;
  return (
    <>
      {models.map((m) => (
        <span
          key={m}
          title={m}
          style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'var(--bg-subtle)', color: 'var(--text-muted)', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}
        >
          {modelChipLabel(m)}
        </span>
      ))}
    </>
  );
}

function FindingCard({ f }: { f: ReviewerFinding & Partial<Pick<Finding, 'models'>> }) {
  const color = f.severity === 'high' ? '#e5484d' : f.severity === 'medium' ? '#f5a623' : 'var(--text-muted)';
  const item = rubricItem(f.rubricId);
  return (
    <div style={{ ...card, borderLeft: `3px solid ${color}`, padding: '11px 13px' }}>
      {/* 헤더: 심각도 · 항목 · 지적한 모델 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
        <span style={badge(color)}>{SEV_LABEL[f.severity] ?? f.severity}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{item ? item.label : f.rubricId}</span>
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <ModelChips models={f.models} />
        </span>
      </div>
      {/* 라벨링된 본문 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 7, alignItems: 'start' }}>
        {f.quote ? (
          <Field label="원문">
            <span style={{ background: 'var(--bg-subtle)', borderRadius: 6, padding: '3px 8px', display: 'inline-block', color: 'var(--text-secondary)' }}>“{f.quote}”</span>
          </Field>
        ) : null}
        <Field label="문제점">{f.issue}</Field>
        {f.suggestion ? <Field label="개선 제안" valueStyle={{ color: 'var(--accent)', fontWeight: 600 }}>{f.suggestion}</Field> : null}
        {f.evidence ? <Field label="근거" valueStyle={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{f.evidence}</Field> : null}
      </div>
    </div>
  );
}

function MetricStrip({ metrics }: { metrics: SeoMetric[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {metrics.map((m) => (
        <div key={m.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff' }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: STATUS_COLOR[m.status] }} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{m.label}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{m.value}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/ {m.target}</span>
        </div>
      ))}
    </div>
  );
}

/** 모델별 상세 — 각 모델이 낸 원본 findings 를 축(medical/seo)별로 펼쳐 본다. */
function ModelBreakdown({ reviewers, axis }: { reviewers: ReviewerBreakdown[]; axis: 'medical' | 'seo' }) {
  const [open, setOpen] = useState(false);
  if (!reviewers.length) return null;
  const pick = (r: ReviewerBreakdown) => (axis === 'medical' ? r.medical : r.seo);
  const total = reviewers.reduce((n, r) => n + pick(r).length, 0);
  if (total === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
        모델별 상세 {open ? '▾' : '▸'}
      </button>
      {open ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 6 }}>
          {reviewers.map((r) => {
            const items = pick(r);
            return (
              <div key={r.model}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 5, borderBottom: '1px solid var(--border)', paddingBottom: 3 }}>
                  {shortModel(r.model)}
                </div>
                {items.length ? (
                  <div style={{ display: 'grid', gap: 8 }}>{items.map((f, i) => <FindingCard key={i} f={f} />)}</div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>지적 없음</div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CriteriaDrawer({ onClose }: { onClose: () => void }) {
  const sevRow = (k: 'high' | 'medium' | 'low') => (
    <li style={{ marginBottom: 3 }}><b>{SEV_LABEL[k]}</b>: {SEVERITY_DEFS[k]}</li>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ width: 'min(460px, 94vw)', height: '100%', background: 'var(--bg)', overflowY: 'auto', padding: '18px 20px', boxShadow: '-8px 0 30px rgba(0,0,0,0.15)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>평가 기준</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 0 }}>
          Claude·Grok·Gemini 3개 모델이 각각 검수한 뒤 공통된 지적을 취합합니다(합의도 3/3·2/3·1/3). 단일 모델만 지적한 건 &apos;참고&apos;로 분리됩니다.
        </p>

        <h4 style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>신호등</h4>
        <ul style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, paddingLeft: 18, margin: 0, listStyleType: 'disc' }}>
          <li><b style={{ color: LIGHT_COLOR.red }}>미흡(빨강)</b> — 의학: 합의된 &apos;틀린 내용&apos;(사실·의학·안전 오류) → 게시 전 수정. SEO: 치명 지표(분량 급부족·이미지 0·제목 키워드 없음) 등.</li>
          <li><b style={{ color: LIGHT_COLOR.yellow }}>주의(노랑)</b> — 다듬을 것(과장·오해·불명확).</li>
          <li><b style={{ color: LIGHT_COLOR.green }}>양호(초록)</b> — 지적 없음.</li>
        </ul>

        <h4 style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>의학 심각도</h4>
        <ul style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, paddingLeft: 18, margin: 0, listStyleType: 'disc' }}>
          {sevRow('high')}{sevRow('medium')}{sevRow('low')}
        </ul>

        <h4 style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>의학 항목</h4>
        <ul style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, paddingLeft: 18, margin: 0, listStyleType: 'disc' }}>
          {MEDICAL_ITEMS.map((m) => <li key={m.id} style={{ marginBottom: 3 }}><b>{m.label}</b> — {m.shortDesc}</li>)}
        </ul>

        <h4 style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>네이버 SEO 항목</h4>
        <ul style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, paddingLeft: 18, margin: 0, listStyleType: 'disc' }}>
          {SEO_ITEMS.map((s) => <li key={s.id} style={{ marginBottom: 3 }}><b>{s.label}</b> — {s.shortDesc}</li>)}
        </ul>

        <h4 style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>결정적 목표값</h4>
        <ul style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, paddingLeft: 18, margin: 0, listStyleType: 'disc' }}>
          {METRIC_SPECS.map((m) => <li key={m.key} style={{ marginBottom: 3 }}><b>{m.label}</b>: {m.target}</li>)}
        </ul>
      </div>
    </div>
  );
}

function SectionHeader({ light, title }: { light: Light; title: string }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
      <Dot light={light} /> {title}
    </div>
  );
}

function ConsensusList({ items }: { items: ReviewerFinding[] }) {
  if (items.length === 0) return <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>공통된 지적 없음.</div>;
  return <div style={{ display: 'grid', gap: 8 }}>{items.map((f, i) => <FindingCard key={i} f={f} />)}</div>;
}

function MedicalSection({ medical, reviewers }: { medical: BlogReview['medical']; reviewers: ReviewerBreakdown[] }) {
  return (
    <section>
      <SectionHeader light={medical.light} title="의학적 정확성" />
      <ConsensusList items={medical.consensus} />
      <ModelBreakdown reviewers={reviewers} axis="medical" />
    </section>
  );
}

function SeoSection({ seo, reviewers }: { seo: BlogReview['seo']; reviewers: ReviewerBreakdown[] }) {
  return (
    <section>
      <SectionHeader light={seo.light} title="네이버 블로그 최적화" />
      <div style={{ marginBottom: 10 }}><MetricStrip metrics={seo.metrics} /></div>
      <ConsensusList items={seo.consensus} />
      <ModelBreakdown reviewers={reviewers} axis="seo" />
    </section>
  );
}

/** 상단 요약 바 — 두 신호등 + 게시 부적합 + 총평 + 평가 기준 버튼. */
function SummaryBar({ review, onCriteria }: { review: BlogReview; onCriteria: () => void }) {
  return (
    <div style={{ ...card, background: 'var(--bg-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <LightChip axis="의학" light={review.medical.light} />
          <LightChip axis="네이버" light={review.seo.light} />
          {review.gated ? <span style={{ ...badge('#e5484d'), fontSize: 12, padding: '4px 10px' }}>⚠ 게시 전 수정 필요</span> : null}
        </div>
        <button type="button" onClick={onCriteria} style={{ fontSize: 12.5, fontWeight: 600, padding: '5px 11px', borderRadius: 8, border: '1px solid var(--border-strong)', background: '#fff', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          평가 기준 ⓘ
        </button>
      </div>
      {review.summary ? <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 10, lineHeight: 1.5 }}>{review.summary}</div> : null}
      {review.modelsUsed?.length ? <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>사용 모델: {review.modelsUsed.join(' · ')}</div> : null}
    </div>
  );
}

/**
 * 검수 결과. columns=true 면 좌(의학)/우(SEO) 2컬럼(글 검수 메뉴 — 넓은 화면),
 * false 면 세로 스택(위저드 모달 — 좁은 우측 패널).
 */
export default function AdminBlogReviewResult({ review, columns = false }: { review: BlogReview; columns?: boolean }) {
  const [drawer, setDrawer] = useState(false);
  const { medical, seo } = review;

  const sectionsWrap: CSSProperties = columns
    ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20, alignItems: 'start' }
    : { display: 'grid', gap: 14 };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <SummaryBar review={review} onCriteria={() => setDrawer(true)} />

      <div style={sectionsWrap}>
        <MedicalSection medical={medical} reviewers={review.reviewers ?? []} />
        <SeoSection seo={seo} reviewers={review.reviewers ?? []} />
      </div>

      {drawer ? <CriteriaDrawer onClose={() => setDrawer(false)} /> : null}
    </div>
  );
}

// ── 하이라이트(인라인 주석) 뷰 — 글 검수 메뉴용 ──────────────────────────────
function sevColor(sev: string): string {
  return sev === 'high' ? '#e5484d' : sev === 'medium' ? '#f5a623' : '#8a8f98';
}
const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
function topSeverity(fs: Finding[]): string {
  return fs.reduce((s, f) => (SEV_RANK[f.severity] > (SEV_RANK[s] ?? 0) ? f.severity : s), 'low');
}
type Anno = { start: number; end: number; findings: Finding[] };

/** 공백 무시 정규화로 quote 의 본문 내 위치를 찾는다(정확 매칭 실패 시). */
function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const q = (quote ?? '').trim();
  if (!q) return null;
  const direct = text.indexOf(q);
  if (direct !== -1) return { start: direct, end: direct + q.length };
  const strip = q.replace(/\s+/g, '');
  if (strip.length < 4) return null;
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) { norm += text[i]; map.push(i); }
  }
  const ni = norm.indexOf(strip);
  if (ni === -1) return null;
  return { start: map[ni], end: map[ni + strip.length - 1] + 1 };
}

/** 의학 findings 를 본문 span 으로 매핑. 못 찾은 건 unmatched. */
function buildAnnotations(text: string, findings: Finding[]): { annos: Anno[]; unmatched: Finding[] } {
  const annos: Anno[] = [];
  const unmatched: Finding[] = [];
  for (const f of findings) {
    const pos = f.quote ? findQuote(text, f.quote) : null;
    if (!pos) { unmatched.push(f); continue; }
    const overlap = annos.find((a) => pos.start < a.end && pos.end > a.start);
    if (overlap) {
      overlap.findings.push(f);
      overlap.start = Math.min(overlap.start, pos.start);
      overlap.end = Math.max(overlap.end, pos.end);
    } else {
      annos.push({ start: pos.start, end: pos.end, findings: [f] });
    }
  }
  annos.sort((a, b) => a.start - b.start);
  return { annos, unmatched };
}

/**
 * 하이라이트 뷰: 본문 전체를 보여주고 의학 지적 문장을 심각도 색으로 하이라이트,
 * 커서를 올리면 상세 카드. 우측엔 네이버 SEO(지표 + 불렛). 글 검수 메뉴 전용.
 */
export function AnnotatedBlogReview({ review, title, bodyText }: { review: BlogReview; title: string; bodyText: string }) {
  const [drawer, setDrawer] = useState(false);
  const [hover, setHover] = useState<{ findings: Finding[]; top: number; left: number } | null>(null);

  // 합의(2/3+) + 단일 모델(1/3) 모두 하이라이트한다(의학 '주의'는 대개 단일 모델 지적).
  const medicalAll = useMemo(
    () => [...(review.medical.consensus ?? []), ...(review.medical.lowConfidence ?? [])],
    [review.medical],
  );
  const seoAll = useMemo(
    () => [...(review.seo.consensus ?? []), ...(review.seo.lowConfidence ?? [])],
    [review.seo],
  );
  const { annos, unmatched } = useMemo(
    () => buildAnnotations(bodyText ?? '', medicalAll),
    [bodyText, medicalAll],
  );

  const nodes: ReactNode[] = [];
  let cur = 0;
  annos.forEach((a, i) => {
    if (a.start > cur) nodes.push(<span key={`t${i}`}>{bodyText.slice(cur, a.start)}</span>);
    const color = sevColor(topSeverity(a.findings));
    nodes.push(
      <mark
        key={`m${i}`}
        style={{ background: `${color}2e`, borderBottom: `2px solid ${color}`, borderRadius: 2, padding: '1px 0', cursor: 'help', color: 'inherit' }}
        onMouseEnter={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setHover({ findings: a.findings, top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 380)) });
        }}
        onMouseLeave={() => setHover(null)}
      >
        {bodyText.slice(a.start, a.end)}
      </mark>,
    );
    cur = a.end;
  });
  if (cur < (bodyText?.length ?? 0)) nodes.push(<span key="tail">{bodyText.slice(cur)}</span>);

  const legendDot = (c: string, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: `${c}2e`, borderBottom: `2px solid ${c}` }} /> {label}
    </span>
  );

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <SummaryBar review={review} onCriteria={() => setDrawer(true)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 18, alignItems: 'start' }}>
        {/* 본문 + 의학 하이라이트 */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {legendDot('#e5484d', '높음')}{legendDot('#f5a623', '중간')}{legendDot('#8a8f98', '낮음')}
            <span>· 하이라이트에 커서를 올리면 상세</span>
          </div>
          {title ? <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>{title}</div> : null}
          <div style={{ ...card, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.95, fontSize: 14, color: 'var(--text)' }}>
            {nodes.length ? nodes : <span style={{ color: 'var(--text-muted)' }}>본문이 비어 있습니다.</span>}
          </div>
          {unmatched.length ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 6 }}>본문에서 위치를 특정하지 못한 지적</div>
              <div style={{ display: 'grid', gap: 8 }}>{unmatched.map((f, i) => <FindingCard key={i} f={f} />)}</div>
            </div>
          ) : null}
        </div>

        {/* 우측 네이버 SEO 패널 */}
        <aside style={{ display: 'grid', gap: 12, position: 'sticky', top: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Dot light={review.seo.light} /> 네이버 최적화
          </div>
          <div style={{ ...card, display: 'grid', gap: 7 }}>
            {review.seo.metrics.map((m) => (
              <div key={m.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                <span><b style={{ color: STATUS_COLOR[m.status] }}>{m.value}</b> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>/ {m.target}</span></span>
              </div>
            ))}
          </div>
          {seoAll.length ? (
            <ul style={{ margin: 0, paddingLeft: 16, listStyleType: 'disc', display: 'grid', gap: 7 }}>
              {seoAll.map((f, i) => (
                <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  <span style={{ color: sevColor(f.severity), fontWeight: 700 }}>{f.issue}</span>
                  {f.suggestion ? <span style={{ color: 'var(--text-muted)' }}> → {f.suggestion}</span> : null}
                  <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6, verticalAlign: 'middle' }}>
                    <ModelChips models={f.models} />
                  </span>
                </li>
              ))}
            </ul>
          ) : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>지적 없음.</div>}
        </aside>
      </div>

      {hover ? (
        <div style={{ position: 'fixed', top: hover.top, left: hover.left, zIndex: 300, width: 360, pointerEvents: 'none', display: 'grid', gap: 8 }}>
          {hover.findings.map((f, i) => <FindingCard key={i} f={f} />)}
        </div>
      ) : null}

      {drawer ? <CriteriaDrawer onClose={() => setDrawer(false)} /> : null}
    </div>
  );
}
