import type { Category, ObjectItem } from "./api";

export type PreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "json"
  | "csv"
  | "code"
  | "none";

const IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "ico", "svg"]);
const VIDEO = new Set(["mp4", "webm", "ogv", "mov", "m4v"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"]);
const MARKDOWN = new Set(["md", "markdown", "mdx"]);
const CSV = new Set(["csv", "tsv"]);

export const CODE_LANGS: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  go: "go", py: "python", rb: "ruby", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php", sh: "bash", bash: "bash",
  zsh: "bash", ps1: "powershell", sql: "sql", html: "html", htm: "html", css: "css", scss: "scss",
  xml: "xml", yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", conf: "ini", env: "dotenv",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl", graphql: "graphql", proto: "proto",
  vue: "vue", svelte: "svelte", lua: "lua", r: "r", dart: "dart", scala: "scala", ex: "elixir",
  exs: "elixir", json: "json", jsonc: "jsonc", log: "log", txt: "text", text: "text",
};

const TEXT_ONLY = new Set(["txt", "text", "log", "nfo", "readme", "license", "gitignore", "lock"]);

export function previewKind(item: Pick<ObjectItem, "ext" | "category" | "contentType">): PreviewKind {
  const ext = item.ext.toLowerCase();
  const ct = item.contentType ?? "";
  if (ext === "pdf" || ct === "application/pdf") return "pdf";
  if (IMAGE.has(ext) || (item.category === "image" && ct.startsWith("image/"))) return "image";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (MARKDOWN.has(ext)) return "markdown";
  if (ext === "json" || ext === "geojson" || ct === "application/json") return "json";
  if (CSV.has(ext)) return "csv";
  if (ext in CODE_LANGS || TEXT_ONLY.has(ext) || item.category === "code" || ct.startsWith("text/")) return "code";
  if (item.category === "video") return "video";
  if (item.category === "audio") return "audio";
  return "none";
}

/** Limite para previews textuais carregados inteiros na memória. */
export const TEXT_PREVIEW_LIMIT = 1024 * 1024;

export const CATEGORY_LABEL: Record<Category, string> = {
  image: "Imagens",
  video: "Vídeos",
  audio: "Áudio",
  document: "Documentos",
  code: "Código / texto",
  archive: "Compactados",
  other: "Outros",
};

export const CATEGORY_ORDER: Category[] = ["image", "video", "audio", "document", "code", "archive", "other"];

/** Monta a URL de navegação para um prefixo dentro do bucket. */
export function browseHref(connectionId: string, bucket: string, prefix = "", extra?: Record<string, string>) {
  const segs = prefix.split("/").filter(Boolean).map(encodeURIComponent);
  const base = `/browse/${encodeURIComponent(connectionId)}/${encodeURIComponent(bucket)}${segs.length ? "/" + segs.join("/") : ""}`;
  const sp = new URLSearchParams(extra);
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

export function parentPrefix(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const i = trimmed.lastIndexOf("/");
  return i === -1 ? "" : trimmed.slice(0, i + 1);
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
