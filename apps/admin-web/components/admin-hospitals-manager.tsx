'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatSupabaseError } from '@/lib/format-supabase-error';

type HospitalListRow = { id: string; name?: string; address?: string; addressDetail?: string; address_detail?: string };

const railDivider = '1px solid var(--admin-divider, rgba(15, 23, 42, 0.1))';

/** 검색창·하단 버튼 아래 남는 영역만 목록에 할당 (넘치면 이 박스 안만 스크롤) */
const hospitalListScrollStyle: React.CSSProperties = {
  maxHeight: 'min(44vh, calc(100vh - 300px))',
  overflowY: 'auto',
  overflowX: 'hidden',
};

const EMPTY_FORM = {
  id: '',
  name: '',
  name_en: '',
  code: '',
  phone: '',
  address: '',
  addressDetail: '',
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
  searchad_customer_id: '',
  searchad_api_license: '',
  searchad_secret_key_encrypted: '',
  googleads_customer_id: '',
  googleads_refresh_token_encrypted: '',
  intake_survey_enabled: false,
  competitors: [
    { slot: 1, name: '', naver_blog_id: '' },
    { slot: 2, name: '', naver_blog_id: '' },
    { slot: 3, name: '', naver_blog_id: '' },
  ],
};

function normalizeCompetitors(raw: unknown): { slot: number; name: string; naver_blog_id: string }[] {
  const arr = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return [1, 2, 3].map((slot) => {
    const found = arr.find((c) => Number(c?.slot) === slot);
    return {
      slot,
      name: String(found?.name || ''),
      naver_blog_id: String(found?.naver_blog_id || ''),
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

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
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
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

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

  const sectionStyle: React.CSSProperties = {
    display: 'grid',
    gap: 10,
    padding: '12px 12px 14px',
    background: '#ffffff',
    borderTop: '1px solid rgba(148, 163, 184, 0.35)',
    boxSizing: 'border-box',
  };
  const summaryStyle: React.CSSProperties = {
    cursor: 'pointer',
    listStyle: 'none',
    padding: '10px 12px',
    fontSize: 12,
    fontWeight: 700,
    color: '#1e1b4b',
    userSelect: 'none',
  };
  const twoColStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

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
        <div className="adminLayoutMainColumnInset" style={{ background: 'var(--bg-subtle)' }}>
        {loading || message ? (
          <div className="adminLegacyStatus" style={{ marginBottom: 10, fontSize: 12 }}>
            {loading ? '처리 중...' : message}
          </div>
        ) : null}
        <form onSubmit={saveHospital} className="adminLegacyModalForm" style={{ gap: 6, fontSize: 12 }}>
          <details open className="adminMainAccordion adminHospitalFormAccordion">
            <summary className="adminAccordionSummary" style={summaryStyle}>
              병원 기본 정보
            </summary>
            <section style={sectionStyle}>
              <div style={twoColStyle}>
                <LabeledField label="병원 이름 (한국어) · 필수">
                  <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="병원 이름 (영어)">
                  <input value={form.name_en} onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))} style={fieldStyle} />
                </LabeledField>
              </div>
              <div style={twoColStyle}>
                <LabeledField label="병원 코드">
                  <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="전화번호">
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={fieldStyle} />
                </LabeledField>
              </div>
              <LabeledField label="병원 주소">
                <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="병원 상세주소">
                <input value={form.addressDetail} onChange={(e) => setForm((f) => ({ ...f, addressDetail: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <div style={twoColStyle}>
                <LabeledField label="대표원장 이름">
                  <input value={form.director_name_ko} onChange={(e) => setForm((f) => ({ ...f, director_name_ko: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="대표원장 도장 이미지">
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.svg"
                    style={{ fontSize: 11, maxWidth: '100%' }}
                    onChange={(e) => void uploadHospitalAsset('seal', e.target.files?.[0])}
                  />
                </LabeledField>
              </div>
              <LabeledField label="슬로건 첫 줄">
                <input value={form.tagline_line1} onChange={(e) => setForm((f) => ({ ...f, tagline_line1: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="슬로건 둘째 줄">
                <input value={form.tagline_line2} onChange={(e) => setForm((f) => ({ ...f, tagline_line2: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="블로그 인트로">
                <textarea rows={3} value={form.blog_intro} onChange={(e) => setForm((f) => ({ ...f, blog_intro: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="블로그 아웃트로">
                <textarea rows={3} value={form.blog_outro} onChange={(e) => setForm((f) => ({ ...f, blog_outro: e.target.value }))} style={fieldStyle} />
              </LabeledField>
            </section>
          </details>

          <details open className="adminMainAccordion adminHospitalFormAccordion">
            <summary className="adminAccordionSummary" style={summaryStyle}>
              병원 BI
            </summary>
            <section style={sectionStyle}>
              <LabeledField label="병원 로고 이미지">
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.svg"
                  style={{ fontSize: 11, maxWidth: '100%' }}
                  onChange={(e) => void uploadHospitalAsset('logo', e.target.files?.[0])}
                />
              </LabeledField>
              <LabeledField label="브랜드 색상 (#hex)">
                <input placeholder="var(--accent)" value={form.brandColor} onChange={(e) => setForm((f) => ({ ...f, brandColor: e.target.value }))} style={fieldStyle} />
              </LabeledField>
            </section>
          </details>

          <details open className="adminMainAccordion adminHospitalFormAccordion">
            <summary className="adminAccordionSummary" style={summaryStyle}>
              Robovet AI · 사전문진
            </summary>
            <section style={sectionStyle}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.intake_survey_enabled}
                  onChange={(e) => setForm((f) => ({ ...f, intake_survey_enabled: e.target.checked }))}
                  style={{ width: 16, height: 16, flexShrink: 0 }}
                />
                초진 접수 ↔ 사전문진 연동 사용 (연락처로 매칭해 겹치는 질문 자동 스킵·프리필)
              </label>
            </section>
          </details>

          <details open className="adminMainAccordion adminHospitalFormAccordion">
            <summary className="adminAccordionSummary" style={summaryStyle}>
              데이터수집 정보
            </summary>
            <section style={sectionStyle}>
              <div style={twoColStyle}>
                <LabeledField label="디버그 포트">
                  <input value={form.debug_port} onChange={(e) => setForm((f) => ({ ...f, debug_port: e.target.value }))} style={fieldStyle} />
                </LabeledField>
                <LabeledField label="스마트플레이스 통계 URL">
                  <input value={form.smartplace_stat_url} onChange={(e) => setForm((f) => ({ ...f, smartplace_stat_url: e.target.value }))} style={fieldStyle} />
                </LabeledField>
              </div>
              <LabeledField label="스마트플레이스 리뷰 URL (리뷰 수집용)">
                <input value={form.smartplace_review_url} onChange={(e) => setForm((f) => ({ ...f, smartplace_review_url: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="경쟁병원 (최대 3 · 상호명 + 네이버 블로그 ID)">
                <div style={{ display: 'grid', gap: 6 }}>
                  {form.competitors.map((c, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input
                        placeholder={`경쟁병원 ${i + 1} 상호명(플레이스 표기 그대로)`}
                        value={c.name}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            competitors: f.competitors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                          }))
                        }
                        style={fieldStyle}
                      />
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
                    </div>
                  ))}
                </div>
              </LabeledField>
              <LabeledField label="네이버 블로그 ID">
                <input value={form.naver_blog_id} onChange={(e) => setForm((f) => ({ ...f, naver_blog_id: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="SearchAd customer_id">
                <input value={form.searchad_customer_id} onChange={(e) => setForm((f) => ({ ...f, searchad_customer_id: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="SearchAd api_license">
                <input value={form.searchad_api_license} onChange={(e) => setForm((f) => ({ ...f, searchad_api_license: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="SearchAd secret_key_encrypted">
                <input value={form.searchad_secret_key_encrypted} onChange={(e) => setForm((f) => ({ ...f, searchad_secret_key_encrypted: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="GoogleAds customer_id">
                <input value={form.googleads_customer_id} onChange={(e) => setForm((f) => ({ ...f, googleads_customer_id: e.target.value }))} style={fieldStyle} />
              </LabeledField>
              <LabeledField label="GoogleAds refresh_token_encrypted">
                <input value={form.googleads_refresh_token_encrypted} onChange={(e) => setForm((f) => ({ ...f, googleads_refresh_token_encrypted: e.target.value }))} style={fieldStyle} />
              </LabeledField>
            </section>
          </details>

          <details open className="adminMainAccordion adminHospitalFormAccordion">
            <summary className="adminAccordionSummary" style={summaryStyle}>
              키워드 모니터링
            </summary>
            <section style={sectionStyle}>
              <LabeledField label="블로그 키워드">
                <KeywordList value={form.blog_keywords} onChange={(v) => setForm((f) => ({ ...f, blog_keywords: v }))} />
              </LabeledField>
              <LabeledField label="플레이스 키워드">
                <KeywordList value={form.place_keywords} onChange={(v) => setForm((f) => ({ ...f, place_keywords: v }))} />
              </LabeledField>
            </section>
          </details>
          <div className="adminLegacyModalActions">
            <button type="submit" className="adminLegacyPrimaryBtn" disabled={loading}>
              저장
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}

