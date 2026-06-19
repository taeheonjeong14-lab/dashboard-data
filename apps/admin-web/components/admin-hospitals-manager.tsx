'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatSupabaseError } from '@/lib/format-supabase-error';

type HospitalListRow = { id: string; name?: string; address?: string; addressDetail?: string; address_detail?: string };

const railDivider = '1px solid var(--admin-divider, rgba(15, 23, 42, 0.1))';

/** 검색창·하단 버튼 아래 남는 영역만 목록에 할당 (넘치면 이 박스 안만 스크롤) */
const hospitalListScrollStyle: React.CSSProperties = {
  maxHeight: 'min(44vh, calc(100vh - 300px))',
  overflowY: 'auto',
  overflowX: 'hidden',
};

const CHART_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '선택 안 함' },
  { value: 'woorien_pms', label: '우리엔PMS' },
  { value: 'intovet', label: '인투벳' },
  { value: 'efriends', label: '이프렌즈' },
];

const EMPTY_FORM = {
  id: '',
  name: '',
  name_en: '',
  code: '',
  phone: '',
  address: '',
  addressDetail: '',
  chart_type: '',
  vet_count: '',
  logoUrl: '',
  brandColor: '',
  director_name_ko: '',
  seal_url: '',
  tagline_line1: '',
  tagline_line2: '',
  blog_intro: '',
  blog_outro: '',
  naver_blog_id: '',
  smartplace_stat_url: '',
  smartplace_review_url: '',
  debug_port: '',
  blog_keywords: [] as string[],
  place_keywords: [] as string[],
  wish_keywords: [] as string[],
  wish_competitors: [] as string[],
  naver_login_id: '',
  naver_login_pw: '',
  searchad_customer_id: '',
  searchad_api_license: '',
  searchad_secret_key_encrypted: '',
  googleads_customer_id: '',
  googleads_refresh_token_encrypted: '',
  intake_survey_enabled: false,
  barun_plan_enabled: false,
  barun_plan_start: '',
  barun_plan_end: '',
  competitors: [
    { slot: 1, name: '', naver_blog_id: '', smartplace_review_url: '' },
    { slot: 2, name: '', naver_blog_id: '', smartplace_review_url: '' },
    { slot: 3, name: '', naver_blog_id: '', smartplace_review_url: '' },
  ],
};

function normalizeCompetitors(
  raw: unknown,
): { slot: number; name: string; naver_blog_id: string; smartplace_review_url: string }[] {
  const arr = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return [1, 2, 3].map((slot) => {
    const found = arr.find((c) => Number(c?.slot) === slot);
    return {
      slot,
      name: String(found?.name || ''),
      naver_blog_id: String(found?.naver_blog_id || ''),
      smartplace_review_url: String(found?.smartplace_review_url || ''),
    };
  });
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  letterSpacing: '-0.02em',
  lineHeight: 1.3,
};

// 필드별 "어디에 쓰이는지" 한 줄 설명
const fieldHintStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--text-muted)',
  lineHeight: 1.35,
  opacity: 0.8,
};

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  paddingTop: 4,
};
const twoColStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

// 메인 폼 섹션 — 기능(사용처) 단위. 탭으로 구분해 선택한 탭만 표시.
const FORM_SECTIONS = [
  { key: 'identity', title: '병원 기본 정보' },
  { key: 'branding', title: '병원 BI/CI' },
  { key: 'keyword', title: '키워드' },
  { key: 'competitor', title: '경쟁병원' },
  { key: 'intake', title: '서비스 구성' },
  { key: 'blog', title: '블로그 컨텐츠' },
  { key: 'crawler', title: '데이터 수집' },
  { key: 'database', title: '데이터베이스 관리' },
] as const;
type SectionKey = (typeof FORM_SECTIONS)[number]['key'];

// 경영 대시보드와 동일한 언더라인 탭 스타일
const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid var(--border)',
  overflowX: 'auto',
  marginBottom: 12,
};
function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '9px 12px',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    background: 'none',
    border: 'none',
    // border 단축속성보다 뒤에 둬야 비활성 탭이 투명(밑줄 없음)으로 유지된다.
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    marginBottom: -1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'color 0.15s',
  };
}

