'use client';

/**
 * 건강검진 1단계 — 검진 포인트 검토.
 * AI 가 차트·검사결과·이미지에서 뽑은 "리포트에 언급할 소견"을 카드 하나 = 포인트 하나로 보여준다.
 * 카드마다 근거(차트 본문 / 검사결과 / 이미지 판독)와 배치(장기 섹션·검사 섹션)를 표시하고, admin 이 고친다.
 * 확정해야 본문 컨텐츠 생성이 열린다 — 근거를 먼저 확정하고 그걸로 리포트를 쓰게 하기 위함.
 */
import { useState, type CSSProperties } from 'react';

export type HealthPointBasis = 'chart' | 'lab' | 'image';
export type HealthPoint = {
  id: string;
  text: string;
  basis: HealthPointBasis;
  evidence: string;
  organs: string[];
  examSections: string[];
  inOverall: boolean;
};

/** 장기 섹션 키 → 라벨 (chart-api HEALTH_CHECKUP_ORGAN_SPECS 와 같은 순서·이름). */
export const ORGAN_LABEL: Record<string, string> = {
  circ: '순환기&호흡기',
  digest: '소화기',
  endo: '내분비계',
  renal_uro: '신장 및 비뇨기계',
  hepatobiliary: '간담도계',
  msk: '근골격계',
  dental: '치과 및 안과',
  skin: '피부·외이도',
};
export const EXAM_LABEL: Record<string, string> = {
  lab: '혈액검사 해석',
  systems4: '치과·피부 이미지',
  systems5: '방사선·초음파',
};

const BASIS_META: Record<HealthPointBasis, { label: string; color: string; bg: string }> = {
  chart: { label: '차트 본문', color: '#0f766e', bg: '#ccfbf1' },
  lab: { label: '검사결과', color: '#1d4ed8', bg: '#dbeafe' },
  image: { label: '이미지 판독 (AI)', color: '#b45309', bg: '#fef3c7' },
};

