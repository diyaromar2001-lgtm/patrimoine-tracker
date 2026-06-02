"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import {
  LayoutDashboard,
  Briefcase,
  TrendingUp,
  Eye,
  Calculator,
  ArrowLeftRight,
  Settings,
  ChevronRight,
  Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Portfolios",
    href: "/portfolios",
    icon: Briefcase,
  },
  {
    label: "Dividendes",
    href: "/dividends",
    icon: TrendingUp,
  },
  {
    label: "Watchlist",
    href: "/watchlist",
    icon: Eye,
  },
  {
    label: "DCA Calculator",
    href: "/dca-calculator",
    icon: Calculator,
  },
  {
    label: "Transactions",
    href: "/transactions",
    icon: ArrowLeftRight,
  },
]

const bottomItems = [
  {
    label: "Paramètres",
    href: "/settings",
    icon: Settings,
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r"
      style={{
        backgroundColor: "var(--background-card)",
        borderColor: "var(--border)",
      }}
    >
      {/* ─── Logo ─── */}
      <div className="flex h-14 items-center gap-2.5 border-b px-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)" }}
        >
          <Wallet className="h-4 w-4 text-white" />
        </div>
        <span className="text-sm font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
          Patrimoine
        </span>
      </div>

      {/* ─── Navigation ─── */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 pt-3">
        {/* Section label */}
        <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-widest"
          style={{ color: "var(--foreground-dim)" }}
        >
          Menu
        </p>

        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                isActive
                  ? "text-white"
                  : "hover:text-white"
              )}
              style={
                !isActive
                  ? { color: "var(--foreground-muted)" }
                  : {}
              }
            >
              {/* Active bg */}
              {isActive && (
                <motion.div
                  layoutId="activeNav"
                  className="absolute inset-0 rounded-lg"
                  style={{ backgroundColor: "var(--background-hover)" }}
                  transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
                />
              )}

              {/* Hover bg */}
              <span
                className="absolute inset-0 rounded-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                style={{
                  backgroundColor: "var(--background-hover)",
                  display: isActive ? "none" : "block",
                }}
              />

              <Icon
                className={cn(
                  "relative z-10 h-4 w-4 flex-shrink-0 transition-colors",
                  isActive ? "text-blue-400" : "text-zinc-500 group-hover:text-zinc-300"
                )}
              />

              <span className="relative z-10 flex-1">{item.label}</span>

              {isActive && (
                <ChevronRight className="relative z-10 h-3.5 w-3.5 text-blue-400 opacity-60" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* ─── Bottom section ─── */}
      <div className="border-t p-2 pb-3" style={{ borderColor: "var(--border)" }}>
        {bottomItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                isActive ? "text-white" : "hover:text-white"
              )}
              style={
                !isActive
                  ? { color: "var(--foreground-muted)" }
                  : { color: "white" }
              }
            >
              <span
                className="absolute inset-0 rounded-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                style={{ backgroundColor: "var(--background-hover)" }}
              />
              <Icon
                className={cn(
                  "h-4 w-4 flex-shrink-0 transition-colors",
                  isActive ? "text-blue-400" : "text-zinc-500 group-hover:text-zinc-300"
                )}
              />
              <span>{item.label}</span>
            </Link>
          )
        })}

        {/* User avatar strip */}
        <div
          className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 cursor-pointer hover:bg-zinc-800/50"
        >
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
          >
            P
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-zinc-300">Portfolio</p>
            <p className="truncate text-[11px]" style={{ color: "var(--foreground-dim)" }}>
              pro@exemple.com
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}
