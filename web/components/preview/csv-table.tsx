"use client";
import Papa from "papaparse";
import { useMemo } from "react";

const MAX_ROWS = 500;

export function CsvTable({ text, ext }: { text: string; ext: string }) {
  const rows = useMemo(() => {
    const res = Papa.parse<string[]>(text, { delimiter: ext === "tsv" ? "\t" : "", preview: MAX_ROWS + 1, skipEmptyLines: true });
    return res.data;
  }, [text, ext]);
  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">Arquivo vazio.</p>;
  const [header, ...body] = rows;
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th className="border-b border-border px-2 py-1.5 text-right font-medium text-muted-foreground">#</th>
            {header.map((h, i) => (
              <th key={i} className="whitespace-nowrap border-b border-border px-2 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, MAX_ROWS).map((r, i) => (
            <tr key={i} className="odd:bg-muted/30">
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{i + 1}</td>
              {r.map((c, j) => (
                <td key={j} className="max-w-[24rem] truncate whitespace-nowrap px-2 py-1" title={c}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > MAX_ROWS && <p className="p-3 text-center text-xs text-muted-foreground">Exibindo as primeiras {MAX_ROWS} linhas.</p>}
    </div>
  );
}
