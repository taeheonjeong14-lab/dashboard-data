'use client';

/**
 * 블로그 글 검수 결과 표시 — 위저드(내부)·admin 메뉴(외부) 공용.
 * 신호등(스캔) + findings(행동) + SEO 지표 스트립 + "평가 기준 보기" 드로어.
 * 기준·라벨은 @dashboard/blog-review-rubric 단일 소스에서 렌더(코드=화면 일치).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
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
  type SeoMetric,
} from '@dashboard/blog-review-rubric';

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

function FindingCard({ f }: { f: Finding }) {
  const color = f.severity === 'high' ? '#e5484d' : f.severity === 'medium' ? '#f5a623' : 'var(--text-muted)';
  const item = rubricItem(f.rubricId);
  return (
    <div style={{ ...card, borderLeft: `3px solid ${color}`, padding: '11px 13px' }}>
      {/* 헤더: 심각도 · 합의도 · 항목 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
        <span style={badge(color)}>{SEV_LABEL[f.severity] ?? f.severity}</span>
        <span style={badge('var(--border-strong)')}>{f.agreement} 동의</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{item ? `${item.id} ${item.label}` : f.rubricId}</span>
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

function Collapsible({ items }: { items: Finding[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
        참고 {items.length}건 (단일 모델만 지적) {open ? '▾' : '▸'}
      </button>
      {open ? <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>{items.map((f, i) => <FindingCard key={i} f={f} />)}</div> : null}
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
          {MEDICAL_ITEMS.map((m) => <li key={m.id} style={{ marginBottom: 3 }}><b>{m.id} {m.label}</b> — {m.shortDesc}</li>)}
        </ul>

        <h4 style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>네이버 SEO 항목</h4>
        <ul style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, paddingLeft: 18, margin: 0, listStyleType: 'disc' }}>
          {SEO_ITEMS.map((s) => <li key={s.id} style={{ marginBottom: 3 }}><b>{s.id} {s.label}</b> — {s.shortDesc}</li>)}
        </ul>

        <h4 style={{ fontSize: 13, fontWeight: 800, margin: '14px 0 6px' }}>결정적 목표값</h4>
        <ul style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, paddingLeft: 18, margin: 0, listStyleType: 'disc' }}>
          {METRIC_SPECS.map((m) => <li key={m.key} style={{ marginBottom: 3 }}><b>{m.label}</b>: {m.target}</li>)}
        </ul>
      </div>
    </div>
  );
}

export default function AdminBlogReviewResult({ review }: { review: BlogReview }) {
  const [drawer, setDrawer] = useState(false);
  const { medical, seo } = review;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* 한눈에 */}
      <div style={{ ...card, background: 'var(--bg-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <LightChip axis="의학" light={medical.light} />
            <LightChip axis="네이버" light={seo.light} />
            {review.gated ? <span style={{ ...badge('#e5484d'), fontSize: 12, padding: '4px 10px' }}>⚠ 게시 전 수정 필요</span> : null}
          </div>
          <button type="button" onClick={() => setDrawer(true)} style={{ fontSize: 12.5, fontWeight: 600, padding: '5px 11px', borderRadius: 8, border: '1px solid var(--border-strong)', background: '#fff', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            평가 기준 ⓘ
          </button>
        </div>
        {review.summary ? <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 10, lineHeight: 1.5 }}>{review.summary}</div> : null}
        {review.modelsUsed?.length ? <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>사용 모델: {review.modelsUsed.join(' · ')}</div> : null}
      </div>

      {/* 의학 */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Dot light={medical.light} /> 의학적 정확성
        </div>
        {medical.consensus.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>합의된 지적 없음.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>{medical.consensus.map((f, i) => <FindingCard key={i} f={f} />)}</div>
        )}
        <Collapsible items={medical.lowConfidence} />
      </section>

      {/* SEO */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Dot light={seo.light} /> 네이버 블로그 최적화
        </div>
        <div style={{ marginBottom: 10 }}><MetricStrip metrics={seo.metrics} /></div>
        {seo.consensus.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>합의된 지적 없음.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>{seo.consensus.map((f, i) => <FindingCard key={i} f={f} />)}</div>
        )}
        <Collapsible items={seo.lowConfidence} />
      </section>

      {drawer ? <CriteriaDrawer onClose={() => setDrawer(false)} /> : null}
    </div>
  );
}
