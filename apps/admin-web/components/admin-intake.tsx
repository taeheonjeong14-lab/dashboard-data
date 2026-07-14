'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseChartAdminHospitalsResponse, type ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';
import {
  PageHeader, Section, Field, FieldGrid, Badge, Empty, Notice, thStyle, tdStyle,
} from '@/components/ui/admin-ui';

// 코드 → 라벨 (hospital-web lib/intake/form-spec.ts 와 동일 값; 앱 경계라 복제)
const SPECIES: Record<string, string> = { dog: '강아지', cat: '고양이', other: '그 외' };
const SEX: Record<string, string> = {
  male_neutered: '남아 (중성화)', female_neutered: '여아 (중성화)',
  male_intact: '남아 (중성화 X)', female_intact: '여아 (중성화 X)',
};
const REGISTRATION: Record<string, string> = { internal: '내장형 등록', external: '외장형 등록', none: '미등록' };
const INSURANCE: Record<string, string> = { yes: '가입', no: '미가입' };
const SYMPTOM: Record<string, string> = {
  skin: '피부', eye: '눈', ear: '귀', nose: '코', oral: '구강', breathing: '호흡', leg: '다리',
  behavior: '행동', eating: '식이', genital: '생식기', urine: '소변', digestion: '소화',
  checkup: '건강검진', vaccine: '예방접종', registration: '동물등록', parasite: '기생충약', other: '기타',
};
const REFERRAL_CHANNEL: Record<string, string> = { online: '온라인 매체', outdoor: '옥외 간판', acquaintance: '지인 소개', other: '기타' };
const ONLINE_MEDIA: Record<string, string> = { naver: '네이버', google: '구글', daum: '다음(카카오)', instagram: '인스타그램', danggeun: '당근마켓' };