// 선택된 탭만 내용 표시
function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return null;
  return <section style={sectionStyle}>{children}</section>;
}

// 데이터 수집 탭 — 크롤러로 수집하는 데이터 종류별 흰 박스 섹션
function DataCard({ title, desc, children }: { title?: string; desc?: string; children: ReactNode }) {
  const hasHeader = !!(title || desc);
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      {title ? <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{title}</div> : null}
      {desc ? <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div> : null}
      <div style={{ display: 'grid', gap: 12, marginTop: hasHeader ? 12 : 0 }}>{children}</div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 0',
  fontSize: 12,
  lineHeight: 1.45,
  background: 'transparent',
  border: 0,
  borderBottom: '1px solid rgba(15, 23, 42, 0.1)',
  borderRadius: 0,
  outline: 'none',
};

function LabeledField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={fieldLabelStyle}>{label}</span>
      {hint ? <span style={fieldHintStyle}>{hint}</span> : null}
      {children}
    </div>
  );
}

// 큼직한 드래그 앤 드롭 이미지 업로드 박스 (로고·도장 등). 업로드된 이미지가 있으면 미리보기.
function AssetDropzone({
  url,
  disabled,
  onFile,
  onRemove,
}: {
  url?: string;
  disabled?: boolean;
  onFile: (file: File | undefined) => void;
  onRemove?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) onFile(e.dataTransfer.files?.[0]);
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 140,
        padding: '16px 12px',
        textAlign: 'center',
        border: `2px dashed ${dragging ? 'var(--accent)' : 'rgba(15,23,42,0.2)'}`,
        borderRadius: 8,
        background: dragging ? 'var(--accent-subtle, rgba(99,102,241,0.06))' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        boxSizing: 'border-box',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.svg"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" style={{ maxHeight: 88, maxWidth: '100%', objectFit: 'contain' }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>클릭하거나 끌어다 놓아 변경</span>
          {onRemove ? (
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation(); // 박스 클릭(파일 선택) 막기
                onRemove();
              }}
              style={{
                marginTop: 2,
                padding: '2px 10px',
                fontSize: 11,
                color: 'var(--danger)',
                background: 'transparent',
                border: '1px solid var(--danger-subtle)',
                borderRadius: 4,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              삭제
            </button>
          ) : null}
        </>
      ) : (
        <>
          <span style={{ fontSize: 22, lineHeight: 1 }}>🖼️</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>이미지를 끌어다 놓거나 클릭하여 선택</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>PNG·JPG·WEBP·SVG</span>
        </>
      )}
    </div>
  );
}

