"use client"

import { useState, useEffect } from "react"
import { Sidebar } from "./sidebar"
import { MobileNav } from "./mobile-nav"
import { cn } from "@/lib/utils"

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted,   setMounted]   = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const v = localStorage.getItem("sidebar-collapsed")
      if (v !== null) setCollapsed(JSON.parse(v))
    } catch {}
  }, [])

  const toggle = () => {
    setCollapsed(c => {
      const next = !c
      try { localStorage.setItem("sidebar-collapsed", JSON.stringify(next)) } catch {}
      return next
    })
  }

  return (
    <div className="min-h-dvh" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Sidebar — desktop only */}
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </div>

      {/* Main content — offset matches sidebar width */}
      <div
        className={cn(
          "transition-all duration-300 pb-16 lg:pb-0",
          // Use a stable value before JS hydrates to prevent layout shift
          !mounted
            ? "lg:ml-60"
            : collapsed
            ? "lg:ml-16"
            : "lg:ml-60"
        )}
      >
        <main>{children}</main>
      </div>

      {/* Bottom nav — mobile only */}
      <MobileNav />
    </div>
  )
}
