import type { ObjectItem } from "@/lib/api";

export type Entry =
  | { kind: "folder"; id: string; name: string; prefix: string }
  | { kind: "object"; id: string; item: ObjectItem; connectionId: string; bucket: string; location?: string };

export type ViewMode = "list" | "gallery" | "columns";

export interface ViewProps {
  entries: Entry[];
  selected: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string, opts?: { range?: boolean }) => void;
  onSelectAll?: (checked: boolean) => void;
  onOpen: (entry: Entry) => void;
  renderMenu?: (entry: Entry) => React.ReactNode;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
}
