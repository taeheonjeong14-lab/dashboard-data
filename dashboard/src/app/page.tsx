"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BlogViewsChart from "@/components/BlogViewsChart";
import { getCurrentUser } from "@/lib/auth";
import {
  fetchBlogViews,
  fetchHospitalScope,
  type BlogViewPoint,
  type HospitalOption,
  type RangeDays,
} from "@/lib/queries";

function formatNumber(value: number | null) {
  if (value == null) return "-";
  return new Intl.NumberFormat("ko-KR").format(value);
}

export default function Home() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [hospitalId, setHospitalId] = useState<string | "all">("all");
  const [points, setPoints] = useState<BlogViewPoint[]>([]);
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      let user;
      try {
        user = await getCurrentUser();
      } catch {
        if (active) router.replace("/login");
        return;
      }
      if (!user) {
        if (active) router.replace("/login");
        return;
      }
      try {
        const scope = await fetchHospitalScope(user);
        if (!active) return;
        setIsAdmin(scope.isAdmin);
        setHospitals(scope.hospitals);
        if (scope.isAdmin) {
          setHospitalId("all");
        } else if (scope.hospitals.length > 0) {
          setHospitalId(scope.hospitals[0].hospital_id);
        }
        setIsReady(true);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "초기 데이터를 불러오지 못했습니다.");
        setIsReady(true);
      } finally {
        if (active) setAuthReady(true);
      }
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!isReady) return;
    let active = true;
    fetchBlogViews(rangeDays, hospitalId)
      .then((rows) => {
        if (!active) return;
        setPoints(rows);
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message || "데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isReady, rangeDays, hospitalId]);

  const latest = useMemo(() => {
    if (points.length === 0) return null;
    return points[points.length - 1].blog_views;
  }, [points]);

  const avg = useMemo(() => {
    if (points.length === 0) return null;
    const valid = points
      .map((p) => p.blog_views)
      .filter((v): v is number => typeof v === "number");
    if (valid.length === 0) return null;
    return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
  }, [points]);

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <p className="text-sm text-gray-600">세션 확인 중…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl bg-gray-50 px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">블로그 조회수 대시보드</h1>
          <p className="mt-1 text-sm text-gray-600">
            Supabase analytics 데이터를 기준으로 최근 추이를 보여줍니다.
          </p>
        </div>
        <Link
          href="/logout"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
        >
          로그아웃
        </Link>
      </header>

      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
          <span className="mb-2 block text-gray-600">병원</span>
          <select
            value={hospitalId}
            onChange={(e) => {
              setLoading(true);
              setHospitalId(e.target.value);
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            {isAdmin && <option value="all">전체 병원</option>}
            {hospitals.map((hospital) => (
              <option key={hospital.hospital_id} value={hospital.hospital_id}>
                {hospital.hospital_name}
              </option>
            ))}
          </select>
        </label>

        <label className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
          <span className="mb-2 block text-gray-600">기간</span>
          <select
            value={rangeDays}
            onChange={(e) => {
              setLoading(true);
              setRangeDays(Number(e.target.value) as RangeDays);
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value={7}>최근 7일</option>
            <option value={30}>최근 30일</option>
            <option value={90}>최근 90일</option>
          </select>
        </label>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <article className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">최신 조회수</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{formatNumber(latest)}</p>
        </article>
        <article className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">기간 평균 조회수</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{formatNumber(avg)}</p>
        </article>
      </section>

      {loading && <p className="text-sm text-gray-600">데이터를 불러오는 중...</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!loading && !error && points.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          선택한 조건에 해당하는 조회수 데이터가 없습니다.
        </p>
      )}
      {!loading && !error && points.length > 0 && <BlogViewsChart data={points} />}
    </main>
  );
}
