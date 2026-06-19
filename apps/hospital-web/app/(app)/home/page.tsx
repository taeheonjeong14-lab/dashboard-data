import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import {
  ClipboardCheck, Stethoscope, BarChart2, Swords, ClipboardList, FileHeart, Newspaper, CalendarDays,
  type LucideIcon,
} from 'lucide-react';

type Feature = { href: string; label: string; desc: string; icon: LucideIcon; masterOnly?: boolean; badge?: string };

const FEATURES: Feature[] = [
  { href: '/pre-consultation', label: '사전문진', desc: '보호자에게 사전문진을 보내고 AI 사전 분석을 받습니다.', icon: ClipboardCheck },
  { href: '/ai-assist', label: 'Robovet AI', desc: '진료 중 AI 감별진단·요약을 보조합니다.', icon: Stethoscope, badge: '준비중' },
  { href: '/dashboard', label: '경영 대시보드', desc: '매출·신규 고객·광고 성과를 한눈에 봅니다.', icon: BarChart2, masterOnly: true },
  { href: '/competitor-analysis', label: '경쟁병원 분석', desc: '경쟁 병원과 키워드·리뷰를 비교합니다.', icon: Swords },
  { href: '/reception', label: '초진 접수', desc: '초진 접수증을 받고 직원이 열람합니다.', icon: ClipboardList },
  { href: '/health-report', label: '건강검진 리포트', desc: '차트로 보호자용 건강검진 리포트를 생성합니다.', icon: FileHeart },
  { href: '/blog', label: '블로그 컨텐츠', desc: '진료케이스·검진 기반으로 블로그 글을 만듭니다.', icon: Newspaper },
  { href: '/schedule', label: '디자인 요청', desc: '디자인 작업을 요청합니다.', icon: CalendarDays, badge: '준비중' },
];

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let name = (user?.user_metadata?.name as string | undefined)?.trim() || user?.email || '';
  if (user) {
    const { data } = await supabase.schema('core').from('users').select('name').eq('id', user.id).single();
    const cu = data as { name?: string | null } | null;
    if (cu?.name?.trim()) name = cu.name.trim();
  }
  // 경영 대시보드도 모두에게 노출 — 스태프가 누르면 페이지에서 '접근 권한 없음' 처리.
  const features = FEATURES;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
        안녕하세요, {name || '회원'}님!
      </h1>
      <p style={{ margin: '8px 0 28px', fontSize: 15, color: 'var(--text-secondary)' }}>
        무엇을 도와드릴까요? 아래에서 원하는 기능을 선택하세요.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <Link
              key={f.href}
              href={f.href}
              style={{
                display: 'block', padding: 20, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
                background: 'var(--bg)', textDecoration: 'none', transition: 'border-color .15s, box-shadow .15s, transform .15s',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
              className="homeCard"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ display: 'inline-flex', width: 40, height: 40, borderRadius: 10, background: 'var(--accent-subtle)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={20} style={{ color: 'var(--accent)' }} />
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{f.label}</span>
                {f.badge && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-subtle)', padding: '2px 7px', borderRadius: 999 }}>{f.badge}</span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{f.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
