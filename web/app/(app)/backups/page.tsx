import type { Metadata } from "next";
import { BackupsView } from "./backups-view";

export const metadata: Metadata = { title: "Painel de backups" };

export default function BackupsPage() {
  return <BackupsView />;
}
