import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { getCachedUser } from '@/lib/supabase/get-user';
import { UnreadNotifications } from './unread-notifications';
import {
  ClipboardCheck, Stethoscope, BarChart2, Swords, ClipboardList, FileHeart, Newspaper, CalendarDays, ChevronRight,
  type LucideIcon,
} from 'lucide-react';

type Feature = { href: string; label: string; desc: string; icon: LucideIcon; badge?: string };
type Group = { title: string; items: Feature[] };

// 카드 설명 — 길이와 무관하게 항상 2줄 높이를 차지(짧으면 빈 줄 확보, 길면 2줄로 자름) → 카드 높이 고정.
const cardDesc: React.CSSProperties = {
  margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5,
  minHeight: 'calc(12.5px * 1.5 * 2)',
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
};

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
    title: '병원 운영',
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
  const user = await getCachedUser();
  const supabase = await createClient();

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

  const now = new Date();
  const kstHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now)) % 24;
  const greet = kstHour < 6 ? '편안한 새벽이에요' : kstHour < 12 ? '좋은 아침이에요' : kstHour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
  const dateStr = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(now);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* 히어로 인사 헤더 */}
      <div className="homeRise" style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-lg)', padding: '34px 30px', marginBottom: 26, background: 'linear-gradient(135deg, var(--accent-subtle) 0%, var(--bg) 62%)', border: '1px solid var(--border)' }}>
        {/* 우상단 부드러운 장식 글로우 */}
        <div aria-hidden style={{ position: 'absolute', top: -70, right: -50, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, var(--accent-subtle) 0%, transparent 70%)', opacity: 0.7, pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-flex', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
            {dateStr}
          </div>
          <div style={{ marginTop: 14, fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}>{greet}</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
            {name || '회원'}님, 반가워요 👋
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--text-secondary)' }}>
            {hospitalName ? `${hospitalName} · ` : ''}오늘도 좋은 진료 되세요. 아래에서 원하는 기능을 선택하세요.
          </p>
        </div>
      </div>

      {/* 본문: 메뉴(좌) + 알림 세로 컬럼(우). 모바일은 메뉴 먼저, 알림은 아래로. */}
      <div className="homeBody">
        <main className="homeMain">
      {GROUPS.map((g, gi) => (
        <section key={g.title} className="homeRise" style={{ marginBottom: 26, animationDelay: `${0.05 + gi * 0.06}s` }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 13px', fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.01em' }}>
            <span style={{ display: 'inline-flex', width: 4, height: 14, borderRadius: 2, background: 'var(--accent)' }} />
            {g.title}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {g.items.map((f) => {
              const Icon = f.icon;
              return (
                <Link
                  key={f.href}
                  href={f.href}
                  className="homeCard"
                  style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 92, padding: '16px 18px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg)', textDecoration: 'none' }}
                >
                  <span style={{ display: 'inline-flex', width: 44, height: 44, borderRadius: 12, background: 'var(--accent-subtle)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={21} style={{ color: 'var(--accent)' }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)' }}>{f.label}</span>
                      {f.badge && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-subtle)', padding: '2px 7px', borderRadius: 999 }}>{f.badge}</span>}
                    </div>
                    <p style={cardDesc}>{f.desc}</p>
                  </div>
                  <ChevronRight size={18} className="homeArrow" style={{ flexShrink: 0 }} />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
        </main>
        {/* 읽지 않은 알림 — 우측 세로 컬럼(데스크톱) / 메뉴 아래(모바일).
            제목은 메뉴 그룹 제목(h2)과 동일 스타일 → 박스가 메뉴 카드와 같은 높이에서 시작. */}
        <aside className="homeAside">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 13px', fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.01em' }}>
            <span style={{ display: 'inline-flex', width: 4, height: 14, borderRadius: 2, background: 'var(--accent)' }} />
            알림
          </h2>
          <UnreadNotifications />
        </aside>
      </div>
    </div>
  );
}
