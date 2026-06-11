'use client';

import { useEffect, useState } from 'react';
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
} from '@/app/components/report/health-report-preview-pages';
import type { HealthPreviewEditableSection } from '@/app/components/report/health-report-preview-pages';
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

function CharCountLine({ current, max, min }: { current: number; max: number; min?: number }) {
  const overMax = current > max;
  const belowMin = !overMax && min !== undefined && current < min;
  const color = overMax ? '#b91c1c' : belowMin ? '#b45309' : '#a1a1aa';
  const weight = overMax || belowMin ? '500' : '400';
  return (
    <p style={{ textAlign: 'right', fontSize: 11, color, fontWeight: weight, fontVariantNumeric: 'tabular-nums', margin: 0 }}>
      {current} / {max}자{min !== undefined ? ` (최소 ${min}자)` : ''}
      {overMax ? ' (최대 글자수를 초과하였습니다.)' : ''}
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
                  {DISEASE_BOX_PAGE_KEYS.includes(key) && (b.diseaseOptions ?? []).some((o) => o.enabled) && (
                    <div style={{ minWidth: 0, marginTop: 4, paddingTop: 12, borderTop: '1px dashed #e4e4e7', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: '#52525b', margin: 0 }}>
                        질환 소개 박스 <span style={{ fontWeight: 400, color: '#a1a1aa' }}>(본문 편집)</span>
                      </p>
                      {(b.diseaseOptions ?? []).map((opt, oi) =>
                        opt.enabled ? (
                          <label key={oi} style={{ display: 'block' }}>
                            <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#52525b', marginBottom: 4 }}>{opt.name}{iranSuffix(opt.name)}?</span>
                            <textarea className="hcu-rv-textarea" style={{ minHeight: 80 }} maxLength={DISEASE_BODY_MAX} value={opt.body} onChange={(e) => setSystemsOptionBody(key, bi, oi, e.target.value)} />
                            <CharCountLine current={opt.body.length} max={DISEASE_BODY_MAX} />
                          </label>
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

// ——— main client component ———

export default function HealthCheckupShareReviewClient() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
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
        </div>

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
            </section>
          </div>
        )}
      </div>
    </>
  );
}