type Pet = {
  name?: string; species?: string; breed?: string; breedOther?: string;
  birthDate?: string; ageUnknown?: boolean; ageText?: string;
  sex?: string; registration?: string; insurance?: string;
  symptoms?: string[]; symptomDetail?: string;
};
type Referral = { channel?: string; onlineMedia?: string[]; acquaintanceDetail?: string; otherDetail?: string };
type Submission = {
  id: string;
  owner_name: string | null;
  owner_phone: string | null;
  owner_address: string | null;
  pet_count: number | null;
  pets: Pet[];
  referral: Referral;
  consent_required: boolean;
  consent_marketing: boolean;
  status: string;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = { submitted: '제출됨', seen: '확인함', archived: '보관' };

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function petAge(p: Pet): string {
  if (p.ageUnknown) return p.ageText ? `약 ${p.ageText}세` : '나이 모름';
  return p.birthDate || '—';
}
function petBreed(p: Pet): string {
  if (p.breed && p.breed !== '기타' && p.breed !== '그 외') return p.breed;
  return p.breedOther || p.breed || '—';
}
function petSymptoms(p: Pet): string {
  const list = (p.symptoms ?? []).map((s) => (s === 'other' ? (p.symptomDetail || '기타') : (SYMPTOM[s] ?? s)));
  return list.length ? list.join(', ') : '—';
}
function petNames(s: Submission): string {
  const names = (s.pets ?? []).map((p) => p.name?.trim()).filter(Boolean);
  return names.length ? names.join(' / ') : '—';
}
function referralText(r: Referral): string {
  if (!r || !r.channel) return '—';
  const base = REFERRAL_CHANNEL[r.channel] ?? r.channel;
  if (r.channel === 'online' && r.onlineMedia?.length) {
    return `${base} — ${r.onlineMedia.map((m) => ONLINE_MEDIA[m] ?? m).join(', ')}`;
  }
  if (r.channel === 'acquaintance' && r.acquaintanceDetail) return `${base} — ${r.acquaintanceDetail}`;
  if (r.channel === 'other' && r.otherDetail) return `${base} — ${r.otherDetail}`;
  return base;
}

export default function AdminIntake() {
  const [hospitals, setHospitals] = useState<ChartHospitalOption[]>([]);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [items, setItems] = useState<Submission[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/admin/data/hospitals', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const list = parseChartAdminHospitalsResponse(d);
        setHospitals(list);
        setHospitalId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch(() => setError('병원 목록을 불러오지 못했습니다.'));
  }, []);

  const load = useCallback((hid: string) => {
    setListLoading(true);
    setError(null);
    fetch(`/api/admin/intake/submissions?hospitalId=${encodeURIComponent(hid)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('목록을 불러오지 못했습니다.'))))
      .then((d: { submissions: Submission[] }) => setItems(d.submissions ?? []))
      .catch((e) => {
        setItems([]);
        setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
      })
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    if (!hospitalId) {
      setItems([]);
      return;
    }
    load(hospitalId);
  }, [hospitalId, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => {
      const hay = [s.owner_name ?? '', s.owner_phone ?? '', petNames(s), s.owner_address ?? ''].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  // 목록이 바뀌면 첫 항목 선택 유지
  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((cur) => (cur && filtered.some((s) => s.id === cur) ? cur : filtered[0]!.id));
  }, [filtered]);

  const selected = filtered.find((s) => s.id === selectedId) ?? null;

  const hospitalSelect = (
    <select
      value={hospitalId ?? ''}
      onChange={(e) => setHospitalId(e.target.value || null)}
      style={{
        padding: '8px 10px', fontSize: 14, color: 'var(--text)', background: 'var(--bg)',
        border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none', cursor: 'pointer',
      }}
    >
      {hospitals.length === 0 ? <option value="">불러오는 중…</option> : null}
      {hospitals.map((h) => (
        <option key={h.id} value={h.id}>{h.name_ko}</option>
      ))}
    </select>
  );

  return (
    <div>
      <PageHeader
        title="초진 접수"
        description="병원별로 보호자가 작성한 초진 접수증을 확인합니다."
        actions={hospitalSelect}
      />

      {error ? <Notice danger>{error}</Notice> : null}

      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* ── 좌측: 접수 목록 ── */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <div style={{ padding: '0 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              접수 목록
              {items.length > 0 && (
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                  {filtered.length === items.length ? `${items.length}건` : `${filtered.length} / ${items.length}건`}
                </span>
              )}
            </span>
          </div>

          {listLoading ? (
            <Empty text="불러오는 중…" />
          ) : !hospitalId ? (
            <Empty text="병원을 선택하세요." />
          ) : items.length === 0 ? (
            <Empty title="아직 접수된 초진 접수증이 없습니다" text="보호자가 접수증을 작성하면 여기에 표시됩니다." />
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="보호자·연락처·환자 검색"
                  style={{
                    width: '100%', padding: '8px 10px', fontSize: 14, color: 'var(--text)', background: 'var(--bg)',
                    border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none',
                  }}
                />
              </div>

              {filtered.length === 0 ? (
                <Empty text="검색 결과가 없습니다." />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle)' }}>
                      {['접수일시', '보호자', '연락처', '반려동물', '상태'].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedId(s.id)}
                        style={{
                          cursor: 'pointer',
                          borderBottom: '1px solid var(--border)',
                          background: selectedId === s.id ? 'var(--accent-subtle)' : 'transparent',
                        }}
                      >
                        <td style={tdStyle}>{fmtDateTime(s.created_at)}</td>
                        <td style={{ ...tdStyle, color: 'var(--text)' }}>{s.owner_name || '—'}</td>
                        <td style={tdStyle}>{s.owner_phone || '—'}</td>
                        <td style={tdStyle}>{(s.pets?.length ?? s.pet_count ?? 0)}마리</td>
                        <td style={tdStyle}>
                          <Badge tone={s.status === 'submitted' ? 'accent' : 'muted'}>
                            {STATUS_LABEL[s.status] ?? s.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        {/* ── 우측: 접수 상세 ── */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', paddingLeft: 24 }}>
          <div style={{ padding: '0 0 12px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>접수 상세</div>
            {selected && (
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>{fmtDateTime(selected.created_at)} 접수</div>
            )}
          </div>
          {selected ? <Detail s={selected} /> : (
            <div style={{ fontSize: 14, color: 'var(--text-muted)', padding: '8px 0' }}>왼쪽에서 항목을 선택하세요.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ s }: { s: Submission }) {
  const petCount = s.pets?.length ?? 0;
  return (
    <div>
      <Section title="보호자 정보" first>
        <FieldGrid>
          <Field label="보호자" value={s.owner_name} />
          <Field label="연락처" value={s.owner_phone} />
          <Field label="주소" value={s.owner_address} wide />
        </FieldGrid>
      </Section>

      <Section title={`반려동물 (${petCount})`}>
        {petCount === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>등록된 반려동물이 없습니다.</p>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {s.pets.map((p, i) => (
              <div key={i}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                  {p.name || `반려동물 ${i + 1}`}
                  <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {SPECIES[p.species ?? ''] ?? p.species ?? ''} · {petBreed(p)}
                  </span>
                </div>
                <FieldGrid>
                  <Field label="성별" value={SEX[p.sex ?? ''] ?? p.sex ?? null} />
                  <Field label="나이/생일" value={petAge(p)} />
                  <Field label="동물등록" value={REGISTRATION[p.registration ?? ''] ?? p.registration ?? null} />
                  <Field label="펫보험" value={INSURANCE[p.insurance ?? ''] ?? p.insurance ?? null} />
                  <Field label="증상/내원사유" value={petSymptoms(p)} wide />
                </FieldGrid>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="유입 경로 및 동의">
        <FieldGrid>
          <Field label="알게 된 경로" value={referralText(s.referral)} wide />
          <Field
            label="진료 목적(필수)"
            value={
              <span style={{ color: s.consent_required ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                {s.consent_required ? '동의' : '미동의'}
              </span>
            }
          />
          <Field
            label="마케팅(선택)"
            value={
              <span style={{ color: s.consent_marketing ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                {s.consent_marketing ? '동의' : '미동의'}
              </span>
            }
          />
        </FieldGrid>
      </Section>
    </div>
  );
}
