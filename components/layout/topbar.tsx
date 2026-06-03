"use client"

import { Bell, Wallet } from "lucide-react"
import { GlobalSearch }      from "./global-search"
import { MarketStatus }      from "./market-status"
import { CurrencySwitcher }  from "./currency-switcher"

interface TopbarProps {
  title:    string
  subtitle?: string
}

export function Topbar({ title, subtitle }: TopbarProps) {
  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b"
      style={{
        backgroundColor: "rgba(9, 9, 11, 0.85)",
        borderColor:     "var(--border)",
        backdropFilter:  "blur(16px) saturate(1.8)",
        WebkitBackdropFilter: "blur(16px) saturate(1.8)",
        padding: "0 20px",
      }}
    >
      {/* Left: mobile logo + page title */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Brand mark — mobile only */}
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg lg:hidden"
          style={{
            background:  "linear-gradient(135deg, #6366f1, #818cf8)",
            boxShadow:   "0 0 10px #6366f130",
          }}
        >
          <Wallet className="h-3.5 w-3.5 text-white" />
        </div>

        <div className="min-w-0">
          <h1
            className="text-sm font-semibold truncate"
            style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="hidden sm:block text-[11px] truncate mt-0.5"
              style={{ color: "var(--text-tertiary)" }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Right: search + currency + market + bell */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <GlobalSearch />
        <CurrencySwitcher />
        <MarketStatus />

        {/* Notification bell */}
        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--bg-muted)", e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent", e.currentTarget.style.color = "var(--text-tertiary)")}
          aria-label="Notifications"
        >
          <Bell className="h-[15px] w-[15px]" />
          <span
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2"
            style={{
              backgroundColor: "var(--accent)",
              borderColor:     "rgba(9, 9, 11, 0.85)",
            }}
          />
        </button>
      </div>
    </header>
  )
}
