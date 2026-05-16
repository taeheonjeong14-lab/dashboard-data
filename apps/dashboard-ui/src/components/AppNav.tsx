"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.723 6.723 0 0 0 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 0 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
      />
    </svg>
  );
}

const NAV = [
  { href: "/", label: "HOME" },
  { href: "/hospital", label: "경영 통계" },
  { href: "/blog", label: "네이버 블로그 통계" },
  { href: "/place", label: "네이버 플레이스 통계" },
  { href: "/ads", label: "네이버 광고 통계" },
] as const;

export default function AppNav() {
  const pathname = usePathname();
  const { scope } = useAuth();

  const name = scope.userName ?? "—";
  const hospital = scope.hospitals
    .find((h) => h.hospital_id === scope.assignedHospitalId)
    ?.hospital_name?.trim();
  const userLabel = hospital ? `${name}(${hospital})` : name;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/80">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-5 lg:px-6">
        <nav className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`border-b border-transparent px-2 py-1.5 text-sm transition sm:px-2.5 ${
                  active
                    ? "border-zinc-300 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-4">
          <span className="max-w-[min(100vw-12rem,20rem)] truncate text-sm text-zinc-400" title={userLabel}>
            {userLabel}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/settings"
              aria-label="설정"
              title="설정"
              className="inline-flex items-center justify-center rounded-sm p-1.5 text-zinc-400 transition hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              <SettingsIcon className="h-5 w-5" />
              <span className="sr-only">설정</span>
            </Link>
            <Link
              href="/logout"
              aria-label="로그아웃"
              title="로그아웃"
              className="inline-flex items-center justify-center rounded-sm p-1.5 text-zinc-400 transition hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              <LogoutIcon className="h-5 w-5" />
              <span className="sr-only">로그아웃</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
