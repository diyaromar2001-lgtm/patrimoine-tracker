"use client"

import { Bell, Search } from "lucide-react"

interface TopbarProps {
  title: string
  subtitle?: string
}

export function Topbar({ title, subtitle }: TopbarProps) {
  const now = new Date()
  const dateStr = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  // Capitalise first letter
  const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1)

  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center justify-between border-b px-6"
      style={{
        backgroundColor: "var(--background)",
        borderColor: "var(--border)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Left: page title */}
      <div>
        <h1 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
            {subtitle ?? formattedDate}
          </p>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-zinc-800"
          aria-label="Rechercher"
        >
          <Search className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
        </button>

        {/* Notifications */}
        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-zinc-800"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
          <span
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2"
            style={{
              backgroundColor: "#3b82f6",
              borderColor: "var(--background)",
            }}
          />
        </button>

        {/* Date chip */}
        <div
          className="hidden rounded-md px-3 py-1 text-xs font-medium md:block"
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
