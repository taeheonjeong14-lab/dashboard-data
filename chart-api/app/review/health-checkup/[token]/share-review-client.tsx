'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { HealthCheckupGeneratedContent } from '@/lib/chart-app/health-checkup-content-shared';
import type { HealthReportPreviewModel } from '@/lib/chart-app/health-report-preview-model';
import { parseHealthCheckupPayloadFromStorage } from '@/lib/chart-app/health-checkup-content-shared';
import {
  HEALTH_CHECKUP_MAX_COVER_BREED_CHARS,
  HEALTH_CHECKUP_MAX_COVER_CHECKUP_DATE_CHARS,
  HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS,
  HEALTH_CHECKUP_MAX_COVER_SEX_CHARS,
  HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS,
} from '@/lib/chart-app/health-checkup-content-shared';
import {
  HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_MAX_OVERALL_CHARS,
  HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS,
  HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS,
  HEALTH_CHECKUP_MIN_FOLLOW_UP_CHARS,
  HEALTH_CHECKUP_MIN_OVERALL_CHARS,
} from '@/lib/chart-app/health-checkup-limits';
import {
  buildHealthReportPreviewPages,
  HealthReportPreviewPages,
  type HealthPreviewEditableSection,
} from '@dashboard/health-report';
import { joinTimelineCardText, splitTimelineCardText } from '@/lib/chart-app/health-report-timeline-card';
import { parseHealthSystemsBlocksFromUnknown } from '@/lib/chart-app/health-report-systems-blocks-parse';
import { coverCheckupDateToIsoInputValue, iranSuffix } from '@dashboard/health-report';
import { detectSpeciesProfile } from '@/lib/lab-category-map';
import type { HealthSystemsReportBlock } from '@dashboard/health-report';
import {
  DEMO_HEALTH_DENTAL_SKIN_BLOCKS,
  DEMO_HEALTH_SYSTEMS_BLOCKS,
  DEMO_HEALTH_SYSTEMS_PAGE_B_BLOCKS,
  DEMO_RADIOLOGY_ULTRASOUND_BLOCKS,
} from '@dashboard/health-report';

// Row char limits (not exported from health-checkup-systems-llm-merge)
const SYSTEMS_ROW_MAX_P34 = 320;
const SYSTEMS_ROW_MAX_P5 = 250;

const COVER_SEX_OPTIONS = ['암컷(중성화)', '수컷(중성화)', '암컷', '수컷'] as const;
const COVER_SPECIES_CANINE = 'Canine (개)';
const COVER_SPECIES_FELINE = 'Feline (고양이)';

type PageBlocksKey = 'systemsPage3Blocks' | 'systemsPage3bBlocks' | 'systemsPage4Blocks' | 'systemsPage5Blocks';
const SYSTEMS_PAGE_KEYS: PageBlocksKey[] = [
  'systemsPage3Blocks',
  'systemsPage3bBlocks',
  'systemsPage4Blocks',
  'systemsPage5Blocks',
];

function fallbackBlocks(key: PageBlocksKey): HealthSystemsReportBlock[] {
  switch (key) {
    case 'systemsPage3Blocks': return structuredClone(DEMO_HEALTH_SYSTEMS_BLOCKS);
    case 'systemsPage3bBlocks': return structuredClone(DEMO_HEALTH_SYSTEMS_PAGE_B_BLOCKS);
    case 'systemsPage4Blocks': return structuredClone(DEMO_HEALTH_DENTAL_SKIN_BLOCKS);
    case 'systemsPage5Blocks': return structuredClone(DEMO_RADIOLOGY_ULTRASOUND_BLOCKS);
    default: return [];
  }
}

function blocksForEdit(draft: HealthCheckupGeneratedContent, key: PageBlocksKey): HealthSystemsReportBlock[] {
  return parseHealthSystemsBlocksFromUnknown(draft[key]) ?? fallbackBlocks(key);
}

function updateRowsBlockContent(
  blocks: HealthSystemsReportBlock[],
  blockIndex: number,
  rowIndex: number,
  content: string,
): HealthSystemsReportBlock[] {
  return blocks.map((b, bi) => {
    if (bi !== blockIndex || b.variant !== 'rows') return b;
    return { ...b, rows: b.rows.map((r, ri) => (ri === rowIndex ? { ...r, content } : r)) };
  });
}

/** 장기 rows 블록의 질환 후보 본문(diseaseOptions[i].body)을 갱신. (외부 검토링크는 본문 편집만) */
function updateRowsBlockOptionBody(
  blocks: HealthSystemsReportBlock[],
  blockIndex: number,
  optIndex: number,
  body: string,
): HealthSystemsReportBlock[] {
  return blocks.map((b, bi) => {
    if (bi !== blockIndex || b.variant !== 'rows' || !b.diseaseOptions) return b;
    return {
      ...b,
      diseaseOptions: b.diseaseOptions.map((o, oi) =>
        oi === optIndex ? { ...o, body: body.slice(0, DISEASE_BODY_MAX) } : o,
      ),
    };
  });
}

/** 장기 rows 블록의 질환 후보 ON/OFF(diseaseOptions[i].enabled) 갱신.
 *  외부 검토링크는 admin 이 만든 기존 후보를 켜고 끄기만 한다(새 후보 생성 불가). */
function updateRowsBlockOptionEnabled(
  blocks: HealthSystemsReportBlock[],
  blockIndex: number,
  optIndex: number,
  enabled: boolean,
): HealthSystemsReportBlock[] {
  return blocks.map((b, bi) => {
    if (bi !== blockIndex || b.variant !== 'rows' || !b.diseaseOptions) return b;
    return {
      ...b,
      diseaseOptions: b.diseaseOptions.map((o, oi) => (oi === optIndex ? { ...o, enabled } : o)),
    };
  });
}

/** 질환 소개 입력칸을 노출할 페이지(3·4p)만. */
const DISEASE_BOX_PAGE_KEYS: PageBlocksKey[] = ['systemsPage3Blocks', 'systemsPage3bBlocks', 'systemsPage4Blocks'];
const DISEASE_BODY_MAX = 200;

