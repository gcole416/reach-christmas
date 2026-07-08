import { DataProvider } from "@/lib/store";
import { AdminGate } from "./AdminGate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <AdminGate>{children}</AdminGate>
    </DataProvider>
  );
}
