"use client"

import { Bell, Wallet } from "lucide-react"
import { GlobalSearch } from "./global-search"
import { MarketStatus } from "./market-status"

interface TopbarProps {
  title: string
  subtitle?: string
}

export function Topbar({ title, subtitle }: TopbarProps) {
  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b px-4 sm:px-6"
      style={{
        backgroundColor: "var(--background)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Left: mobile logo + title */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg lg:hidden"
          style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
        >
          <Wallet className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs truncate" style={{ color: "var(--foreground-muted)" }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Right: search + market + bell */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <GlobalSearch />
        <MarketStatus />

        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
          <span
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2"
            style={{ backgroundColor: "#3b82f6", borderColor: "var(--background)" }}
          />
        </button>
      </div>
    </header>
  )
}
