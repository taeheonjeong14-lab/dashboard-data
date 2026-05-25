"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StatsUploadButton } from "@/components/dashboard/StatsUploadButton";

const TABS = [
  { href: "/dashboard", label: "요약" },
  { href: "/dashboard/hospital", label: "경영 통계" },
  { href: "/dashboard/blog", label: "블로그" },
  { href: "/dashboard/place", label: "플레이스" },
  { href: "/dashboard/ads", label: "광고" },
] as const;

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname.startsWith(href);
  };

  return (
    <div>
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <nav
          style={{
            display: 'inline-flex',
            gap: '2px',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '3px',
          }}
        >
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '6px 14px',
                  borderRadius: 'calc(var(--radius) - 2px)',
                  fontSize: '13px',
                  fontWeight: active ? 600 : 400,
                  color: active ? '#fff' : 'var(--text-muted)',
                  background: active ? 'var(--accent)' : 'transparent',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s, background 0.15s',
                  flexShrink: 0,
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <StatsUploadButton />
      </div>
      <div>{children}</div>
    </div>
  );
}
