import { Sidebar } from "@/components/layout/sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh" style={{ backgroundColor: "var(--background)" }}>
      {/* Sidebar — desktop only */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Main content — offset on desktop, full width on mobile */}
      <div className="lg:ml-60 pb-16 lg:pb-0">
        <main>{children}</main>
      </div>

      {/* Bottom nav — mobile only */}
      <MobileNav />
    </div>
  )
}
