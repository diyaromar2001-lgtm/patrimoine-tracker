// Sidebar has "use client" at the top — Next.js enforces the RSC → Client
// boundary automatically. No dynamic() wrapper needed here.
import { Sidebar } from "@/components/layout/sidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-dvh" style={{ backgroundColor: "var(--background)" }}>
      <Sidebar />
      <div className="flex flex-1 flex-col" style={{ marginLeft: "240px" }}>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