function coverSpeciesSelectValue(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  return detectSpeciesProfile(t) === 'cat' ? COVER_SPECIES_FELINE : COVER_SPECIES_CANINE;
}

function normalizeCoverWeightForDisplay(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  if (!/\d/.test(t)) return t;
  if (/kg\s*$/i.test(t)) return t.replace(/kg\s*$/i, 'kg');
  return `${t}kg`;
}

function normalizeCoverAgeForDisplay(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  if (!/\d/.test(t)) return t;
  if (/세\s*$/.test(t)) return t.replace(/세\s*$/, '세');
  return `${t}세`;
}

/** 숫자만 입력해도 휴대폰 번호 형식(010-1234-5678)으로 보이게 한다. 최대 11자리. */
function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function CharCountLine({ current, max }: { current: number; max: number; min?: number }) {
  const overMax = current > max;
  const color = overMax ? '#b45309' : '#a1a1aa';
  return (
    <p style={{ textAlign: 'right', fontSize: 11, color, fontWeight: overMax ? '500' : '400', fontVariantNumeric: 'tabular-nums', margin: 0 }}>
      {current} / 권장 최대 글자수 {max}
      {overMax ? ' (권장 최대 글자수를 넘었습니다. 페이지를 넘기면 넘친 부분이 잘릴 수 있어요.)' : ''}
    </p>
  );
}