function KeywordList({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {value.map((kw, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            value={kw}
            onChange={(e) => { const next = [...value]; next[i] = e.target.value; onChange(next); }}
            style={{ ...fieldStyle, flex: 1 }}
            placeholder="키워드 입력"
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            style={{ flexShrink: 0, padding: '2px 8px', fontSize: 11, color: 'var(--danger)', background: 'transparent', border: '1px solid var(--danger-subtle)', borderRadius: 4, cursor: 'pointer' }}
          >
            삭제
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, ''])}
        style={{ alignSelf: 'flex-start', marginTop: 2, padding: '3px 10px', fontSize: 11, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid rgba(15,23,42,0.2)', borderRadius: 4, cursor: 'pointer' }}
      >
        + 행 추가
      </button>
    </div>
  );
}

export default function AdminHospitalsManager() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [hospitals, setHospitals] = useState<HospitalListRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedBalance, setSelectedBalance] = useState(0);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  // 선택된 탭만 표시. 저장은 어느 탭에서나 전체 폼 저장.
  const [activeTab, setActiveTab] = useState<SectionKey>('identity');

  const filteredHospitals = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hospitals;
    return hospitals.filter((h) => `${h.name || ''} ${h.id}`.toLowerCase().includes(q));
  }, [hospitals, query]);

  useEffect(() => {
    void refreshHospitals();
  }, []);

  async function refreshHospitals() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/data/hospitals');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '병원 조회 실패');
      const rows = (data.hospitals || []) as HospitalListRow[];
      setHospitals(rows);
      if (!selectedId && rows[0]?.id) {
        await loadHospital(rows[0].id);
      }
    } catch (e) {
      setMessage(`조회 실패: ${formatSupabaseError(e)}`);
      setHospitals([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadHospital(id: string) {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/data/hospitals/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '상세 조회 실패');
      setSelectedId(id);
      setSelectedBalance(Number(data.tokenBalance) || 0);
      const apiForm = (data.form || {}) as Record<string, unknown>;
      const toKeywordArray = (text: unknown) =>
        String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
      setForm({
        ...EMPTY_FORM,
        ...(apiForm as Partial<typeof EMPTY_FORM>),
        blog_keywords: toKeywordArray(apiForm.blog_keywords_text),
        place_keywords: toKeywordArray(apiForm.place_keywords_text),
        competitors: normalizeCompetitors(apiForm.competitors),
      });
    } catch (e) {
      setMessage(`상세 조회 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function openNewHospital() {
    setSelectedId('');
    setForm(EMPTY_FORM);
  }

  async function saveHospital(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/data/hospitals/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editingId: selectedId,
          hospitalForm: {
            ...form,
            blog_keywords_text: form.blog_keywords.filter(Boolean).join('\n'),
            place_keywords_text: form.place_keywords.filter(Boolean).join('\n'),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '저장 실패');
      setMessage('저장 완료');
      await refreshHospitals();
      if (!selectedId) {
        const newId = String(form.id || '');
        if (newId) await loadHospital(newId);
      } else {
        await loadHospital(selectedId);
      }
    } catch (e) {
      setMessage(`저장 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteHospital() {
    const id = String(selectedId || '').trim();
    if (!id) return;
    const name = form.name || id;
    const ok = typeof window !== 'undefined' && window.confirm(
      `정말 "${name}" 병원을 삭제하시겠습니까?\n\n` +
      `현재 잔여 토큰: ${Math.round(selectedBalance).toLocaleString()} 토큰\n\n` +
      `삭제하면 되돌릴 수 없습니다. (잔여 토큰 환불 등 후속 처리는 별도로 진행해야 합니다.)`,
    );
    if (!ok) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/admin/data/hospitals/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '삭제 실패');
      setMessage('병원 삭제 완료');
      setSelectedId('');
      setSelectedBalance(0);
      setForm(EMPTY_FORM);
      await refreshHospitals();
    } catch (e) {
      setMessage(`삭제 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function uploadHospitalAsset(assetType: 'logo' | 'seal', file: File | undefined) {
    const hospitalId = String(selectedId || form.id || '').trim();
    if (!hospitalId) {
      setMessage('신규 병원은 먼저 저장해 hospital_id를 만든 뒤 업로드하세요.');
      return;
    }
    if (!file) return;
    setLoading(true);
    setMessage('');
    try {
      const fd = new FormData();
      fd.set('asset_type', assetType);
      fd.set('file', file);
      const res = await fetch(`/api/admin/data/hospitals/${encodeURIComponent(hospitalId)}/assets`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드 실패');
      const url = String(data.url || '');
      if (assetType === 'logo') setForm((f) => ({ ...f, logoUrl: url }));
      else setForm((f) => ({ ...f, seal_url: url }));
      setMessage(`${assetType === 'logo' ? '로고' : '도장'} 업로드 완료`);
    } catch (e) {
      setMessage(`업로드 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function removeHospitalAsset(assetType: 'logo' | 'seal') {
    const hospitalId = String(selectedId || form.id || '').trim();
    if (!hospitalId) {
      setMessage('병원을 먼저 저장한 뒤 삭제할 수 있습니다.');
      return;
    }
    const label = assetType === 'logo' ? '로고' : '도장';
    if (typeof window !== 'undefined' && !window.confirm(`${label} 이미지를 삭제할까요?`)) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(
        `/api/admin/data/hospitals/${encodeURIComponent(hospitalId)}/assets?asset_type=${assetType}`,
        { method: 'DELETE' },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || '삭제 실패');
      if (assetType === 'logo') setForm((f) => ({ ...f, logoUrl: '' }));
      else setForm((f) => ({ ...f, seal_url: '' }));
      setMessage(`${label} 삭제 완료`);
    } catch (e) {
      setMessage(`삭제 실패: ${formatSupabaseError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="adminLayout2WithMain">
      <aside className="adminLayoutSecondaryRail" aria-label="병원 목록">
        <div className="adminRailToolbar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="병원 검색"
            aria-label="병원 검색"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 0',
              background: 'transparent',
              border: 0,
              borderRadius: 0,
              outline: 'none',
              font: 'inherit',
              fontSize: 12,
            }}
            disabled={loading}
          />
        </div>
        <div style={hospitalListScrollStyle}>
          {filteredHospitals.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`adminRailRow${selectedId === h.id ? ' adminRailRowActive' : ''}`}
              onClick={() => void loadHospital(h.id)}
              disabled={loading}
            >
              <span style={{ display: 'block', fontWeight: 700 }}>{h.name || '(이름 없음)'}</span>
              <span className="adminRailSub">
                {(h.address || '').trim() || (h.addressDetail || h.address_detail || '').trim() || '주소 미입력'}
              </span>
            </button>
          ))}
        </div>
        <div style={{ flexShrink: 0, padding: '10px', borderTop: railDivider, background: '#fff' }}>
          <button
            type="button"
            className="adminLegacyPrimaryBtn"
            onClick={openNewHospital}
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px 14px',
              borderRadius: 0,
              fontWeight: 700,
              fontSize: 12,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            신규 병원 추가
          </button>
        </div>
      </aside>

      <div className="adminLayoutMainPane">
        <div className="adminLayoutMainColumnInset">
        {/* 페이지 헤더 — 선택한 병원 이름·주소 (병원에 따라 동적 변경) */}
        <div style={{ paddingTop: 16, marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {form.name.trim() || (selectedId ? '(이름 없음)' : '신규 병원')}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {[form.address, form.addressDetail].map((s) => s.trim()).filter(Boolean).join(' ') || '주소 미입력'}
          </p>
        </div>
        {loading || message ? (
          <div className="adminLegacyStatus" style={{ marginBottom: 10, fontSize: 12 }}>
            {loading ? '처리 중...' : message}
          </div>
        ) : null}
        {/* 탭바 — 선택한 탭의 필드만 표시 (경영 대시보드와 동일한 언더라인 스타일) */}
        <div style={tabBarStyle} className="adminUnderlineTabs" role="tablist">
          {FORM_SECTIONS.map((s) => {
            const active = activeTab === s.key;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(s.key)}
                style={tabButtonStyle(active)}
              >
                {s.title}
              </button>
            );
          })}
        </div>

        <form onSubmit={saveHospital} className="adminLegacyModalForm" style={{ gap: 6, fontSize: 12 }}>
          {/* 🏥 병원 기본 정보 */}
          <TabPanel active={activeTab === 'identity'}>
            <DataCard>
              <div style={twoColStyle}>
                <LabeledField label="병원 이름 (한국어) · 필수" hint="전역 표시·차트 매칭의 기준이 되는 정식 병원명">
                  <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="병원 이름 (영어)" hint="영문 문서·도메인 표기에 사용">
                  <input value={form.name_en} onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))} style={fieldStyle} />
                </LabeledField>
              </div>
              <div style={twoColStyle}>
                <LabeledField label="대표원장 이름" hint="리포트 서명란 등에 표기되는 대표원장 이름">
                  <input value={form.director_name_ko} onChange={(e) => setForm((f) => ({ ...f, director_name_ko: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="전화번호" hint="리포트·문서에 표기되는 대표 전화">
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={fieldStyle} />
                </LabeledField>
              </div>
              <div style={twoColStyle}>
                <LabeledField label="병원 주소" hint="리포트 표지·문서에 표기되는 주소">
                  <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="상세주소" hint="동·호수 등 상세주소">
                  <input value={form.addressDetail} onChange={(e) => setForm((f) => ({ ...f, addressDetail: e.target.value }))} style={fieldStyle} />
                </LabeledField>
              </div>
              <div style={twoColStyle}>
                <LabeledField label="차트 종류" hint="병원이 사용하는 차트(PMS) 종류">
                  <select value={form.chart_type} onChange={(e) => setForm((f) => ({ ...f, chart_type: e.target.value }))} style={fieldStyle}>
                    {CHART_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </LabeledField>
                <LabeledField label="수의사 수" hint="병원 소속 수의사 인원">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={form.vet_count}
                    onChange={(e) => setForm((f) => ({ ...f, vet_count: e.target.value }))}
                    style={fieldStyle}
                    placeholder="예: 3"
                  />
                </LabeledField>
              </div>
            </DataCard>
          </TabPanel>

          {/* 🎨 병원 BI/CI — 리포트·블로그 표지 등에 쓰이는 브랜드 자산 */}
          <TabPanel active={activeTab === 'branding'}>
            <DataCard>
              <div style={twoColStyle}>
                <LabeledField label="슬로건 첫 줄" hint="리포트 표지 슬로건 문구">
                  <input value={form.tagline_line1} onChange={(e) => setForm((f) => ({ ...f, tagline_line1: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="슬로건 둘째 줄" hint="리포트 표지 슬로건 둘째 줄">
                  <input value={form.tagline_line2} onChange={(e) => setForm((f) => ({ ...f, tagline_line2: e.target.value }))} style={fieldStyle} />
                </LabeledField>
              </div>
              <LabeledField label="브랜드 색상 (#hex)" hint="리포트·블로그 표지 강조색">
                <input placeholder="var(--accent)" value={form.brandColor} onChange={(e) => setForm((f) => ({ ...f, brandColor: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <div style={twoColStyle}>
                <LabeledField label="병원 로고 이미지" hint="리포트·문서 표지 상단 로고">
                  <AssetDropzone
                    url={form.logoUrl}
                    disabled={loading}
                    onFile={(file) => void uploadHospitalAsset('logo', file)}
                    onRemove={() => void removeHospitalAsset('logo')}
                  />
                </LabeledField>
                <LabeledField label="대표원장 도장 이미지" hint="리포트 마지막 장 대표원장 서명 도장">
                  <AssetDropzone
                    url={form.seal_url}
                    disabled={loading}
                    onFile={(file) => void uploadHospitalAsset('seal', file)}
                    onRemove={() => void removeHospitalAsset('seal')}
                  />
                </LabeledField>
              </div>
            </DataCard>
          </TabPanel>

          {/* 키워드 — 블로그·플레이스 검색 순위 모니터링 키워드 모음 (흰 박스 2열) */}
          <TabPanel active={activeTab === 'keyword'}>
            {form.wish_keywords.length > 0 && (
              <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--accent-subtle)', borderRadius: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                <b style={{ color: 'var(--accent)' }}>마스터 희망 키워드</b>: {form.wish_keywords.join(', ')}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
              <DataCard title="플레이스 키워드" desc="플레이스 검색 순위 모니터링 대상 키워드">
                <KeywordList value={form.place_keywords} onChange={(v) => setForm((f) => ({ ...f, place_keywords: v }))} />
              </DataCard>
              <DataCard title="블로그 키워드" desc="블로그 검색 순위 모니터링 대상 키워드">
                <KeywordList value={form.blog_keywords} onChange={(v) => setForm((f) => ({ ...f, blog_keywords: v }))} />
              </DataCard>
            </div>
          </TabPanel>

          {/* ✍️ 블로그 컨텐츠 — 인트로·아웃트로 흰 박스 2열 */}
          <TabPanel active={activeTab === 'blog'}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
              <DataCard title="블로그 인트로" desc="블로그 글 생성 시 도입부 프롬프트로 사용">
                <textarea rows={4} value={form.blog_intro} onChange={(e) => setForm((f) => ({ ...f, blog_intro: e.target.value }))} style={fieldStyle} />
              </DataCard>
              <DataCard title="블로그 아웃트로" desc="블로그 글 생성 시 마무리 프롬프트로 사용">
                <textarea rows={4} value={form.blog_outro} onChange={(e) => setForm((f) => ({ ...f, blog_outro: e.target.value }))} style={fieldStyle} />
              </DataCard>
            </div>
          </TabPanel>

          {/* 📊 데이터 수집(크롤러) — 좌: 블로그·플레이스 / 우: 네이버 검색광고 */}
          <TabPanel active={activeTab === 'crawler'}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
              {/* 좌측 칼럼 */}
              <div style={{ display: 'grid', gap: 12 }}>
                <DataCard title="네이버 로그인 계정" desc="정확한 데이터 수집·분석·관리를 위해 병원 네이버 아이디를 요청드립니다. 비밀번호가 타 계정과 동일하면 변경 후 입력하도록 안내해 주세요. (평문 저장 — 민감정보)">
                  <LabeledField label="네이버 아이디">
                    <input value={form.naver_login_id} onChange={(e) => setForm((f) => ({ ...f, naver_login_id: e.target.value }))} style={fieldStyle} autoComplete="off" />
                  </LabeledField>
                  <LabeledField label="네이버 비밀번호">
                    <input type="text" value={form.naver_login_pw} onChange={(e) => setForm((f) => ({ ...f, naver_login_pw: e.target.value }))} style={fieldStyle} autoComplete="off" />
                  </LabeledField>
                </DataCard>

                <DataCard title="디버그 포트" desc="수집 크롤러(크롬) 공용 디버그 포트.">
                  <LabeledField label="디버그 포트" hint="모든 수집에 공용으로 쓰이는 크롬 디버그 포트">
                    <input value={form.debug_port} onChange={(e) => setForm((f) => ({ ...f, debug_port: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                </DataCard>

                <DataCard title="블로그 일별 지표" desc="네이버 블로그에서 일별 방문·발행 등 지표를 수집합니다.">
                  <LabeledField label="네이버 블로그 ID" hint="지표를 수집할 병원 네이버 블로그 ID">
                    <input value={form.naver_blog_id} onChange={(e) => setForm((f) => ({ ...f, naver_blog_id: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                </DataCard>

                <DataCard title="스마트플레이스 유입" desc="스마트플레이스 통계에서 유입·조회 지표를 수집합니다.">
                  <LabeledField label="스마트플레이스 통계 URL" hint="플레이스 통계 수집 대상 URL">
                    <input value={form.smartplace_stat_url} onChange={(e) => setForm((f) => ({ ...f, smartplace_stat_url: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                </DataCard>

                <DataCard title="스마트플레이스 리뷰 추이" desc="스마트플레이스 리뷰 수·내용 추이를 수집합니다.">
                  <LabeledField label="스마트플레이스 리뷰 URL" hint="리뷰 수집 대상 URL">
                    <input value={form.smartplace_review_url} onChange={(e) => setForm((f) => ({ ...f, smartplace_review_url: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                </DataCard>
              </div>

              {/* 우측 칼럼 */}
              <div style={{ display: 'grid', gap: 12 }}>
                <DataCard title="네이버 검색광고" desc="네이버 검색광고 API로 광고 성과 지표를 수집합니다.">
                  <LabeledField label="SearchAd customer_id" hint="네이버 검색광고 API customer_id">
                    <input value={form.searchad_customer_id} onChange={(e) => setForm((f) => ({ ...f, searchad_customer_id: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                  <LabeledField label="SearchAd api_license" hint="네이버 검색광고 API 라이선스 키">
                    <input value={form.searchad_api_license} onChange={(e) => setForm((f) => ({ ...f, searchad_api_license: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                  <LabeledField label="SearchAd secret_key_encrypted" hint="네이버 검색광고 시크릿 (암호화 저장)">
                    <input value={form.searchad_secret_key_encrypted} onChange={(e) => setForm((f) => ({ ...f, searchad_secret_key_encrypted: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                </DataCard>

                <DataCard title="구글 광고" desc="구글 광고 API로 광고 성과 지표를 수집합니다.">
                  <LabeledField label="GoogleAds customer_id" hint="구글 광고 customer_id">
                    <input value={form.googleads_customer_id} onChange={(e) => setForm((f) => ({ ...f, googleads_customer_id: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                  <LabeledField label="GoogleAds refresh_token_encrypted" hint="구글 광고 refresh token (암호화 저장)">
                    <input value={form.googleads_refresh_token_encrypted} onChange={(e) => setForm((f) => ({ ...f, googleads_refresh_token_encrypted: e.target.value }))} style={fieldStyle} />
                  </LabeledField>
                </DataCard>
              </div>
            </div>
          </TabPanel>

          {/* ⚔️ 경쟁병원 분석 — 경쟁병원별 흰 박스 (최대 3) */}
          <TabPanel active={activeTab === 'competitor'}>
            {form.wish_competitors.length > 0 && (
              <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--accent-subtle)', borderRadius: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                <b style={{ color: 'var(--accent)' }}>마스터 희망 경쟁병원</b>: {form.wish_competitors.join(', ')}
              </div>
            )}
            <div style={{ display: 'grid', gap: 12 }}>
              {form.competitors.map((c, i) => (
                <DataCard key={i} title={`경쟁병원 ${i + 1}`} desc="경쟁병원 분석 메뉴의 비교 대상으로 사용">
                  <div style={twoColStyle}>
                    <LabeledField label="상호명" hint="플레이스 표기 그대로 입력">
                      <input
                        placeholder="상호명(플레이스 표기 그대로)"
                        value={c.name}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            competitors: f.competitors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          }))
                        }
                        style={fieldStyle}
                      />
                    </LabeledField>
                    <LabeledField label="네이버 블로그 ID" hint="경쟁병원 네이버 블로그 ID">
                      <input
                        placeholder="네이버 블로그 ID"
                        value={c.naver_blog_id}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            competitors: f.competitors.map((x, j) => (j === i ? { ...x, naver_blog_id: e.target.value } : x)),
                          }))
                        }
                        style={fieldStyle}
                      />
                    </LabeledField>
                  </div>
                  <LabeledField label="스마트플레이스 리뷰 URL" hint="리뷰 추이 수집 대상(경쟁병원 플레이스 리뷰 페이지)">
                    <input
                      placeholder="https://m.place.naver.com/.../review/visitor"
                      value={c.smartplace_review_url}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          competitors: f.competitors.map((x, j) => (j === i ? { ...x, smartplace_review_url: e.target.value } : x)),
                        }))
                      }
                      style={fieldStyle}
                    />
                  </LabeledField>
                </DataCard>
              ))}
            </div>
          </TabPanel>

          {/* 🤖 사전문진·초진 접수 */}
          <TabPanel active={activeTab === 'intake'}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.intake_survey_enabled}
                onChange={(e) => setForm((f) => ({ ...f, intake_survey_enabled: e.target.checked }))}
                style={{ width: 16, height: 16, flexShrink: 0 }}
              />
              초진 접수 ↔ 사전문진 연동 사용 (연락처로 매칭해 겹치는 질문 자동 스킵·프리필)
            </label>
          </TabPanel>

          {/* 🗄️ 데이터베이스 관리 — 시스템 내부에서 병원을 식별/관리하기 위한 값 */}
          <TabPanel active={activeTab === 'database'}>
            <LabeledField label="병원 코드" hint="시스템 내부에서 병원을 식별·관리하기 위한 코드">
              <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} style={fieldStyle} />
            </LabeledField>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', marginTop: 14 }}>
              <input
                type="checkbox"
                checked={form.barun_plan_enabled}
                onChange={(e) => setForm((f) => ({ ...f, barun_plan_enabled: e.target.checked }))}
                style={{ width: 16, height: 16, flexShrink: 0 }}
              />
              바른반려연구소 플랜 고객 (플랜 기간 동안 진료케이스 토큰 차감 면제 · 종료일 이후 정상 차감)
            </label>
            {form.barun_plan_enabled ? (
              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <LabeledField label="플랜 시작일">
                  <input type="date" value={form.barun_plan_start} onChange={(e) => setForm((f) => ({ ...f, barun_plan_start: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="플랜 종료일" hint="이 날짜까지 면제, 다음날부터 차감">
                  <input type="date" value={form.barun_plan_end} onChange={(e) => setForm((f) => ({ ...f, barun_plan_end: e.target.value }))} style={fieldStyle} />
                </LabeledField>
              </div>
            ) : null}
          </TabPanel>

          <div className="adminLegacyModalActions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button type="submit" className="adminLegacyPrimaryBtn" disabled={loading}>
              저장
            </button>
            {selectedId ? (
              <button type="button" onClick={() => void deleteHospital()} disabled={loading}
                style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 6, border: '1px solid var(--danger)', background: '#fff', color: 'var(--danger)', cursor: 'pointer' }}>
                병원 삭제
              </button>
            ) : null}
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}

