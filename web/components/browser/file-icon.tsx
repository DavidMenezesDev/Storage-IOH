import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
} from "lucide-react";
import type { Category } from "@/lib/api";
import { cn } from "@/lib/utils";

const SHEET = new Set(["csv", "tsv", "xls", "xlsx", "ods"]);

export function FileIcon({ category, ext, className }: { category: Category; ext?: string; className?: string }) {
  const cls = cn("shrink-0", className);
  if (ext && SHEET.has(ext)) return <FileSpreadsheet className={cn(cls, "text-[var(--series-3)]")} />;
  switch (category) {
    case "image":
      return <FileImage className={cn(cls, "text-[var(--series-5)]")} />;
    case "video":
      return <FileVideo className={cn(cls, "text-[var(--series-2)]")} />;
    case "audio":
      return <FileAudio className={cn(cls, "text-[var(--series-7)]")} />;
    case "document":
      return <FileText className={cn(cls, "text-[var(--series-1)]")} />;
    case "code":
      return <FileCode className={cn(cls, "text-[var(--series-6)]")} />;
    case "archive":
      return <FileArchive className={cn(cls, "text-[var(--series-4)]")} />;
    default:
      return <File className={cn(cls, "text-muted-foreground")} />;
  }
}

export function FolderIcon({ className }: { className?: string }) {
  return <Folder className={cn("shrink-0 fill-primary/15 text-primary", className)} />;
}