function CoverSelectChevron() {
  return (
    <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#71717a', pointerEvents: 'none' }} aria-hidden>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}

type ReviewEditorProps = {
  draft: HealthCheckupGeneratedContent;
  onChange: (next: HealthCheckupGeneratedContent) => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
  activeSection?: HealthPreviewEditableSection;
};

function HealthCheckupReviewEditor({ draft, onChange, onSave, saving, activeSection }: ReviewEditorProps) {
  const setCover = (key: keyof HealthCheckupGeneratedContent, value: string) => {
    onChange({ ...draft, [key]: value } as HealthCheckupGeneratedContent);
  };

  const setRecheckPair = (
    field: keyof Pick<HealthCheckupGeneratedContent,
      'recheckWithin1to2Weeks' | 'recheckWithin1Month' | 'recheckWithin3Months' | 'recheckWithin6Months'>,
    title: string,
    body: string,
  ) => {
    onChange({ ...draft, [field]: joinTimelineCardText(title, body) });
  };

  const setSystemsRow = (pageKey: PageBlocksKey, blockIndex: number, rowIndex: number, content: string) => {
    const list = blocksForEdit(draft, pageKey);
    const next = updateRowsBlockContent(list, blockIndex, rowIndex, content);
    onChange({ ...draft, [pageKey]: next });
  };

  const setSystemsOptionBody = (
    pageKey: PageBlocksKey,
    blockIndex: number,
    optIndex: number,
    body: string,
  ) => {
    const list = blocksForEdit(draft, pageKey);
    const next = updateRowsBlockOptionBody(list, blockIndex, optIndex, body);
    onChange({ ...draft, [pageKey]: next });
  };

  const setSystemsOptionEnabled = (
    pageKey: PageBlocksKey,
    blockIndex: number,
    optIndex: number,
    enabled: boolean,
  ) => {
    const list = blocksForEdit(draft, pageKey);
    const next = updateRowsBlockOptionEnabled(list, blockIndex, optIndex, enabled);
    onChange({ ...draft, [pageKey]: next });
  };

  const recheckDefs = [
    { label: '1~2주 이내', field: 'recheckWithin1to2Weeks' as const },
    { label: '1개월 이내', field: 'recheckWithin1Month' as const },
    { label: '3개월 이내', field: 'recheckWithin3Months' as const },
    { label: '6개월 이내', field: 'recheckWithin6Months' as const },
  ];

  const sexVal = (draft.coverPatientSex ?? '').trim();
  const sexLegacyOption =
    sexVal && !COVER_SEX_OPTIONS.includes(sexVal as (typeof COVER_SEX_OPTIONS)[number]) ? sexVal : null;

  const showAll = !activeSection;
  const showCover = showAll || activeSection === 'cover';
  const showSummary = showAll || activeSection === 'summary';
  const showLab = showAll || activeSection === 'lab';
  const showSystemsKey = (key: PageBlocksKey): boolean => {
    if (showAll) return true;
    if (key === 'systemsPage3Blocks') return activeSection === 'systemsPage3';
    if (key === 'systemsPage3bBlocks') return activeSection === 'systemsPage3b';
    if (key === 'systemsPage4Blocks') return activeSection === 'systemsPage4';
    if (key === 'systemsPage5Blocks') return activeSection === 'systemsPage5';
    return false;
  };

  const nothingToShow =
    !showAll && !showCover && !showSummary && !showLab &&
    !showSystemsKey('systemsPage3Blocks') && !showSystemsKey('systemsPage3bBlocks') &&
    !showSystemsKey('systemsPage4Blocks') && !showSystemsKey('systemsPage5Blocks');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderBottom: '1px solid #f4f4f5', paddingBottom: 16 }}>
        <button type="button" disabled={saving} onClick={() => void onSave()} className="hcu-rv-btn-save">
          {saving ? '저장 중…' : '검토 내용 저장'}
        </button>
        <p style={{ width: '100%', textAlign: 'right', fontSize: 11, color: '#71717a', margin: 0 }}>
          저장 후 「보고서 미리보기」에서 반영됩니다.
        </p>
      </div>

      {showCover && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>검진 일자</span>
                <input
                  type="date"
                  className="hcu-rv-input"
                  style={{ colorScheme: 'light' }}
                  value={coverCheckupDateToIsoInputValue(draft.coverCheckupDate)}
                  onChange={(e) => setCover('coverCheckupDate', e.target.value)}
                />
              </label>
              <CharCountLine current={(draft.coverCheckupDate ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_CHECKUP_DATE_CHARS} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>프로그램</span>
                <input className="hcu-rv-input" maxLength={HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS} value={draft.coverProgram ?? ''} onChange={(e) => setCover('coverProgram', e.target.value)} />
              </label>
              <CharCountLine current={(draft.coverProgram ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>수의사</span>
                <input className="hcu-rv-input" maxLength={HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS} value={draft.coverVeterinarian ?? ''} onChange={(e) => setCover('coverVeterinarian', e.target.value)} />
              </label>
              <CharCountLine current={(draft.coverVeterinarian ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_FIELD_CHARS} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>반려동물 이름</span>
                <input className="hcu-rv-input" maxLength={HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS} value={draft.coverPatientName ?? ''} onChange={(e) => setCover('coverPatientName', e.target.value)} />
              </label>
              <CharCountLine current={(draft.coverPatientName ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>종</span>
                <div style={{ position: 'relative' }}>
                  <select className="hcu-rv-select hcu-rv-select-cover" value={coverSpeciesSelectValue(draft.coverPatientSpecies)} onChange={(e) => setCover('coverPatientSpecies', e.target.value)}>
                    <option value="">선택</option>
                    <option value={COVER_SPECIES_CANINE}>{COVER_SPECIES_CANINE}</option>
                    <option value={COVER_SPECIES_FELINE}>{COVER_SPECIES_FELINE}</option>
                  </select>
                  <CoverSelectChevron />
                </div>
              </label>
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>품종</span>
                <input className="hcu-rv-input" maxLength={HEALTH_CHECKUP_MAX_COVER_BREED_CHARS} value={draft.coverPatientBreed ?? ''} onChange={(e) => setCover('coverPatientBreed', e.target.value)} />
              </label>
              <CharCountLine current={(draft.coverPatientBreed ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_BREED_CHARS} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>성별</span>
                <div style={{ position: 'relative' }}>
                  <select className="hcu-rv-select hcu-rv-select-cover" value={draft.coverPatientSex ?? ''} onChange={(e) => setCover('coverPatientSex', e.target.value)}>
                    <option value="">선택</option>
                    {sexLegacyOption && <option value={sexLegacyOption}>{sexLegacyOption}</option>}
                    {COVER_SEX_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <CoverSelectChevron />
                </div>
              </label>
              <CharCountLine current={(draft.coverPatientSex ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_SEX_CHARS} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>나이</span>
                <input
                  className="hcu-rv-input"
                  maxLength={HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS}
                  value={draft.coverPatientAge ?? ''}
                  onChange={(e) => setCover('coverPatientAge', e.target.value)}
                  onBlur={(e) => setCover('coverPatientAge', normalizeCoverAgeForDisplay(e.target.value))}
                />
              </label>
              <CharCountLine current={(draft.coverPatientAge ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>체중</span>
                <input
                  className="hcu-rv-input"
                  maxLength={HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS}
                  value={draft.coverPatientWeight ?? ''}
                  onChange={(e) => setCover('coverPatientWeight', e.target.value)}
                  onBlur={(e) => setCover('coverPatientWeight', normalizeCoverWeightForDisplay(e.target.value))}
                />
              </label>
              <CharCountLine current={(draft.coverPatientWeight ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS} />
            </div>
          </div>

          <div style={{ maxWidth: 160 }}>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>보호자 성함</span>
              <input className="hcu-rv-input" maxLength={HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS} value={draft.coverOwnerName ?? ''} onChange={(e) => setCover('coverOwnerName', e.target.value)} />
            </label>
            <CharCountLine current={(draft.coverOwnerName ?? '').length} max={HEALTH_CHECKUP_MAX_COVER_SHORT_FIELD_CHARS} />
          </div>
        </div>
      )}

      {showSummary && (
        <div>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>종합 소견</span>
            <textarea className="hcu-rv-textarea" style={{ minHeight: 140 }} value={draft.overallSummary} onChange={(e) => onChange({ ...draft, overallSummary: e.target.value })} />
          </label>
          <CharCountLine current={draft.overallSummary.length} max={HEALTH_CHECKUP_MAX_OVERALL_CHARS} min={HEALTH_CHECKUP_MIN_OVERALL_CHARS} />
        </div>
      )}

      {showSummary && (
        <div>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>사후 관리</span>
            <textarea className="hcu-rv-textarea" style={{ minHeight: 120 }} value={draft.followUpCare} onChange={(e) => onChange({ ...draft, followUpCare: e.target.value })} />
          </label>
          <CharCountLine current={draft.followUpCare.length} max={HEALTH_CHECKUP_MAX_FOLLOW_UP_CHARS} min={HEALTH_CHECKUP_MIN_FOLLOW_UP_CHARS} />
        </div>
      )}

      {showSummary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: '#52525b', margin: 0 }}>
            권장 재검진: 제목은 첫 줄(최대 {HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS}자), 본문은 그 다음 한 줄(최대 {HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS}자)로 반드시 함께 입력합니다.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
            {recheckDefs.map(({ label, field }) => {
              const raw = draft[field] ?? '';
              const { cardTitle, cardBody } = splitTimelineCardText(raw);
              const bodyForInput = cardTitle && cardBody === '—' ? '' : cardBody === '—' ? '' : cardBody;
              const titleVal = cardTitle || '';
              return (
                <div key={field} style={{ padding: 12, borderRadius: 8, border: '1px solid #f4f4f5', background: 'rgba(250,250,250,0.6)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#27272a', margin: 0 }}>{label}</p>
                  <div>
                    <label style={{ display: 'block' }}>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#71717a', marginBottom: 4 }}>제목</span>
                      <input className="hcu-rv-input" maxLength={HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS} value={titleVal} onChange={(e) => setRecheckPair(field, e.target.value, bodyForInput)} />
                    </label>
                    <CharCountLine current={titleVal.length} max={HEALTH_CHECKUP_MAX_RECHECK_TITLE_CHARS} />
                  </div>
                  <div>
                    <label style={{ display: 'block' }}>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#71717a', marginBottom: 4 }}>본문</span>
                      <textarea className="hcu-rv-textarea" style={{ minHeight: 72 }} maxLength={HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS} value={bodyForInput} onChange={(e) => setRecheckPair(field, titleVal, e.target.value)} />
                    </label>
                    <CharCountLine current={bodyForInput.length} max={HEALTH_CHECKUP_MAX_RECHECK_BODY_CHARS} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {SYSTEMS_PAGE_KEYS.map((key) => {
        if (!showSystemsKey(key)) return null;
        const rowMax = key === 'systemsPage5Blocks' ? SYSTEMS_ROW_MAX_P5 : SYSTEMS_ROW_MAX_P34;
        const blocks = blocksForEdit(draft, key);
        const rowBlocks = blocks
          .map((b, bi) => ({ b, bi }))
          .filter((x): x is { b: Extract<HealthSystemsReportBlock, { variant: 'rows' }>; bi: number } => x.b.variant === 'rows');
        if (rowBlocks.length === 0) {
          return <p key={key} style={{ fontSize: 14, color: '#71717a', margin: 0 }}>편집 가능한 행 블록이 없습니다.</p>;
        }
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {rowBlocks.map(({ b, bi }) => (
              <div key={`${key}-b-${bi}`} style={{ padding: 12, borderRadius: 8, border: '1px solid #f4f4f5', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#27272a', margin: 0 }}>
                  {b.titleKo}
                  {b.titleEn && <span style={{ marginLeft: 4, fontWeight: 400, color: '#71717a' }}>({b.titleEn})</span>}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {b.rows.map((row, ri) => (
                    <div key={`${key}-b-${bi}-r-${ri}`} style={{ minWidth: 0 }}>
                      <label style={{ display: 'block' }}>
                        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>{row.label}</span>
                        <textarea className="hcu-rv-textarea" style={{ minHeight: 100 }} maxLength={rowMax} value={row.content} onChange={(e) => setSystemsRow(key, bi, ri, e.target.value)} />
                      </label>
                      <CharCountLine current={row.content.length} max={rowMax} />
                    </div>
                  ))}
                  {DISEASE_BOX_PAGE_KEYS.includes(key) && (b.diseaseOptions ?? []).some((o) => (o.name ?? '').trim()) && (
                    <div style={{ minWidth: 0, marginTop: 4, paddingTop: 12, borderTop: '1px dashed #e4e4e7', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: '#52525b', margin: 0 }}>
                        질환 소개 박스 <span style={{ fontWeight: 400, color: '#a1a1aa' }}>(표시 여부 토글 · 본문 편집)</span>
                      </p>
                      {(b.diseaseOptions ?? []).map((opt, oi) =>
                        (opt.name ?? '').trim() ? (
                          <div key={oi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#27272a' }}>
                              <input
                                type="checkbox"
                                checked={opt.enabled}
                                onChange={(e) => setSystemsOptionEnabled(key, bi, oi, e.target.checked)}
                                style={{ width: 15, height: 15, flexShrink: 0 }}
                              />
                              <span>{opt.name}{iranSuffix(opt.name)}?</span>
                              <span style={{ fontSize: 11, fontWeight: 500, color: opt.enabled ? '#16a34a' : '#a1a1aa' }}>
                                {opt.enabled ? '표시함' : '숨김'}
                              </span>
                            </label>
                            {opt.enabled ? (
                              <div>
                                <textarea className="hcu-rv-textarea" style={{ minHeight: 80 }} maxLength={DISEASE_BODY_MAX} value={opt.body} onChange={(e) => setSystemsOptionBody(key, bi, oi, e.target.value)} />
                                <CharCountLine current={opt.body.length} max={DISEASE_BODY_MAX} />
                              </div>
                            ) : null}
                          </div>
                        ) : null,
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {showLab && (
        <div>
          <div style={{ padding: 12, borderRadius: 8, border: '1px solid #f4f4f5', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#27272a', marginBottom: 8 }}>혈액검사</p>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>검사 결과 해석</span>
                <textarea className="hcu-rv-textarea" style={{ minHeight: 100 }} maxLength={250} value={draft.labInterpretation ?? ''} onChange={(e) => onChange({ ...draft, labInterpretation: e.target.value })} />
              </label>
              <CharCountLine current={(draft.labInterpretation ?? '').length} max={250} />
            </div>
          </div>
        </div>
      )}

      {nothingToShow && (
        <p style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e4e4e7', background: '#fafafa', fontSize: 14, color: '#52525b', margin: 0 }}>
          이 페이지에는 편집 가능한 입력 항목이 없습니다.
        </p>
      )}
    </div>
  );
}

// ——— helpers ———

type LoadResponse = {
  error?: string;
  runId?: string;
  expiresAt?: string;
  generated?: HealthCheckupGeneratedContent;
};

async function readJsonPayload<T>(res: Response): Promise<{ payload: T | null; rawText: string }> {
  const rawText = await res.text();
  if (!rawText) return { payload: null, rawText: '' };
  try {
    return { payload: JSON.parse(rawText) as T, rawText };
  } catch {
    return { payload: null, rawText };
  }
}

function resolveApiErrorMessage(payloadError: string | undefined, rawText: string, fallback: string): string {
  return (payloadError ?? rawText) || fallback;
}

// ——— 사진 편집(이미지 슬롯) ———

type SlotCandidate = { id: string; storagePath: string; previewUrl: string | null; examType: string; fileName: string };
type ImgSlot = { src?: string; caption?: string; rotationDeg?: number };
const IMAGE_VARIANTS = new Set(['images', 'images4', 'imagesGrid2x3', 'imagesGrid3x3']);

function isImgBlock(b: unknown): b is { variant: string; images: ImgSlot[] } {
  return (
    !!b &&
    typeof b === 'object' &&
    IMAGE_VARIANTS.has((b as { variant?: string }).variant ?? '') &&
    Array.isArray((b as { images?: unknown }).images)
  );
}
function parseSystemsBlocks(raw: unknown): HealthSystemsReportBlock[] | null {
  if (!Array.isArray(raw)) return null;
  return parseHealthSystemsBlocksFromUnknown(raw) ?? null;
}
function updateImgSlot(blocks: HealthSystemsReportBlock[], bi: number, si: number, patch: ImgSlot): HealthSystemsReportBlock[] {
  const out = JSON.parse(JSON.stringify(blocks)) as HealthSystemsReportBlock[];
  const b = out[bi] as unknown;
  if (!isImgBlock(b)) return out;
  const img = b.images[si];
  if (!img) return out;
  if ('src' in patch) img.src = patch.src;
  if ('caption' in patch) img.caption = patch.caption;
  if ('rotationDeg' in patch) img.rotationDeg = patch.rotationDeg;
  return out;
}

function ReviewImageSlotsEditor({
  token,
  draft,
  onChange,
  activeSection,
}: {
  token: string;
  draft: HealthCheckupGeneratedContent;
  onChange: (d: HealthCheckupGeneratedContent) => void;
  activeSection?: HealthPreviewEditableSection;
}) {
  const [cands, setCands] = useState<SlotCandidate[]>([]);
  const [signed, setSigned] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: PageBlocksKey; bi: number; si: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/content/health-checkup/review-share/case-images?token=${encodeURIComponent(token)}`);
      const data = (await res.json()) as { candidates?: SlotCandidate[]; signed?: Record<string, string | null>; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? '이미지 후보를 불러오지 못했습니다.');
      setCands(data.candidates ?? []);
      setSigned(data.signed ?? {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : '이미지 후보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  const previewFor = (src: string | undefined): string | undefined => {
    if (!src) return undefined;
    if (src.startsWith('http') || src.startsWith('blob:')) return src;
    return signed[src] ?? cands.find((c) => c.storagePath === src)?.previewUrl ?? undefined;
  };
  // 후보를 검사종류별로 묶어 모달에서 카테고리로 보여준다.
  const grouped = useMemo(() => {
    const m = new Map<string, SlotCandidate[]>();
    for (const c of cands) {
      const cat = c.examType || '기타';
      const arr = m.get(cat) ?? [];
      arr.push(c);
      m.set(cat, arr);
    }
    return [...m.entries()];
  }, [cands]);

  const setBlocksFor = (key: PageBlocksKey, nb: HealthSystemsReportBlock[]) => onChange({ ...draft, [key]: nb });

  function slotTile(key: PageBlocksKey, bi: number, slot: ImgSlot, si: number) {
    const src = slot?.src ?? '';
    const rot = slot?.rotationDeg ?? 0;
    const prev = previewFor(src);
    const clearSlot = () => {
      const blocks = parseSystemsBlocks(draft[key]);
      if (blocks) setBlocksFor(key, updateImgSlot(blocks, bi, si, { src: undefined, caption: '', rotationDeg: 0 }));
    };
    return (
      <div
        key={`${key}-${bi}-${si}`}
        role="button"
        tabIndex={0}
        onClick={() => setPicker({ key, bi, si })}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setPicker({ key, bi, si }); }}
        style={{ position: 'relative', border: '1px solid #e4e4e7', borderRadius: 8, padding: 6, background: '#fff', cursor: 'pointer', textAlign: 'center' }}
      >
        {src ? (
          <button
            type="button"
            aria-label="이미지 빼기"
            onClick={(e) => { e.stopPropagation(); clearSlot(); }}
            style={{ position: 'absolute', top: -8, right: -8, width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: 14, lineHeight: '22px', cursor: 'pointer', padding: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.3)', zIndex: 2 }}
          >
            ×
          </button>
        ) : null}
        <div style={{ height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 4, background: '#fafafa' }}>
          {prev ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={prev} style={{ maxWidth: '100%', maxHeight: 84, objectFit: 'contain', transform: `rotate(${rot}deg)` }} />
          ) : (
            <span style={{ fontSize: 30, color: '#a1a1aa', lineHeight: 1 }}>＋</span>
          )}
        </div>
        {slot?.caption ? (
          <div style={{ fontSize: 10, color: '#71717a', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.caption}</div>
        ) : null}
      </div>
    );
  }

  function slotTiles(key: PageBlocksKey) {
    const blocks = parseSystemsBlocks(draft[key]);
    if (!blocks) return null;
    // 이미지 블록을 직전 rows 블록의 제목(섹션)별로 묶는다 — 미리보기와 동일 구분.
    const sections: { title: string; bi: number }[] = [];
    let lastTitle = '';
    blocks.forEach((b, bi) => {
      const ab = b as { variant?: string; titleKo?: string; titleEn?: string };
      if (ab.variant === 'rows') lastTitle = ab.titleKo || ab.titleEn || lastTitle;
      else if (isImgBlock(b)) sections.push({ title: lastTitle, bi });
    });
    if (sections.length === 0) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sections.map(({ title, bi }) => {
          const b = blocks[bi];
          const slots = isImgBlock(b) ? b.images : [];
          return (
            <div key={`${key}-sec-${bi}`}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#3f3f46', marginBottom: 6 }}>
                {title || LABELS[key]} <span style={{ fontWeight: 400, color: '#a1a1aa' }}>· {slots.length}장</span>
              </div>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
                {slots.map((slot, si) => slotTile(key, bi, slot, si))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // 활성 섹션(지금 보고 있는 페이지)에 해당하는 이미지 슬롯만 보여준다. (activeSection 없으면 이미지 있는 페이지 전체 — 폴백)
  const ACTIVE_TO_KEY: Partial<Record<HealthPreviewEditableSection, PageBlocksKey>> = {
    systemsPage3: 'systemsPage3Blocks',
    systemsPage3b: 'systemsPage3bBlocks',
    systemsPage4: 'systemsPage4Blocks',
    systemsPage5: 'systemsPage5Blocks',
  };
  const LABELS: Record<PageBlocksKey, string> = {
    systemsPage3Blocks: '이미지',
    systemsPage3bBlocks: '이미지',
    systemsPage4Blocks: '치과·피부 등',
    systemsPage5Blocks: '방사선·초음파 등',
  };
  const activeKey = activeSection ? ACTIVE_TO_KEY[activeSection] : undefined;
  const candidateKeys: PageBlocksKey[] = activeKey
    ? [activeKey]
    : activeSection
      ? [] // 이미지 페이지가 아닌 섹션(표지·소견 등)에서는 사진 편집창을 띄우지 않음
      : (['systemsPage3Blocks', 'systemsPage3bBlocks', 'systemsPage4Blocks', 'systemsPage5Blocks'] as PageBlocksKey[]);
  const keysToShow = candidateKeys.filter((k) => parseSystemsBlocks(draft[k])?.some(isImgBlock));
  if (keysToShow.length === 0) return null;

  // 피커 모달 대상 슬롯
  const pickerBlocks = picker ? parseSystemsBlocks(draft[picker.key]) : null;
  const pickerSlotObj = picker && pickerBlocks
    ? (() => { const bb = pickerBlocks[picker.bi] as unknown; return isImgBlock(bb) ? bb.images[picker.si] : undefined; })()
    : undefined;
  const pickerSrc = pickerSlotObj?.src ?? '';
  const pickerRot = pickerSlotObj?.rotationDeg ?? 0;
  const pickerCaption = pickerSlotObj?.caption ?? '';
  const patchPicker = (patch: ImgSlot) => {
    if (picker && pickerBlocks) setBlocksFor(picker.key, updateImgSlot(pickerBlocks, picker.bi, picker.si, patch));
  };

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f4f4f5', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#18181b' }}>사진 편집</span>
        <button type="button" className="hcu-rv-btn-outline" disabled={loading} onClick={() => void load()}>새로고침</button>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: '#71717a' }}>슬롯을 눌러 사진을 고르고(캡션·90° 회전·삭제) 위의 「검토 내용 저장」을 누르면 반영됩니다.</p>
      {loading ? <p style={{ fontSize: 12, color: '#71717a' }}>이미지 불러오는 중…</p> : null}
      {err ? <p style={{ fontSize: 12, color: '#991b1b' }}>{err}</p> : null}
      {keysToShow.map((k) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{slotTiles(k)}</div>
      ))}

      {picker && pickerBlocks ? (
        <div
          onClick={() => setPicker(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(92vw, 820px)', maxHeight: '88vh', overflowY: 'auto', display: 'grid', gap: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>이미지 선택</span>
              <button type="button" className="hcu-rv-btn-save" onClick={() => setPicker(null)}>완료</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingBottom: 16, borderBottom: '1px solid #e4e4e7' }}>
              <div style={{ background: '#fafafa', borderRadius: 8, minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {previewFor(pickerSrc) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={previewFor(pickerSrc)} style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', transform: `rotate(${pickerRot}deg)`, transition: 'transform 0.2s' }} />
                ) : (
                  <div style={{ textAlign: 'center', color: '#a1a1aa' }}>
                    <div style={{ fontSize: 32, lineHeight: 1, marginBottom: 6 }}>＋</div>
                    <div style={{ fontSize: 13 }}>아래에서 사진을 고르세요</div>
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
                <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>
                  <span style={{ color: '#52525b', fontWeight: 600 }}>캡션</span>
                  <textarea
                    rows={3}
                    maxLength={10}
                    placeholder="이미지 캡션"
                    value={pickerCaption}
                    onChange={(e) => patchPicker({ caption: e.target.value })}
                    style={{ width: '100%', padding: 8, fontSize: 13, borderRadius: 6, border: '1px solid #e4e4e7', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                  <span style={{ fontSize: 11, color: pickerCaption.length >= 10 ? '#991b1b' : '#a1a1aa', textAlign: 'right' }}>{pickerCaption.length} / 10</span>
                </label>
                <button type="button" className="hcu-rv-btn-outline" disabled={!pickerSrc} onClick={() => patchPicker({ rotationDeg: (pickerRot + 90) % 360 })}>90° 회전</button>
                {pickerSrc ? (
                  <button type="button" className="hcu-rv-btn-outline" onClick={() => patchPicker({ src: undefined, caption: '', rotationDeg: 0 })}>이미지 삭제</button>
                ) : null}
              </div>
            </div>
            {cands.length === 0 ? (
              <p style={{ fontSize: 13, color: '#71717a', margin: 0 }}>후보 이미지가 없습니다.</p>
            ) : (
              grouped.map(([category, items]) => (
                <div key={category}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#52525b', marginBottom: 8 }}>{category}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {items.map((c) => {
                      const sel = !!c.storagePath && c.storagePath === pickerSrc;
                      return (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() => patchPicker({ src: c.storagePath })}
                          style={{ width: 96, padding: 0, border: sel ? '2px solid #0369a1' : '1px solid #e4e4e7', borderRadius: 6, overflow: 'hidden', background: '#fff', cursor: 'pointer' }}
                        >
                          {c.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" src={c.previewUrl} style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block' }} />
                          ) : (
                            <div style={{ height: 72, fontSize: 10, color: '#a1a1aa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>미리보기 없음</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ——— main client component ———

export default function HealthCheckupShareReviewClient() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // 카카오 알림톡 전송
  const [kakaoOpen, setKakaoOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState('');
  const [kakaoError, setKakaoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<HealthCheckupGeneratedContent | null>(null);
  const [previewModel, setPreviewModel] = useState<HealthReportPreviewModel | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  async function loadPreview(generatedPayload?: HealthCheckupGeneratedContent) {
    if (!token) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch('/api/report/health-checkup/preview-by-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, generatedPayload }),
      });
      const { payload, rawText } = await readJsonPayload<{ error?: string; model?: HealthReportPreviewModel }>(res);
      if (!res.ok || payload?.error || !payload?.model) {
        throw new Error(resolveApiErrorMessage(payload?.error, rawText, '미리보기를 불러오지 못했습니다.'));
      }
      setPreviewModel(payload.model);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : '미리보기를 불러오지 못했습니다.');
      setPreviewModel(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function load() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content/health-checkup/review-share?token=${encodeURIComponent(token)}`);
      const { payload, rawText } = await readJsonPayload<LoadResponse>(res);
      if (!res.ok || payload?.error) {
        throw new Error(resolveApiErrorMessage(payload?.error, rawText, '검토 데이터를 불러오지 못했습니다.'));
      }
      if (!payload?.runId || !payload?.generated) {
        throw new Error('검토 응답 형식이 올바르지 않습니다.');
      }
      setRunId(payload.runId);
      setExpiresAt(payload.expiresAt ?? null);
      setDraft(parseHealthCheckupPayloadFromStorage(payload.generated));
      await loadPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : '검토 데이터를 불러오지 못했습니다.');
      setDraft(null);
      setPreviewModel(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const previewPages = previewModel ? buildHealthReportPreviewPages(previewModel) : [];
  const previewTotal = previewPages.length;
  const safePageIndex = Math.min(Math.max(currentPageIndex, 0), Math.max(0, previewTotal - 1));
  const activeSection = previewPages[safePageIndex]?.section;

  useEffect(() => {
    if (previewTotal === 0) return;
    setCurrentPageIndex((prev) => Math.min(Math.max(prev, 0), previewTotal - 1));
  }, [previewTotal]);

  async function saveDraft() {
    if (!token || !draft || !runId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/content/health-checkup/review-share', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, payload: draft }),
      });
      const { payload, rawText } = await readJsonPayload<{ error?: string }>(res);
      if (!res.ok || payload?.error) {
        throw new Error(resolveApiErrorMessage(payload?.error, rawText, '저장에 실패했습니다.'));
      }
      await loadPreview(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function sendKakao() {
    if (!token) return;
    setSending(true);
    setKakaoError(null);
    setSentMsg('');
    try {
      const res = await fetch('/api/report/health-checkup/send-kakao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, phone }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; queued?: boolean; message?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? '발송에 실패했습니다.');
      setSentMsg(data.queued ? (data.message ?? '발송이 요청되었습니다. 곧 전송됩니다.') : '전송되었습니다.');
      setTimeout(() => { setKakaoOpen(false); setSentMsg(''); setPhone(''); }, 1200);
    } catch (e) {
      setKakaoError(e instanceof Error ? e.message : '발송에 실패했습니다.');
    } finally {
      setSending(false);
    }
  }

  function downloadPdf() {
    if (!token) return;
    setDownloading(true);
    setError(null);

    const iframeName = `hcu_pdf_${Date.now()}`;
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText =
      'position:absolute;left:0;top:0;width:1px;height:1px;border:0;margin:0;padding:0;opacity:0;pointer-events:none';

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/report/health-checkup/export-by-share';
    form.target = iframeName;
    form.enctype = 'application/x-www-form-urlencoded';
    form.acceptCharset = 'UTF-8';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'token';
    input.value = token;
    form.appendChild(input);

    let settled = false;
    let sawSubmit = false;
    const tearDown = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(failSafe);
      iframe.removeEventListener('load', onIframeLoad);
      window.setTimeout(() => iframe.remove(), 2500);
      setDownloading(false);
    };
    const failSafe = window.setTimeout(() => tearDown(), 120_000);
    function onIframeLoad() {
      if (!sawSubmit) return;
      tearDown();
    }
    iframe.addEventListener('load', onIframeLoad);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    sawSubmit = true;
    try {
      form.submit();
    } catch (e) {
      tearDown();
      setError(e instanceof Error ? e.message : 'PDF 생성에 실패했습니다.');
      form.remove();
      return;
    }
    form.remove();
  }

  return (
    <>
      <style>{`
        .hcu-rv-input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #e4e4e7;
          border-radius: 8px;
          background: #fff;
          padding: 8px 12px;
          font-size: 14px;
          color: #18181b;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
          outline: none;
          min-height: 42px;
          font-family: inherit;
        }
        .hcu-rv-input:focus {
          border-color: #38bdf8;
          box-shadow: 0 0 0 3px rgba(56,189,248,0.2);
        }
        .hcu-rv-textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #e4e4e7;
          border-radius: 8px;
          background: #fff;
          padding: 8px 12px;
          font-size: 14px;
          color: #18181b;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
          outline: none;
          resize: vertical;
          font-family: inherit;
          line-height: 1.6;
        }
        .hcu-rv-textarea:focus {
          border-color: #38bdf8;
          box-shadow: 0 0 0 3px rgba(56,189,248,0.2);
        }
        .hcu-rv-select {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #e4e4e7;
          border-radius: 8px;
          background: #fff;
          padding: 8px 40px 8px 12px;
          font-size: 14px;
          color: #18181b;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
          outline: none;
          min-height: 42px;
          cursor: pointer;
          font-family: inherit;
        }
        .hcu-rv-select-cover {
          appearance: none;
          -webkit-appearance: none;
        }
        .hcu-rv-select:focus {
          border-color: #38bdf8;
          box-shadow: 0 0 0 3px rgba(56,189,248,0.2);
        }
        .hcu-rv-btn-save {
          border: none;
          border-radius: 6px;
          background: #0369a1;
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 500;
          color: #fff;
          cursor: pointer;
          font-family: inherit;
        }
        .hcu-rv-btn-save:hover:not(:disabled) { background: #075985; }
        .hcu-rv-btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
        .hcu-rv-btn-outline {
          border: 1px solid #d4d4d8;
          border-radius: 6px;
          background: #fff;
          padding: 6px 12px;
          font-size: 14px;
          color: #3f3f46;
          cursor: pointer;
          font-family: inherit;
        }
        .hcu-rv-btn-outline:hover:not(:disabled) { background: #fafafa; }
        .hcu-rv-btn-outline:disabled { opacity: 0.6; cursor: not-allowed; }
        .hcu-rv-nav-btn {
          border: 1px solid #d4d4d8;
          border-radius: 6px;
          background: #fff;
          padding: 4px 12px;
          font-size: 14px;
          color: #27272a;
          cursor: pointer;
          font-family: inherit;
        }
        .hcu-rv-nav-btn:hover:not(:disabled) { background: #fafafa; }
        .hcu-rv-nav-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>

      <div style={{ maxWidth: 1800, margin: '0 auto', padding: '32px 12px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#18181b', margin: 0 }}>
            건강검진 리포트 검토 및 다운로드 (
            {(draft?.coverPatientName || '환자명 미입력').trim()}/
            {(draft?.coverCheckupDate || '검진일자 미입력').trim()})
          </h1>
          <p style={{ fontSize: 14, color: '#52525b', margin: 0 }}>검토 내용을 저장하면 원본 케이스에 즉시 반영됩니다.</p>
          {expiresAt && (
            <p style={{ fontSize: 12, color: '#71717a', margin: 0 }}>링크 만료: {new Date(expiresAt).toLocaleString('ko-KR')}</p>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => downloadPdf()} disabled={downloading || loading} className="hcu-rv-btn-outline">
            {downloading ? 'PDF 생성 중…' : 'PDF 다운로드'}
          </button>
          <button
            type="button"
            onClick={() => { setKakaoOpen(true); setKakaoError(null); setSentMsg(''); }}
            disabled={loading || !runId}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#FEE500',
              color: '#191600',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: loading || !runId ? 'not-allowed' : 'pointer',
              opacity: loading || !runId ? 0.5 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
              <path
                fill="#3C1E1E"
                d="M12 3C6.477 3 2 6.486 2 10.79c0 2.79 1.86 5.236 4.65 6.61-.205.73-.74 2.64-.847 3.05-.133.51.187.503.394.366.163-.108 2.6-1.766 3.65-2.48.51.075 1.034.114 1.553.114 5.523 0 10-3.486 10-7.79C22 6.486 17.523 3 12 3z"
              />
            </svg>
            카카오톡으로 전송
          </button>
        </div>

        {kakaoOpen && (
          <div role="presentation" onClick={() => !sending && setKakaoOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ width: 'min(92vw, 420px)', background: '#fff', borderRadius: 12, border: '1px solid #e4e4e7', padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#18181b' }}>카카오톡으로 리포트 전송</h2>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#52525b' }}>보호자 휴대폰 번호로 건강검진 결과 리포트(알림톡)를 보냅니다.</p>
              <input
                autoFocus
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="010-1234-5678"
                inputMode="numeric"
                disabled={sending}
                style={{ width: '100%', padding: '9px 12px', fontSize: 14, border: '1px solid #d4d4d8', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }}
              />
              {kakaoError && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#991b1b' }}>{kakaoError}</p>}
              {sentMsg && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#15803d', fontWeight: 600 }}>{sentMsg}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" onClick={() => setKakaoOpen(false)} disabled={sending} className="hcu-rv-btn-outline">닫기</button>
                <button type="button" onClick={() => void sendKakao()} disabled={sending || phone.replace(/\D/g, '').length < 10} className="hcu-rv-btn-save">
                  {sending ? '전송 중…' : '전송'}
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && <p style={{ fontSize: 14, color: '#71717a' }}>불러오는 중…</p>}
        {error && (
          <p style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', fontSize: 14, color: '#991b1b' }}>{error}</p>
        )}

        {draft && runId && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(480px,700px)', gap: 16, alignItems: 'start' }}>
            <section style={{ borderRadius: 12, border: '1px solid #e4e4e7', background: '#f4f4f5', padding: 12 }}>
              {previewLoading ? (
                <div style={{ borderRadius: 12, border: '1px solid #d4d4d8', background: '#fff', padding: 16, fontSize: 14, color: '#3f3f46' }}>미리보기 불러오는 중…</div>
              ) : previewError ? (
                <div style={{ borderRadius: 12, border: '1px solid #fecaca', background: '#fef2f2', padding: 16, fontSize: 14, color: '#991b1b' }}>{previewError}</div>
              ) : previewModel ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 8, border: '1px solid #e4e4e7', background: '#fff', padding: '8px 12px' }}>
                    <button type="button" onClick={() => setCurrentPageIndex((prev) => Math.max(0, prev - 1))} disabled={safePageIndex <= 0} className="hcu-rv-nav-btn">← 이전</button>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#3f3f46', margin: 0 }}>
                      {safePageIndex + 1} / {previewTotal} · {previewPages[safePageIndex]?.title ?? ''}
                    </p>
                    <button type="button" onClick={() => setCurrentPageIndex((prev) => Math.min(previewTotal - 1, prev + 1))} disabled={safePageIndex >= previewTotal - 1} className="hcu-rv-nav-btn">다음 →</button>
                  </div>
                  <div style={{ maxHeight: 'calc(100vh - 240px)', minHeight: 720, overflowY: 'auto', borderRadius: 8, border: '1px solid #d4d4d8', background: '#e4e4e7', padding: 12 }}>
                    <HealthReportPreviewPages model={previewModel} currentPageIndex={safePageIndex} />
                  </div>
                </div>
              ) : (
                <div style={{ borderRadius: 12, border: '1px solid #d4d4d8', background: '#fff', padding: 16, fontSize: 14, color: '#3f3f46' }}>미리보기 데이터가 없습니다.</div>
              )}
            </section>

            <section style={{ borderRadius: 12, border: '1px solid #e4e4e7', background: '#fff', padding: 16 }}>
              <HealthCheckupReviewEditor
                draft={draft}
                onChange={setDraft}
                onSave={() => void saveDraft()}
                saving={saving}
                activeSection={activeSection}
              />
              <ReviewImageSlotsEditor token={token} draft={draft} onChange={setDraft} activeSection={activeSection} />
            </section>
          </div>
        )}
      </div>
    </>
  );
}
