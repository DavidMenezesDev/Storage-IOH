"use client";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { formatBytes, formatNumber, formatShortDate } from "@/lib/format";

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };

function TooltipBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">{children}</div>;
}

function TableToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={onToggle} aria-expanded={open}>
      {open ? "Ocultar tabela" : "Ver como tabela"}
    </button>
  );
}

function Swatch({ color, line }: { color: string; line?: boolean }) {
  return line ? (
    <span aria-hidden className="inline-block h-0.5 w-3.5 rounded" style={{ background: color }} />
  ) : (
    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
  );
}

// ------------------------------------------------------------------ painel: atividade diária

type Daily = { date: string; backups: number; bytes: number; clientsWithBackup: number };

const DAILY_SERIES = [
  { key: "backups", label: "Backups recebidos", color: "var(--series-1)" },
  { key: "clientsWithBackup", label: "Clientes com backup", color: "var(--series-2)" },
] as const;

export function DailyActivityChart({ points }: { points: Daily[] }) {
  const [showTable, setShowTable] = useState(false);
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Sem backups registrados nos últimos 30 dias.</p>;
  }
  const last = points[points.length - 1];
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legenda">
        {DAILY_SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <Swatch color={s.color} line />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 40, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
              minTickGap={32}
            />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
              content={(p: TooltipContentProps<ValueType, NameType>) => {
                const d = p.payload?.[0]?.payload as Daily | undefined;
                return p.active && d ? (
                  <TooltipBox>
                    <p className="mb-1 font-medium">{formatShortDate(d.date)}</p>
                    {DAILY_SERIES.map((s) => (
                      <p key={s.key} className="flex items-center gap-2">
                        <Swatch color={s.color} line />
                        <span className="text-muted-foreground">{s.label}</span>
                        <span className="ml-auto pl-3 font-semibold tabular-nums">{formatNumber(d[s.key])}</span>
                      </p>
                    ))}
                    <p className="mt-1 text-muted-foreground">Volume recebido: {formatBytes(d.bytes)}</p>
                  </TooltipBox>
                ) : null;
              }}
            />
            {DAILY_SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: s.color }}
                isAnimationActive={false}
                label={(props: { x?: number | string; y?: number | string; index?: number }) =>
                  props.index === points.length - 1 ? (
                    <text key={s.key} x={Number(props.x) + 6} y={Number(props.y)} dy={4} fontSize={11} fontWeight={600} fill="var(--foreground)">
                      {formatNumber(last[s.key])}
                    </text>
                  ) : (
                    <g key={`${s.key}-${props.index}`} />
                  )
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <TableToggle open={showTable} onToggle={() => setShowTable((v) => !v)} />
      {showTable && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Data</th>
                <th className="px-3 py-1.5 text-right font-medium">Backups</th>
                <th className="px-3 py-1.5 text-right font-medium">Clientes</th>
                <th className="px-3 py-1.5 text-right font-medium">Volume</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.date} className="border-t border-border/60">
                  <td className="px-3 py-1">{formatShortDate(p.date)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatNumber(p.backups)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatNumber(p.clientsWithBackup)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatBytes(p.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ cliente: tamanho do backup por dia

type SizePoint = { date: string; backups: number; bytes: number; lastSize: number };

export function BackupSizeChart({ points, minSize }: { points: SizePoint[]; minSize: number }) {
  const [showTable, setShowTable] = useState(false);
  const data = points.filter((p) => p.backups > 0 || p.lastSize > 0);
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nenhum backup no período.</p>;
  }
  const max = Math.max(...data.map((p) => p.lastSize), minSize);
  // Recorta dias vazios antes do primeiro backup, mantendo pelo menos 14 dias de janela.
  const first = points.findIndex((p) => p.backups > 0 || p.lastSize > 0);
  const shown = points.slice(Math.max(0, Math.min(first - 1, points.length - 14)));
  return (
    <div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={shown} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
              minTickGap={28}
            />
            <YAxis
              domain={[0, max * 1.1]}
              tickFormatter={(v: number) => formatBytes(v, 0)}
              tickCount={4}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={(p: TooltipContentProps<ValueType, NameType>) => {
                const d = p.payload?.[0]?.payload as SizePoint | undefined;
                return p.active && d ? (
                  <TooltipBox>
                    <p className="mb-1 font-medium">{formatShortDate(d.date)}</p>
                    {d.backups > 0 ? (
                      <>
                        <p>
                          Último backup do dia: <span className="font-semibold tabular-nums">{formatBytes(d.lastSize)}</span>
                        </p>
                        <p className="text-muted-foreground">
                          {formatNumber(d.backups)} arquivo(s) · {formatBytes(d.bytes)}
                        </p>
                        {minSize > 0 && d.lastSize < minSize && <p className="mt-1 font-medium text-orange">Abaixo do mínimo ({formatBytes(minSize)})</p>}
                      </>
                    ) : (
                      <p className="text-muted-foreground">Sem backup neste dia</p>
                    )}
                  </TooltipBox>
                ) : null;
              }}
            />
            {minSize > 0 && (
              <ReferenceLine
                y={minSize}
                stroke="var(--chart-axis)"
                strokeDasharray="4 3"
                ifOverflow="extendDomain"
                label={(props: { viewBox?: { x?: number; y?: number } }) => (
                  <text x={(props.viewBox?.x ?? 0) + 6} y={(props.viewBox?.y ?? 0) - 5} fontSize={11} fill="var(--muted-foreground)">
                    mínimo {formatBytes(minSize)}
                  </text>
                )}
              />
            )}
            <Bar dataKey="lastSize" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <TableToggle open={showTable} onToggle={() => setShowTable((v) => !v)} />
      {showTable && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Data</th>
                <th className="px-3 py-1.5 text-right font-medium">Último backup</th>
                <th className="px-3 py-1.5 text-right font-medium">Arquivos</th>
                <th className="px-3 py-1.5 text-right font-medium">Volume do dia</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((p) => (
                <tr key={p.date} className="border-t border-border/60">
                  <td className="px-3 py-1">{formatShortDate(p.date)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatBytes(p.lastSize)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatNumber(p.backups)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatBytes(p.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
