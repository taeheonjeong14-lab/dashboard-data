import Link from 'next/link';
import { LayoutGrid, Search, Building2, ChevronRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * 병원 데이터 진입 화면 — 어떤 관점으로 볼지 먼저 고른다.
 * 예전엔 첫 병원 상세로 바로 튕겨서, "어느 병원을 봐야 하는지"도 "무엇이 문제인지"도 알 수 없었다.
 */
const VIEWS = [
  {
    href: '/admin/performance/heatmap',
    icon: LayoutGrid,
    title: '히트맵',
    desc: '전 병원의 최근 4주 변화를 한 표로. 악화된 병원이 위로 올라옵니다.',
    hint: '어느 병원을 봐야 하나',
  },
  {
    href: '/admin/performance/keywords',
    icon: Search,
    title: '키워드 순위',
    desc: '전 병원 키워드를 하락 순으로. 첫 페이지 이탈·문턱(11~15위)도 바로 걸러 봅니다.',
    hint: '무엇을 고쳐야 하나',
  },
  {
    href: '/admin/performance/hospitals',
    icon: Building2,
    title: '병원별 데이터',
    desc: '병원 하나의 매출·진료건수·신규환자·블로그·플레이스·광고 상세(병원 화면과 동일).',
    hint: '왜 그런가',
  },
];

export default function AdminPerformanceIndexPage() {
  return (
    <div className="adminMainSingleGutter">
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>병원 데이터</h1>
      <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--text-secondary)' }}>
        어떤 관점으로 볼지 고르세요.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, maxWidth: 1100 }}>
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <Link
              key={v.href}
              href={v.href}
              className="homeCard"
              style={{
                display: 'block', padding: '18px 20px', borderRadius: 12,
                border: '1px solid var(--border)', background: 'var(--bg)', textDecoration: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Icon size={18} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{v.title}</span>
                <ChevronRight size={15} className="homeArrow" style={{ marginLeft: 'auto' }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 5 }}>{v.hint}</div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{v.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
