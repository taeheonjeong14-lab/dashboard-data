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
  { key: "current", name: "최근 7일", color: "#3182F6" },
  { key: "previous", name: "직전 7일", color: "#4b5563" },
] as const;

const tooltipStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e8eb",
  borderRadius: "8px",
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
      : Array.from({ length: 7 }, () => ({ currentDate: "", previousDate: "" }));

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
        <text x={0} y={0} dy={12} textAnchor="middle" fill="#3182F6" fontSize={11}>
          {row?.dayLabelTop ?? ""}
        </text>
        <text x={0} y={0} dy={26} textAnchor="middle" fill="#D97706" fontSize={11}>
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
      <div className="rounded border border-[var(--border)] bg-white px-2.5 py-1.5 text-xs shadow-lg">
        <p className="mb-1 text-[var(--text-secondary)]">최근: {row?.currentDate || "—"}</p>
        <p className="mb-2 text-[var(--text-muted)]">직전: {row?.previousDate || "—"}</p>
        <p className="text-[var(--text)]">최근 7일: {currentText}</p>
        <p className="text-[var(--text)]">직전 7일: {previousText}</p>
      </div>
    );
  };

  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '260px',
          width: '100%',
          border: '1px solid var(--border)',
          background: 'var(--bg-raised)',
          padding: '12px',
          borderRadius: 'var(--radius)',
        }}
        role="img"
        aria-label={ariaLabel}
      >
        <div style={{ minHeight: 0, minWidth: 0, flex: 1 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
            <LineChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 8, left: 4 }}
            >
              <CartesianGrid stroke="#e5e8eb" strokeDasharray="3 3" />
              <XAxis
                dataKey="dayLabelTop"
                stroke="#d1d6db"
                tickLine={{ stroke: "#d1d6db" }}
                tick={renderTwoLineTick}
                interval={0}
                height={42}
              />
              <YAxis
                stroke="#d1d6db"
                tick={{ fill: "#8b95a1", fontSize: 11 }}
                tickLine={{ stroke: "#d1d6db" }}
                tickFormatter={(val) => formatTick(variant, Number(val))}
                domain={Y_AXIS_AUTO_DOMAIN}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: "#191f28" }}
                itemStyle={{ color: "#4e5968" }}
                content={renderTooltip}
              />
              <Legend
                wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                formatter={(value) => (
                  <span style={{ color: "#4e5968" }}>{value}</span>
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

