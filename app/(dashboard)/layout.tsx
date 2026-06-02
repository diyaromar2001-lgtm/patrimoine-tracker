import { DashboardShell } from "@/components/layout/dashboard-shell"
import { AppDataProvider } from "@/hooks/use-app-data"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppDataProvider>
      <DashboardShell>{children}</DashboardShell>
    </AppDataProvider>
  )
}
