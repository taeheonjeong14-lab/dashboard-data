'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { Copy, Check } from 'lucide-react';
import { StickyHeader } from '@/components/ui/sticky-header';
import { useHospital } from '@/components/shell/hospital-context';
import { SessionDetailModal } from '@/components/pre-consultation/session-detail';
import {
  SPECIES_OPTIONS, SEX_OPTIONS, REGISTRATION_OPTIONS, INSURANCE_OPTIONS,
  SYMPTOM_OPTIONS, REFERRAL_CHANNEL_OPTIONS, ONLINE_MEDIA_OPTIONS, labelOf,
  type PetAnswer, type ReferralAnswer,
} from '@/lib/intake/form-spec';

export type Submission = {
  id: string;
  hospital_id: string;
  owner_name: string | null;
  owner_phone: string | null;
  owner_address: string | null;
  pet_count: number | null;
  pets: PetAnswer[] | null;
  referral: ReferralAnswer | null;
  consent_required: boolean;
  consent_marketing: boolean;
  status: string;
  created_at: string;
};

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
function fmtDateTimeFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return iso; }
}
function petNames(s: Submission): string {
  const names = (s.pets ?? []).map((p) => p.name?.trim()).filter(Boolean);
  return names.length ? names.join(' / ') : '—';
}
function petAge(p: PetAnswer): string {
  if (p.birthDate) return p.birthDate;
  if (p.ageText) return `약 ${p.ageText}세`;
  return '—';
}
function petBreed(p: PetAnswer): string {
  if (!p.breed) return '—';
  return p.breed === '기타' || p.breed === '그 외' ? p.breedOther || p.breed : p.breed;
}
function hasLinkedSurvey(s: Submission): boolean {
  return linkedSurveySessionIds(s).length > 0;
}
function linkedSurveySessionIds(s: Submission): string[] {
  const ids: string[] = [];
  for (const p of s.pets ?? []) {
    if (p?.surveyLinked === true && typeof p.surveySessionId === 'string' && p.surveySessionId) {
      ids.push(p.surveySessionId);
    }
  }
  // 중복 제거(같은 사전문진에 여러 환자가 매핑되는 케이스는 없지만 방어적으로).
  return Array.from(new Set(ids));
}
function referralText(r: ReferralAnswer | null): string {
  if (!r || !r.channel) return '—';
  const base = labelOf(REFERRAL_CHANNEL_OPTIONS, r.channel);
  if (r.channel === 'online' && r.onlineMedia?.length) return `${base} (${r.onlineMedia.map((m) => labelOf(ONLINE_MEDIA_OPTIONS, m)).join(', ')})`;
  if (r.channel === 'acquaintance' && r.acquaintanceDetail) return `${base} (${r.acquaintanceDetail})`;
  if (r.channel === 'other' && r.otherDetail) return `${base} (${r.otherDetail})`;
  return base;
}

