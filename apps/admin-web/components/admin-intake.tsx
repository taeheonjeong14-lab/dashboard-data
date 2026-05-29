'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { parseChartAdminHospitalsResponse, type ChartHospitalOption } from '@/lib/chart-extraction/chart-admin-hospitals';

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
  symptoms?: string[]; symptomOther?: string;
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
  const list = (p.symptoms ?? []).map((s) => (s === 'other' ? (p.symptomOther || '기타') : (SYMPTOM[s] ?? s)));
  return list.length ? list.join(', ') : '—';
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
  const [selected, setSelected] = useState<Submission | null>(null);

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

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>초진 접수</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
          병원별로 보호자가 작성한 초진 접수증을 확인합니다.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <HospitalList hospitals={hospitals} selected={hospitalId} onSelect={setHospitalId} />

        <section style={cardStyle}>
          {error ? <div style={noticeStyle}>{error}</div> : null}
          {listLoading ? (
            <Empty text="불러오는 중…" />
          ) : !hospitalId ? (
            <Empty text="왼쪽에서 병원을 선택하세요." />
          ) : items.length === 0 ? (
            <Empty text="이 병원의 초진 접수가 없습니다." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['접수일시', '보호자', '연락처', '반려동물', '상태'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} onClick={() => setSelected(s)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                    <td style={tdStyle}>{fmtDateTime(s.created_at)}</td>
                    <td style={{ ...tdStyle, color: 'var(--text)' }}>{s.owner_name || '—'}</td>
                    <td style={tdStyle}>{s.owner_phone || '—'}</td>
                    <td style={tdStyle}>{(s.pets?.length ?? s.pet_count ?? 0)}마리</td>
                    <td style={tdStyle}>
                      <StatusBadge label={STATUS_LABEL[s.status] ?? s.status} tone={s.status === 'submitted' ? 'accent' : 'muted'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {selected ? (
        <Modal title="초진 접수 상세" onClose={() => setSelected(null)}>
          <div style={{ display: 'grid', gap: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
              <Field label="보호자" value={selected.owner_name} />
              <Field label="연락처" value={selected.owner_phone} />
              <Field label="주소" value={selected.owner_address} wide />
              <Field label="접수일시" value={fmtDateTime(selected.created_at)} />
              <Field label="알게 된 경로" value={referralText(selected.referral)} />
            </div>

            <Block title={`반려동물 (${selected.pets?.length ?? 0})`}>
              {(!selected.pets || selected.pets.length === 0) ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>등록된 반려동물이 없습니다.</p>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {selected.pets.map((p, i) => (
                    <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                        {p.name || `반려동물 ${i + 1}`}
                        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                          {SPECIES[p.species ?? ''] ?? p.species ?? ''} · {petBreed(p)}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                        <Field label="성별" value={SEX[p.sex ?? ''] ?? p.sex ?? null} />
                        <Field label="나이/생일" value={petAge(p)} />
                        <Field label="동물등록" value={REGISTRATION[p.registration ?? ''] ?? p.registration ?? null} />
                        <Field label="펫보험" value={INSURANCE[p.insurance ?? ''] ?? p.insurance ?? null} />
                        <Field label="증상/내원사유" value={petSymptoms(p)} wide />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Block>

            <Block title="동의">
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'grid', gap: 4 }}>
                <div>필수(진료 목적): <strong style={{ color: selected.consent_required ? 'var(--success)' : 'var(--danger)' }}>{selected.consent_required ? '동의' : '미동의'}</strong></div>
                <div>선택(마케팅): <strong style={{ color: selected.consent_marketing ? 'var(--success)' : 'var(--text-muted)' }}>{selected.consent_marketing ? '동의' : '미동의'}</strong></div>
              </div>
            </Block>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ── 공유 소품 ───────────────────────────────────────────
function HospitalList({
  hospitals, selected, onSelect,
}: {
  hospitals: ChartHospitalOption[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside style={{ width: 220, flexShrink: 0, ...cardStyle, padding: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '6px 10px', letterSpacing: '0.02em' }}>병원</div>
      {hospitals.length === 0 ? (
        <div style={{ padding: '10px', fontSize: 13, color: 'var(--text-muted)' }}>불러오는 중…</div>
      ) : (
        hospitals.map((h) => {
          const active = h.id === selected;
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => onSelect(h.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px',
                border: 'none', borderRadius: 'var(--radius)',
                background: active ? 'var(--accent-subtle)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: active ? 600 : 500, fontSize: 13, cursor: 'pointer',
              }}
            >
              {h.name_ko}
            </button>
          );
        })
      )}
    </aside>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{value || '—'}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: 'accent' | 'muted' }) {
  const colors = tone === 'accent'
    ? { bg: 'var(--accent-subtle)', fg: 'var(--accent)' }
    : { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.fg }}>
      {label}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>{text}</div>;
}

const cardStyle: CSSProperties = {
  flex: 1, minWidth: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16,
};
const noticeStyle: CSSProperties = {
  padding: '10px 12px', marginBottom: 12, fontSize: 13, color: 'var(--danger)', background: 'var(--danger-subtle)', borderRadius: 'var(--radius)',
};
const thStyle: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11,
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', letterSpacing: '0.04em', textTransform: 'uppercase',
};
const tdStyle: CSSProperties = {
  padding: '11px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};
