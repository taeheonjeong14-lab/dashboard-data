"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Y_AXIS_AUTO_DOMAIN } from "@/lib/chart-utils";

const SERIES = [
  { key: "current", name: "최근 7일", color: "#60a5fa" },
  { key: "previous", name: "직전 7일", color: "#c084fc" },
] as const;

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "0",
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{
    payload?: { currentDate?: string; previousDate?: string };
    dataKey?: string | number | ((obj: unknown) => unknown);
    value?: number | string | readonly (number | string)[] | null;
  }>;
};

export type SummaryDualWeekCompareChartProps = {
  /** 접근성용 설명 */
  ariaLabel: string;
  /** 금액(원) 또는 건수 — 툴팁/축 포맷 */
  variant: "currency" | "integer";
  /** 최근 7일: 가장 오래된 날 → 가장 최근 날 (길이 7) */
  currentWeek?: (number | null)[];
  /** 직전 7일: 가장 오래된 날 → 가장 최근 날 (길이 7) */
  previousWeek?: (number | null)[];
  /** 같은 슬롯의 최근/직전 실제 날짜 쌍 (길이 7) */
  datePairs?: { currentDate: string; previousDate: string }[];
};

function padSeven(values?: (number | null)[]): (number | null)[] {
  const v = values ?? [];
  return Array.from({ length: 7 }, (_, i) => (typeof v[i] === "number" ? v[i] : null));
}

function toMdLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const yy = String(y).slice(2);
  return `${yy}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
}

function formatTick(variant: "currency" | "integer", v: number) {
  if (variant === "currency") {
    return new Intl.NumberFormat("ko-KR", {
      notation: v >= 1_000_000 ? "compact" : "standard",
      maximumFractionDigits: v >= 1_000_000 ? 1 : 0,
    }).format(v);
  }
  return new Intl.NumberFormat("ko-KR").format(v);
}

export default function SummaryDualWeekCompareChart({
  ariaLabel,
  variant,
  currentWeek,
  previousWeek,
  datePairs,
}: SummaryDualWeekCompareChartProps) {
  const c = padSeven(currentWeek);
  const p = padSeven(previousWeek);
  const pairs =
    datePairs && datePairs.length === 7
      ? datePairs
      : Array.from({ length: 7 }, (_, i) => ({
          currentDate: "",
          previousDate: "",
        }));

  const data = Array.from({ length: 7 }, (_, i) => ({
    ord: i + 1,
    dayLabelTop: pairs[i]?.currentDate ? toMdLabel(pairs[i].currentDate) : "—",
    dayLabelBottom: pairs[i]?.previousDate ? toMdLabel(pairs[i].previousDate) : "—",
    currentDate: pairs[i]?.currentDate ?? "",
    previousDate: pairs[i]?.previousDate ?? "",
    current: c[i],
    previous: p[i],
  }));

  const renderTwoLineTick = (props: {
    x?: number | string;
    y?: number | string;
    payload?: { value?: string; index?: number };
  }) => {
    const { x = 0, y = 0, payload } = props;
    const idx = payload?.index ?? 0;
    const row = data[idx];
    return (
      <g transform={`translate(${Number(x)},${Number(y)})`}>
        <text x={0} y={0} dy={12} textAnchor="middle" fill="#2563eb" fontSize={11}>
          {row?.dayLabelTop ?? ""}
        </text>
        <text x={0} y={0} dy={26} textAnchor="middle" fill="#7c3aed" fontSize={11}>
          {row?.dayLabelBottom ?? ""}
        </text>
      </g>
    );
  };

  const renderTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload as
      | { currentDate?: string; previousDate?: string }
      | undefined;
    const currentItem = payload.find((pItem) => String(pItem.dataKey) === "current");
    const previousItem = payload.find((pItem) => String(pItem.dataKey) === "previous");
    const currentRaw = currentItem?.value;
    const previousRaw = previousItem?.value;
    const currentNum = typeof currentRaw === "number" ? currentRaw : Number(currentRaw);
    const previousNum = typeof previousRaw === "number" ? previousRaw : Number(previousRaw);
    const currentText =
      Number.isFinite(currentNum) && variant === "currency"
        ? `${new Intl.NumberFormat("ko-KR").format(currentNum)}원`
        : Number.isFinite(currentNum)
          ? `${new Intl.NumberFormat("ko-KR").format(currentNum)}명`
          : "—";
    const previousText =
      Number.isFinite(previousNum) && variant === "currency"
        ? `${new Intl.NumberFormat("ko-KR").format(previousNum)}원`
        : Number.isFinite(previousNum)
          ? `${new Intl.NumberFormat("ko-KR").format(previousNum)}명`
          : "—";
    return (
      <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg">
        <p className="mb-1 text-slate-500">최근: {row?.currentDate || "—"}</p>
        <p className="mb-2 text-slate-600">직전: {row?.previousDate || "—"}</p>
        <p className="text-slate-900">최근 7일: {currentText}</p>
        <p className="text-slate-700">직전 7일: {previousText}</p>
      </div>
    );
  };

  return (
    <div className="w-full min-w-0">
      <div
        className="flex h-[240px] w-full flex-col border border-slate-200 bg-slate-50 p-3 sm:h-[280px]"
        role="img"
        aria-label={ariaLabel}
      >
        <div className="min-h-0 min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 8, left: 4 }}
          >
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
            <XAxis
              dataKey="dayLabelTop"
              stroke="#94a3b8"
              tickLine={{ stroke: "#cbd5e1" }}
              tick={renderTwoLineTick}
              interval={0}
              height={42}
            />
            <YAxis
              stroke="#94a3b8"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={{ stroke: "#cbd5e1" }}
              tickFormatter={(val) => formatTick(variant, Number(val))}
              domain={Y_AXIS_AUTO_DOMAIN}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: "#0f172a" }}
              itemStyle={{ color: "#475569" }}
              content={renderTooltip}
            />
            <Legend
              wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
              formatter={(value) => (
                <span style={{ color: "#475569" }}>{value}</span>
              )}
            />
            {SERIES.map(({ key, name, color }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={name}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
