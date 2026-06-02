"use client"

import { Bell, Search, Wallet } from "lucide-react"

interface TopbarProps {
  title: string
  subtitle?: string
}

export function Topbar({ title, subtitle }: TopbarProps) {
  const now = new Date()
  const dateStr = now.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })
  const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1)

  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4 sm:px-6"
      style={{
        backgroundColor: "var(--background)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* Mobile: logo + title | Desktop: title only */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Brand logo — mobile only (desktop shows in sidebar) */}
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg lg:hidden"
          style={{ background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)" }}
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

      {/* Right: actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
          aria-label="Rechercher"
        >
          <Search className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
        </button>

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

        {/* Date chip — hidden on mobile */}
        <div
          className="hidden sm:block rounded-md px-2.5 py-1 text-xs font-medium"
          style={{
            backgroundColor: "var(--background-hover)",
            color: "var(--foreground-muted)",
            border: "1px solid var(--border)",
          }}
        >
          {formattedDate}
        </div>
      </div>
    </header>
  )
}
