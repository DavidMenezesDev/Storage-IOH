"use client";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { Category, StatsOverview } from "@/lib/api";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/lib/files";
import { formatBytes, formatNumber, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Cor fixa por categoria (segue a entidade, nunca o ranking). */
export const CATEGORY_COLOR: Record<Category, string> = {
  image: "var(--series-1)",
  video: "var(--series-2)",
  audio: "var(--series-3)",
  document: "var(--series-4)",
  code: "var(--series-5)",
  archive: "var(--series-6)",
  other: "var(--series-other)",
};

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };

function TooltipBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">{children}</div>;
}

// ------------------------------------------------------------------ crescimento

export function GrowthChart({ points }: { points: { date: string; bytes: number; count: number }[] }) {
  const [showTable, setShowTable] = useState(false);
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Sem histórico ainda — ele é gerado a cada sincronização.</p>;
  }
  const last = points[points.length - 1];
  return (
    <div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 56, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
              minTickGap={32}
            />
            <YAxis tickFormatter={(v: number) => formatBytes(v, 1)} tickCount={5} tick={AXIS_TICK} tickLine={false} axisLine={false} width={64} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
              content={(p: TooltipContentProps<ValueType, NameType>) =>
                p.active && p.payload?.length ? (
                  <TooltipBox>
                    <p className="text-sm font-semibold">{formatBytes(p.payload[0].payload.bytes)}</p>
                    <p className="text-muted-foreground">{formatNumber(p.payload[0].payload.count)} objetos</p>
                    <p className="mt-1 text-muted-foreground">{formatShortDate(String(p.label))}</p>
                  </TooltipBox>
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="bytes"
              stroke="var(--series-1)"
              strokeWidth={2}
              fill="var(--series-1)"
              fillOpacity={0.1}
              activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: "var(--series-1)" }}
              dot={false}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="bytes"
                content={(props) => {
                  const { x, y, index } = props as { x: number; y: number; index: number };
                  if (index !== points.length - 1) return null;
                  return (
                    <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={11} fill="var(--foreground)" fontWeight={600}>
                      {formatBytes(last.bytes)}
                    </text>
                  );
                }}
              />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setShowTable((s) => !s)}>
        {showTable ? "Ocultar tabela" : "Ver como tabela"}
      </button>
      {showTable && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Data</th>
                <th className="px-3 py-1.5 text-right font-medium">Volume</th>
                <th className="px-3 py-1.5 text-right font-medium">Objetos</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.date} className="border-t border-border/60">
                  <td className="px-3 py-1">{formatShortDate(p.date)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatBytes(p.bytes)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatNumber(p.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ por bucket

export function BucketBars({ data }: { data: StatsOverview["byBucket"] }) {
  const rows = [...data]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)
    .map((r) => ({ ...r, label: r.bucket, full: `${r.connectionName} / ${r.bucket}` }));
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Nenhum bucket indexado.</p>;
  const height = rows.length * 36 + 16;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ ...AXIS_TICK, fill: "var(--foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-grid)" }}
            width={120}
            tickFormatter={(v: string) => (v.length > 16 ? v.slice(0, 15) + "…" : v)}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={(p: TooltipContentProps<ValueType, NameType>) => {
              const r = p.payload?.[0]?.payload as (typeof rows)[number] | undefined;
              return p.active && r ? (
                <TooltipBox>
                  <p className="text-sm font-semibold">{formatBytes(r.bytes)}</p>
                  <p className="text-muted-foreground">{formatNumber(r.count)} objetos</p>
                  <p className="mt-1 text-muted-foreground">{r.full}</p>
                </TooltipBox>
              ) : null;
            }}
          />
          <Bar dataKey="bytes" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
            <LabelList
              dataKey="bytes"
              position="right"
              formatter={(v) => formatBytes(Number(v))}
              style={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------ por categoria

/** Barra segmentada (parte-de-todo) + legenda/tabela com valores. */
export function CategoryBreakdown({ data }: { data: StatsOverview["byCategory"] }) {
  const [hover, setHover] = useState<Category | null>(null);
  const byCat = new Map(data.map((d) => [d.category, d]));
  const rows = CATEGORY_ORDER.map((c) => byCat.get(c) ?? { category: c, bytes: 0, count: 0 });
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  if (total === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Sem dados ainda.</p>;
  const visible = rows.filter((r) => r.bytes > 0);

  return (
    <div className="space-y-4">
      <div className="flex h-10 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label="Distribuição do volume por categoria">
        {visible.map((r) => (
          <div
            key={r.category}
            tabIndex={0}
            title={`${CATEGORY_LABEL[r.category]}: ${formatBytes(r.bytes)} (${((r.bytes / total) * 100).toFixed(1)}%)`}
            onPointerEnter={() => setHover(r.category)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(r.category)}
            onBlur={() => setHover(null)}
            className={cn("h-full min-w-[3px] outline-none transition-opacity", hover && hover !== r.category && "opacity-40")}
            style={{ flexGrow: r.bytes, flexBasis: 0, background: CATEGORY_COLOR[r.category] }}
          />
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>Categoria</th>
            <th>Volume</th>
            <th>Percentual</th>
            <th>Objetos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.category}
              onPointerEnter={() => setHover(r.category)}
              onPointerLeave={() => setHover(null)}
              className={cn("border-b border-border/60 last:border-0", hover === r.category && "bg-muted/60", r.bytes === 0 && "text-muted-foreground")}
            >
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: CATEGORY_COLOR[r.category] }} aria-hidden />
                  {CATEGORY_LABEL[r.category]}
                </span>
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums">{formatBytes(r.bytes)}</td>
              <td className="w-14 py-1.5 text-right tabular-nums text-muted-foreground">{((r.bytes / total) * 100).toFixed(1)}%</td>
              <td className="w-24 py-1.5 text-right tabular-nums text-muted-foreground">{formatNumber(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