const card: CSSProperties = { border: '1px solid var(--border)', borderRadius: 10, background: '#fff', padding: '12px 14px' };
const chip = (on: boolean): CSSProperties => ({
  padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
  background: on ? 'var(--accent-subtle)' : '#fff',
  color: on ? 'var(--accent)' : 'var(--text-secondary)',
});
const input: CSSProperties = {
  width: '100%', padding: '7px 9px', fontSize: 14, lineHeight: 1.6, color: 'var(--text)',
  background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 8, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const smallBtn: CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6,
  background: '#fff', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)', cursor: 'pointer',
};

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function PointCard({
  point, index, onChange, onRemove, disabled,
}: {
  point: HealthPoint;
  index: number;
  onChange: (next: HealthPoint) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false); // 근거 원문 펼치기
  const meta = BASIS_META[point.basis];

  return (
    <div style={{ ...card, borderLeft: `3px solid ${meta.color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>#{index + 1}</span>
        {/* 근거 유형 — 리포트 검토에서 가장 먼저 봐야 할 정보라 항상 앞에 둔다 */}
        {(Object.keys(BASIS_META) as HealthPointBasis[]).map((b) => (
          <button
            key={b}
            type="button"
            className="adminBtnFree"
            disabled={disabled}
            onClick={() => onChange({ ...point, basis: b })}
            style={{
              padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 999, cursor: disabled ? 'default' : 'pointer',
              border: `1px solid ${point.basis === b ? BASIS_META[b].color : 'var(--border-strong)'}`,
              background: point.basis === b ? BASIS_META[b].bg : '#fff',
              color: point.basis === b ? BASIS_META[b].color : 'var(--text-muted)',
            }}
          >
            {BASIS_META[b].label}
          </button>
        ))}
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={point.inOverall} disabled={disabled} onChange={(e) => onChange({ ...point, inOverall: e.target.checked })} />
          종합 소견
        </label>
        {!disabled ? <button type="button" className="adminBtnFree" onClick={onRemove} style={{ ...smallBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}>삭제</button> : null}
      </div>

      <textarea
        value={point.text}
        disabled={disabled}
        onChange={(e) => onChange({ ...point, text: e.target.value })}
        rows={2}
        style={{ ...input, resize: 'vertical' }}
      />

      <button type="button" className="adminBtnFree" onClick={() => setOpen((v) => !v)} style={{ ...smallBtn, border: 0, padding: '5px 0', marginTop: 4, color: 'var(--text-muted)' }}>
        근거 {open ? '▾' : '▸'}
      </button>
      {open ? (
        <textarea
          value={point.evidence}
          disabled={disabled}
          onChange={(e) => onChange({ ...point, evidence: e.target.value })}
          rows={2}
          placeholder="근거 원문(차트 인용 / 검사 항목=값 / 이미지 판독 문구)"
          style={{ ...input, resize: 'vertical', background: 'var(--bg-subtle)', fontSize: 11 }}
        />
      ) : null}

      {/* 배치 — 어느 섹션에 들어갈지 */}
      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', width: 52 }}>장기</span>
          {Object.entries(ORGAN_LABEL).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="adminBtnFree"
              disabled={disabled}
              onClick={() => onChange({ ...point, organs: toggle(point.organs, k) })}
              style={chip(point.organs.includes(k))}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', width: 52 }}>검사</span>
          {Object.entries(EXAM_LABEL).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="adminBtnFree"
              disabled={disabled}
              onClick={() => onChange({ ...point, examSections: toggle(point.examSections, k) })}
              style={chip(point.examSections.includes(k))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdminHealthPoints({
  points, confirmed, busy, onChange, onRegenerate, onSave, onConfirm, onUnconfirm,
}: {
  points: HealthPoint[];
  confirmed: boolean;
  busy: boolean;
  onChange: (next: HealthPoint[]) => void;
  onRegenerate: () => void;
  onSave: () => void;
  onConfirm: () => void;
  onUnconfirm: () => void;
}) {
  const update = (i: number, next: HealthPoint) => onChange(points.map((p, j) => (j === i ? next : p)));
  const remove = (i: number) => onChange(points.filter((_, j) => j !== i));
  const add = () =>
    onChange([
      ...points,
      { id: `p${points.length + 1}`, text: '', basis: 'chart', evidence: '', organs: [], examSections: [], inOverall: true },
    ]);

  const counts = points.reduce(
    (acc, p) => ({ ...acc, [p.basis]: (acc[p.basis] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>1단계 · 검진 포인트</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {points.length}개 · 차트 {counts.chart ?? 0} / 검사 {counts.lab ?? 0} / 이미지 {counts.image ?? 0}
        </span>
        {confirmed ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>확정됨</span> : null}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button type="button" className="adminLegacySmallBtn" onClick={onRegenerate} disabled={busy}>
            {busy ? '처리 중…' : '포인트 다시 뽑기'}
          </button>
          {confirmed ? (
            <button type="button" className="adminLegacySmallBtn" onClick={onUnconfirm} disabled={busy}>확정 해제</button>
          ) : (
            <>
              <button type="button" className="adminLegacySmallBtn" onClick={onSave} disabled={busy}>저장</button>
              <button type="button" className="adminLegacyPrimaryBtn" onClick={onConfirm} disabled={busy || points.length === 0}>확정</button>
            </>
          )}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        리포트에 다룰 소견을 근거·배치와 함께 먼저 확정합니다. 특히 <b style={{ color: BASIS_META.image.color }}>이미지 판독 (AI)</b> 근거는
        AI가 사진을 보고 판단한 내용이라 반드시 확인하세요. 확정하면 이 포인트만으로 본문이 작성됩니다(없는 소견을 새로 만들지 않음).
      </p>

      {points.length === 0 ? (
        <div style={{ ...card, color: 'var(--text-muted)', fontSize: 14 }}>
          포인트가 없습니다. ‘포인트 다시 뽑기’를 누르거나 직접 추가하세요.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {points.map((p, i) => (
            <PointCard key={p.id || i} point={p} index={i} disabled={confirmed} onChange={(next) => update(i, next)} onRemove={() => remove(i)} />
          ))}
        </div>
      )}

      {!confirmed ? (
        <button type="button" className="adminLegacySmallBtn" onClick={add} disabled={busy} style={{ justifySelf: 'start' }}>
          + 포인트 추가
        </button>
      ) : null}
    </section>
  );
}
