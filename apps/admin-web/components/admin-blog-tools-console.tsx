'use client';

/**
 * 블로그 도구 콘솔 — '네이버 검색량'과 '글 검수'를 한 메뉴로 합친 것.
 * 두 도구는 글 하나를 쓰는 흐름에서 앞뒤로 쓰인다(키워드 검색량 확인 → 글 작성 → 검수).
 * 공유하는 데이터는 없어 각 도구는 기존 컴포넌트를 그대로 탭에 얹는다.
 */
import { useCallback, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminNaverKeyword from '@/components/admin-naver-keyword';
import AdminBlogReview from '@/components/admin-blog-review';
import { PageHeader } from '@/components/ui/admin-ui';

const TABS = [
  { key: 'keyword', label: '검색량 조회' },
  { key: 'review', label: '글 검수' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid var(--border)',
  overflowX: 'auto',
  marginBottom: 16,
};
function tabButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '9px 12px',
    fontSize: 14,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    marginBottom: -1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

export default function AdminBlogToolsConsole() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabKey>(searchParams.get('tab') === 'review' ? 'review' : 'keyword');

  // 탭을 URL 에 남겨 새로고침·뒤로가기에도 유지된다.
  const selectTab = useCallback((next: TabKey) => {
    setTab(next);
    router.replace(next === 'review' ? '/admin/blog-tools?tab=review' : '/admin/blog-tools', { scroll: false });
  }, [router]);

  return (
    <div>
      <PageHeader
        title="블로그 도구"
        description={
          tab === 'keyword'
            ? '키워드의 월간 PC·모바일 검색수를 네이버 검색광고 키워드도구로 조회합니다. 연관 키워드도 함께 나옵니다.'
            : '네이버 블로그 링크를 넣으면 본문을 가져와 3개 모델로 검수합니다.'
        }
      />

      <div style={tabBarStyle} className="adminUnderlineTabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="adminUnderlineTab"
            aria-selected={tab === t.key}
            onClick={() => selectTab(t.key)}
            style={tabButtonStyle(tab === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'keyword' ? <AdminNaverKeyword embedded /> : <AdminBlogReview embedded />}
    </div>
  );
}
