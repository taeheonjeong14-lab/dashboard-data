import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import {
  ClipboardCheck, Stethoscope, BarChart2, Swords, ClipboardList, FileHeart, Newspaper, CalendarDays, ChevronRight,
  type LucideIcon,
} from 'lucide-react';

type Feature = { href: string; label: string; desc: string; icon: LucideIcon; badge?: string };
type Group = { title: string; items: Feature[] };

const GROUPS: Group[] = [
  {
    title: 'AI 진료 보조',
    items: [
      { href: '/pre-consultation', label: '사전문진', desc: '보호자에게 사전문진을 보내고 AI 사전 분석을 받습니다.', icon: ClipboardCheck },
      { href: '/ai-assist', label: 'Robovet AI', desc: '진료 중 AI 감별진단·요약을 보조합니다.', icon: Stethoscope, badge: '준비중' },
    ],
  },
  {
    title: '병원 경영',
    items: [
      { href: '/dashboard', label: '경영 대시보드', desc: '매출·신규 고객·광고 성과를 한눈에 봅니다.', icon: BarChart2 },
      { href: '/competitor-analysis', label: '경쟁병원 분석', desc: '경쟁 병원과 키워드·리뷰를 비교합니다.', icon: Swords },
    ],
  },
  {
    title: '경영 운영',
    items: [
      { href: '/reception', label: '초진 접수', desc: '초진 접수증을 받고 직원이 열람합니다.', icon: ClipboardList },
      { href: '/health-report', label: '건강검진 리포트', desc: '차트로 보호자용 건강검진 리포트를 생성합니다.', icon: FileHeart },
    ],
  },
  {
    title: '마케팅',
    items: [
      { href: '/blog', label: '블로그 컨텐츠', desc: '진료케이스·검진 기반으로 블로그 글을 만듭니다.', icon: Newspaper },
      { href: '/schedule', label: '디자인 요청', desc: '디자인 작업을 요청합니다.', icon: CalendarDays, badge: '준비중' },
    ],
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let name = (user?.user_metadata?.name as string | undefined)?.trim() || user?.email || '';
  let hospitalName = '';
  if (user) {
    const { data } = await supabase.schema('core').from('users').select('name, customHospitalName, hospital_id').eq('id', user.id).single();
    const cu = data as { name?: string | null; customHospitalName?: string | null; hospital_id?: string | null } | null;
    if (cu?.name?.trim()) name = cu.name.trim();
    hospitalName = cu?.customHospitalName?.trim() || '';
    if (!hospitalName && cu?.hospital_id) {
      try {
        const srvc = createServiceRoleClient();
        const { data: h } = await srvc.schema('core').from('hospitals').select('name').eq('id', cu.hospital_id).single();
        hospitalName = (h as { name?: string | null } | null)?.name?.trim() || '';
      } catch { /* noop */ }
    }
  }

  const kstHour = (new Date().getUTCHours() + 9) % 24;
  const greet = kstHour < 6 ? '편안한 새벽이에요' : kstHour < 12 ? '좋은 아침이에요' : kstHour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* 히어로 인사 헤더 */}
      <div style={{ borderRadius: 'var(--radius-lg)', padding: '32px 28px', marginBottom: 28, background: 'linear-gradient(135deg, var(--accent-subtle) 0%, var(--bg) 70%)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>{greet}</div>
        <h1 style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          {name || '회원'}님, 반가워요 👋
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--text-secondary)' }}>
          {hospitalName ? `${hospitalName} · ` : ''}오늘도 좋은 진료 되세요. 아래에서 원하는 기능을 선택하세요.
        </p>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} style={{ marginBottom: 28 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{g.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {g.items.map((f) => {
              const Icon = f.icon;
              return (
                <Link
                  key={f.href}
                  href={f.href}
                  className="homeCard"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 18, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg)', textDecoration: 'none' }}
                >
                  <span style={{ display: 'inline-flex', width: 42, height: 42, borderRadius: 11, background: 'var(--accent-subtle)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={21} style={{ color: 'var(--accent)' }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)' }}>{f.label}</span>
                      {f.badge && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-subtle)', padding: '2px 7px', borderRadius: 999 }}>{f.badge}</span>}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{f.desc}</p>
                  </div>
                  <ChevronRight size={18} className="homeArrow" style={{ flexShrink: 0, marginTop: 2 }} />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