export function ReceptionList({ items, hasHospital, loadError, hospitalId }: {
  items: Submission[]; hasHospital: boolean; loadError: string | null; hospitalId: string | null;
}) {
  const router = useRouter();
  const { userId } = useHospital();
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const selected = items.find((s) => s.id === selectedId) ?? null;
  /** 사전문진 기록 모달 — 클릭한 row 의 surveySessionId 들 */
  const [surveyModalIds, setSurveyModalIds] = useState<string[]>([]);
  const surveyModalOpen = surveyModalIds.length > 0;

  const [query, setQuery] = useState('');
  const filtered = items.filter((s) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    const hay = [s.owner_name ?? '', s.owner_phone ?? '', petNames(s), s.owner_address ?? ''].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const formUrl = hospitalId && origin ? `${origin}/intake/${hospitalId}` : '';
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  async function copyLink() {
    if (!formUrl) return;
    try {
      await navigator.clipboard.writeText(formUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch { /* 클립보드 미지원/거부 */ }
  }

  return (
    <div>
      <StickyHeader>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 0, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>초진 접수</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            보호자가 작성한 초진 접수증을 확인합니다.
          </p>
        </div>
        {hasHospital && (
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            style={{ padding: '9px 16px', border: 'none', borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
          >
            보호자 접수 링크
          </button>
        )}
      </div>
      </StickyHeader>

      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
      {/* ── 좌측: 접수 목록 ── */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
        <div style={{ padding: '0 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            접수 목록
            {items.length > 0 && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                {filtered.length === items.length ? `${items.length}건` : `${filtered.length} / ${items.length}건`}
              </span>
            )}
          </span>
          <button onClick={() => router.refresh()}
            style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}>
            새로고침
          </button>
        </div>

        {!hasHospital ? (
          <Banner>병원 정보가 없어 접수 목록을 표시할 수 없습니다. 관리자에게 문의해 주세요.</Banner>
        ) : loadError ? (
          <Banner danger>접수 목록을 불러오지 못했습니다: {loadError}</Banner>
        ) : items.length === 0 ? (
          <div style={{ padding: '48px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>아직 접수된 초진 접수증이 없습니다</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>보호자가 접수증을 작성하면 여기에 표시됩니다.</div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="보호자·연락처·환자 검색"
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', outline: 'none' }} />
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>검색·필터 결과가 없습니다.</div>
            ) : (() => {
              // 환자 단위 row 로 flatten — 한 보호자가 여러 마리를 데리고 오면 마리수만큼 줄이 늘어난다.
              // 사전문진/바로가기 컬럼도 그 환자만 가리키므로 어떤 동물의 기록인지 모호하지 않다.
              type FlatRow = { s: Submission; p: PetAnswer | null; petIndex: number };
              const flatRows: FlatRow[] = filtered.flatMap<FlatRow>((s) => {
                const pets = s.pets ?? [];
                if (pets.length === 0) return [{ s, p: null, petIndex: 0 }];
                return pets.map((p, i) => ({ s, p, petIndex: i }));
              });
              return (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle)' }}>
                      {['접수일 및 시간', '보호자', '연락처', '환자', '사전문진', '바로가기'].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {flatRows.map(({ s, p, petIndex }, i) => {
                      const isFirstOfSubmission = i === 0 || flatRows[i - 1].s.id !== s.id;
                      const isLastOfSubmission = i === flatRows.length - 1 || flatRows[i + 1].s.id !== s.id;
                      const linkedId = p?.surveyLinked === true && typeof p.surveySessionId === 'string' ? p.surveySessionId : null;
                      return (
                        <tr
                          key={`${s.id}-${petIndex}`}
                          onClick={() => setSelectedId(s.id)}
                          style={{
                            // 같은 submission 의 행들은 굵은 구분선 없이 묶고, submission 경계에만 굵은 선.
                            borderBottom: i < flatRows.length - 1
                              ? `1px solid ${isLastOfSubmission ? 'var(--border)' : 'var(--bg-subtle)'}`
                              : 'none',
                            cursor: 'pointer',
                            background: selectedId === s.id ? 'var(--accent-subtle)' : 'transparent',
                          }}
                        >
                          {/* 같은 보호자의 두 번째 이후 row 는 접수일·보호자·연락처를 비워 묶음 표시 */}
                          <td style={tdStyle}>{isFirstOfSubmission ? fmtDateTimeFull(s.created_at) : ''}</td>
                          <td style={{ ...tdStyle, color: 'var(--text)' }}>{isFirstOfSubmission ? (s.owner_name ?? '—') : ''}</td>
                          <td style={tdStyle}>{isFirstOfSubmission ? (s.owner_phone ?? '—') : ''}</td>
                          <td style={{ ...tdStyle, whiteSpace: 'normal', color: 'var(--text)' }}>{p?.name?.trim() || '—'}</td>
                          <td style={tdStyle}>
                            {linkedId ? (
                              <span style={surveyBadgeStyle}>완료</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            {linkedId ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSurveyModalIds([linkedId]);
                                }}
                                style={surveyLinkBtnStyle}
                              >
                                기록 보기
                              </button>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </>
        )}
      </div>

      {/* ── 우측: 접수 상세 ── */}
      <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border-strong)', paddingLeft: 24 }}>
        <div>
          <div style={{ padding: '0 0 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>접수 상세</div>
            {selected && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{fmtDateTime(selected.created_at)} 접수</div>}
          </div>
          {selected ? <Detail s={selected} onOpenSurvey={(ids) => setSurveyModalIds(ids)} /> : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>왼쪽에서 항목을 선택하세요.</div>
          )}
        </div>
      </div>
      </div>

      {surveyModalOpen && userId && (
        <SessionDetailModal
          open={surveyModalOpen}
          sessionIds={surveyModalIds}
          userId={userId}
          onClose={() => setSurveyModalIds([])}
        />
      )}

      {linkModalOpen && hasHospital && (
        <div onClick={() => setLinkModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>보호자 접수 링크</h2>
              <button type="button" onClick={() => setLinkModalOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              이 링크를 보호자에게 공유하면, 보호자가 직접 초진 접수증을 작성할 수 있습니다.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formUrl || '—'}</span>
              <button type="button" onClick={copyLink} disabled={!formUrl}
                style={{ flexShrink: 0, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: formUrl ? 'pointer' : 'default', borderRadius: 'var(--radius)', border: `1px solid ${linkCopied ? 'var(--success)' : 'var(--border-strong)'}`, background: 'var(--bg)', color: linkCopied ? 'var(--success)' : 'var(--text)' }}>
                {linkCopied ? '복사됨' : '복사'}
              </button>
            </div>
            <button type="button" onClick={() => setLinkModalOpen(false)}
              style={{ width: '100%', padding: '11px', border: 'none', borderRadius: 'var(--radius)', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              완료
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ s, onOpenSurvey }: { s: Submission; onOpenSurvey: (ids: string[]) => void }) {
  const petCount = s.pets?.length ?? 0;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Section title="보호자 정보">
        <Row k="보호자 성명" v={s.owner_name || '—'} />
        <Row k="연락처" v={s.owner_phone || '—'} />
        <Row k="주소" v={s.owner_address || '—'} />
      </Section>

      {(s.pets ?? []).map((p, i) => (
        <Section key={i} title={petCount > 1 ? `환자 정보 (${i + 1})` : '환자 정보'}>
          <Row k="환자 이름" v={p.name || '—'} />
          <Row k="동물" v={p.species ? labelOf(SPECIES_OPTIONS, p.species) : '—'} />
          <Row k="품종" v={petBreed(p)} />
          <Row k="생일/나이" v={petAge(p)} />
          <Row k="성별" v={p.sex ? labelOf(SEX_OPTIONS, p.sex) : '—'} />
          <Row k="동물등록" v={p.registration ? labelOf(REGISTRATION_OPTIONS, p.registration) : '—'} />
          <Row k="펫보험" v={p.insurance ? labelOf(INSURANCE_OPTIONS, p.insurance) : '—'} />
          {(() => {
            const hasSymptoms = (p.symptoms ?? []).length > 0;
            if (hasSymptoms) {
              const v = p.symptoms.map((sym) => (sym === 'other' ? (p.symptomDetail || '기타') : labelOf(SYMPTOM_OPTIONS, sym))).join(', ');
              return <Row k="증상/내원사유" v={v} />;
            }
            if (p.surveyLinked && p.surveySessionId) {
              return (
                <div style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 13, alignItems: 'flex-start' }}>
                  <span style={{ width: 126, flexShrink: 0, color: 'var(--text-muted)' }}>증상/내원사유</span>
                  <button
                    type="button"
                    onClick={() => onOpenSurvey([p.surveySessionId as string])}
                    style={{
                      padding: 0, margin: 0, border: 'none', background: 'transparent',
                      color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer',
                      fontSize: 13, fontFamily: 'inherit', lineHeight: 1.4,
                    }}
                  >
                    사전문진 내용 참고
                  </button>
                </div>
              );
            }
            return <Row k="증상/내원사유" v="—" />;
          })()}
        </Section>
      ))}

      <Section title="유입 경로 및 동의 여부">
        <Row k="알게 된 경로" v={referralText(s.referral)} />
        <Row k="진료 목적(필수)" v={s.consent_required ? '동의' : '미동의'} />
        <Row k="마케팅(선택)" v={s.consent_marketing ? '동의' : '미동의'} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', background: 'var(--bg)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = !!v && v !== '—';
  async function copy() {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* 클립보드 미지원/거부 */ }
  }
  return (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 13, alignItems: 'flex-start' }}>
      <span style={{ width: 126, flexShrink: 0, color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', wordBreak: 'break-word' }}>{v}</span>
      {canCopy && (
        <button type="button" onClick={copy} title="복사"
          style={{ flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: '1px 2px', display: 'flex', alignItems: 'center', color: copied ? 'var(--success)' : 'var(--text-muted)' }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  );
}
function Banner({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div style={{
      padding: '16px 18px', borderRadius: 'var(--radius)', fontSize: 13, lineHeight: 1.6,
      background: danger ? 'var(--danger-subtle)' : 'var(--bg-subtle)',
      border: `1px solid ${danger ? 'var(--danger)' : 'var(--border)'}`,
      color: danger ? 'var(--text)' : 'var(--text-secondary)',
    }}>{children}</div>
  );
}

const thStyle: CSSProperties = {
  padding: '9px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)',
  fontSize: 11, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const tdStyle: CSSProperties = {
  padding: '11px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};
const surveyBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.6,
  color: 'var(--success)',
  background: 'var(--success-subtle)',
  borderRadius: 999,
};
const surveyLinkBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'var(--accent)',
  background: 'var(--bg)',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
