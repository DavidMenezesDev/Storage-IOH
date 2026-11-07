const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: v >= 100 ? 0 : digits })} ${UNITS[i]}`;
}

const numberFmt = new Intl.NumberFormat("pt-BR");
export function formatNumber(n: number | null | undefined): string {
  return n == null ? "—" : numberFmt.format(n);
}

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });
const shortDateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function formatShortDate(isoDate: string): string {
  // "YYYY-MM-DD" → parse as local date to avoid TZ shift
  const [y, m, d] = isoDate.split("-").map(Number);
  return shortDateFmt.format(new Date(y, (m || 1) - 1, d || 1));
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}
