"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";

type ChartPoint = {
  date: string;
  close: number;
  spyClose: number | null;
  normalizedClose: number;
  normalizedSpyClose: number | null;
  isTradeDate: boolean;
  isFilingDate: boolean;
};

type SignalPriceChartProps = {
  data: ChartPoint[];
};

function formatAxisDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatIndex(value: number | null | undefined) {
  if (value == null) return "—";
  return Number(value).toFixed(2);
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string;
    value?: number;
  }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;

  const stockPoint = payload.find(
    (item) => item.dataKey === "normalizedClose"
  );
  const spyPoint = payload.find(
    (item) => item.dataKey === "normalizedSpyClose"
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-sm font-medium text-gray-900">
        {formatAxisDate(label)}
      </p>

      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-gray-600">Stock</span>
          <span className="font-medium text-gray-900">
            {formatIndex(stockPoint?.value)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-gray-600">SPY</span>
          <span className="font-medium text-gray-900">
            {formatIndex(spyPoint?.value)}
          </span>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Indexed to 100 at the first chart date
      </p>
    </div>
  );
}

export default function SignalPriceChart({ data }: SignalPriceChartProps) {
  if (!data.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-500">
        No price history available yet.
      </div>
    );
  }

  const tradePoint = data.find((point) => point.isTradeDate);
  const filingPoint = data.find((point) => point.isFilingDate);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-slate-900" />
          Stock
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-emerald-600" />
          SPY
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-blue-600" />
          Trade date
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-amber-500" />
          Filing date
        </div>
      </div>

      <p className="mb-4 text-xs text-gray-500">
        Both lines are normalized to 100 at the first visible date to compare
        relative performance.
      </p>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="date"
              tickFormatter={formatAxisDate}
              tick={{ fontSize: 12 }}
              minTickGap={24}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(value) => Number(value).toFixed(0)}
              tick={{ fontSize: 12 }}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />

            <Line
              type="monotone"
              dataKey="normalizedClose"
              stroke="#0f172a"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />

            <Line
              type="monotone"
              dataKey="normalizedSpyClose"
              stroke="#059669"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />

            {tradePoint ? (
              <ReferenceDot
                x={tradePoint.date}
                y={tradePoint.normalizedClose}
                r={5}
                fill="#2563eb"
                stroke="white"
              />
            ) : null}

            {filingPoint ? (
              <ReferenceDot
                x={filingPoint.date}
                y={filingPoint.normalizedClose}
                r={5}
                fill="#f59e0b"
                stroke="white"
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}