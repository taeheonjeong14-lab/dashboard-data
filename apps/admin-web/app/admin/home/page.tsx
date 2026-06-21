import Link from 'next/link';
import { requireAdminSession } from '@/lib/require-admin';
import { createClient } from '@/lib/supabase/server';
import { getAdminPendingCounts } from '@/lib/admin-pending-counts';
import {
  BarChart2, FileSpreadsheet, RefreshCw, FileText, HeartPulse, Newspaper,
  ClipboardList, ClipboardCheck, Users, Building2, Gauge, ChevronRight,
  ListTodo, CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

type Feature = { href: string; label: string; desc: string; icon: LucideIcon };
type Group = { title: string; items: Feature[] };

// 카드 설명 — 길이와 무관하게 항상 2줄 높이를 차지(짧으면 빈 줄 확보, 길면 2줄로 자름) → 카드 높이 고정.
const cardDesc: React.CSSProperties = {
  margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5,
  minHeight: 'calc(12.5px * 1.5 * 2)',
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
};

const GROUPS: Group[] = [
  {
    title: '경영분석',
    items: [
      { href: '/admin/performance', label: '대시보드', desc: '병원별 매출·신규·광고 지표를 분석합니다.', icon: BarChart2 },
      { href: '/admin/data-upload?section=stats', label: '경영통계 수집', desc: '병원 경영통계 제출분을 수집·정리합니다.', icon: FileSpreadsheet },
      { href: '/admin/data-upload?section=collect', label: '데이터 수집', desc: '외부 데이터를 수집·동기화합니다.', icon: RefreshCw },
    ],
  },
  {
    title: '차트 데이터',
    items: [
      { href: '/admin/chart-data', label: '차트 목록', desc: '업로드된 차트 데이터를 조회합니다.', icon: FileText },
      { href: '/admin/health-report', label: '건강검진 리포트', desc: '검진 리포트를 생성·검토합니다.', icon: HeartPulse },
      { href: '/admin/case-blog', label: '진료케이스', desc: '진료케이스 블로그 콘텐츠를 만듭니다.', icon: Newspaper },
    ],
  },
  {
    title: '문진·접수',
    items: [
      { href: '/admin/pre-consultation', label: '사전문진', desc: '사전문진 세션과 분석을 관리합니다.', icon: ClipboardList },
      { href: '/admin/intake', label: '초진 접수', desc: '초진 접수증 제출 내역을 확인합니다.', icon: ClipboardCheck },
    ],
  },
  {
    title: '관리',
    items: [
      { href: '/admin/registrations', label: '병원 심사', desc: '신규 병원·마스터 가입을 심사합니다.', icon: ClipboardCheck },
      { href: '/admin/users/users', label: '사용자 관리', desc: '사용자 계정과 권한을 관리합니다.', icon: Users },
      { href: '/admin/users/hospitals', label: '병원 관리', desc: '병원 정보와 연결을 관리합니다.', icon: Building2 },
      { href: '/admin/usage', label: '토큰 관리', desc: '병원별 토큰 사용·지급 내역과 충전 주문을 봅니다.', icon: Gauge },
    ],
  },
];

export default async function AdminHomePage() {
  const user = await requireAdminSession();

  let name = (typeof user.user_metadata?.name === 'string' ? user.user_metadata.name.trim() : '') || user.email || '';
  try {
    const sb = await createClient();
    const { data } = await sb.schema('core').from('users').select('name').eq('id', user.id).single();
    const n = (data as { name?: string | null } | null)?.name;
    if (typeof n === 'string' && n.trim()) name = n.trim();
  } catch { /* 이름 조회 실패해도 홈은 그린다 */ }

  const now = new Date();
  const kstHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now)) % 24;
  const greet = kstHour < 6 ? '편안한 새벽이에요' : kstHour < 12 ? '좋은 아침이에요' : kstHour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
  const dateStr = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(now);

  // 대기(할 일) 카운트 — 실패해도 홈은 그린다.
  let pending = { reportRequested: 0, caseRequested: 0, caseInProgress: 0, registrations: 0 };
  try { pending = await getAdminPendingCounts(); } catch { /* noop */ }
  // 처리할 작업 목록 — 상태별로 분리, 클릭 시 이동 위치도 상태별로 다름.
  //  · 요청(추출만 됨)은 차트 목록에서 작업 시작 / 작업 중은 진료케이스 메뉴에서 이어서.
  const todos = [
    { label: '건강검진 리포트', sub: '요청', n: pending.reportRequested, href: '/admin/chart-data?type=검진리포트&stage=요청' },
    { label: '진료케이스', sub: '요청', n: pending.caseRequested, href: '/admin/chart-data?type=블로그&stage=요청' },
    { label: '진료케이스', sub: '작업 중', n: pending.caseInProgress, href: '/admin/case-blog?stage=writing' },
    { label: '병원 심사', sub: '대기', n: pending.registrations, href: '/admin/registrations' },
  ].filter((t) => t.n > 0);
  const todoTotal = todos.reduce((s, t) => s + t.n, 0);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      {/* 히어로 인사 헤더 */}
      <div className="homeRise" style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-lg)', padding: '34px 30px', marginBottom: 26, background: 'linear-gradient(135deg, var(--accent-subtle) 0%, var(--bg) 62%)', border: '1px solid var(--border)' }}>
        <div aria-hidden style={{ position: 'absolute', top: -70, right: -50, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, var(--accent-subtle) 0%, transparent 70%)', opacity: 0.7, pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-flex', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
            {dateStr}
          </div>
          <div style={{ marginTop: 14, fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}>{greet}</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
            {name || '관리자'}님, 반가워요 👋
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--text-secondary)' }}>
            관리자 콘솔이에요. 아래에서 원하는 작업을 선택하세요.
          </p>
        </div>
      </div>

      {/* 할 일(대기) 요약 박스 — 항상 표시, 처리할 게 없으면 비움 상태 */}
      <section className="homeRise" style={{ marginBottom: 26, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden', animationDelay: '0.04s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: todoTotal > 0 ? '1px solid var(--border)' : 'none' }}>
          <ListTodo size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>처리할 작업</span>
          {todoTotal > 0 && (
            <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--danger)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
              {todoTotal > 99 ? '99+' : todoTotal}
            </span>
          )}
        </div>
        {todoTotal === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '16px 18px' }}>
            <CheckCircle2 size={17} style={{ color: 'var(--success)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>지금 처리할 대기 작업이 없어요. 깔끔합니다 👍</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 18px' }}>
            {todos.map((t) => (
              <Link key={`${t.label}-${t.sub}`} href={t.href} className="homeCard"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-raised)', textDecoration: 'none' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t.label} {t.sub}</span>
                <span style={{ minWidth: 18, height: 18, padding: '0 6px', borderRadius: 999, background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{t.n}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

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
                    <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)' }}>{f.label}</span>
                    <p style={cardDesc}>{f.desc}</p>
                  </div>
                  <ChevronRight size={18} className="homeArrow" style={{ flexShrink: 0 }} />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
