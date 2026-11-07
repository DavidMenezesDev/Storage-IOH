import type { Metadata } from "next";
import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: "Uso do storage" };

export default function DashboardPage() {
  return <DashboardView />;
}
