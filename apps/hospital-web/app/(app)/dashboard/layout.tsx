"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, CSSProperties } from "react";
import { StatsUploadButton } from "@/components/dashboard/StatsUploadButton";
import { StickyHeader } from "@/components/ui/sticky-header";

const TABS = [
  { href: "/dashboard/sales", label: "매출" },
  { href: "/dashboard/visits", label: "진료건수" },
  { href: "/dashboard/patients", label: "신규환자" },
  { href: "/dashboard/blog", label: "블로그" },
  { href: "/dashboard/place", label: "플레이스" },
  { href: "/dashboard/powerlink-ads", label: "파워링크광고" },
  { href: "/dashboard/place-ads", label: "플레이스광고" },
  { href: "/dashboard/instagram-ads", label: "인스타광고" },
  { href: "/dashboard/google-ads", label: "구글광고" },
] as const;

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // 정확히 일치하거나 그 하위 경로일 때만 활성. startsWith 만 쓰면
  // /dashboard/place-ads 가 /dashboard/place 도 활성으로 만드는 prefix 충돌 발생.
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div>
      <StickyHeader>
        {/* 헤더: 제목 + 액션 */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>경영 대시보드</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
              매출·신규 고객·블로그·플레이스·광고 성과를 한눈에 확인합니다.
            </p>
          </div>
          <StatsUploadButton />
        </div>

        {/* 탭 (언더라인 스타일) */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", overflowX: "auto" }}>
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            const base: CSSProperties = {
              padding: "9px 12px",
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? "var(--accent)" : "var(--text-muted)",
              borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
              textDecoration: "none",
              whiteSpace: "nowrap",
              transition: "color 0.15s",
            };
            return (
              <Link
                key={tab.href}
                href={tab.href}
                style={base}
                onMouseEnter={active ? undefined : (e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={active ? undefined : (e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </StickyHeader>

      <div>{children}</div>
    </div>
  );
}
