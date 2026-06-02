"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import { useState, useEffect } from "react"
import {
  LayoutDashboard, Briefcase, TrendingUp, Eye,
  Calculator, ArrowLeftRight, Settings, Wallet,
  ChevronLeft, ChevronRight, LogOut,
} from "lucide-react"
import { createClient, signOut } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

const NAV = [
  { label: "Dashboard",      href: "/",             icon: LayoutDashboard },
  { label: "Portefeuilles",  href: "/portfolios",   icon: Briefcase       },
  { label: "Dividendes",     href: "/dividends",    icon: TrendingUp      },
  { label: "Watchlist",      href: "/watchlist",    icon: Eye             },
  { label: "DCA Calculator", href: "/dca-calculator", icon: Calculator   },
  { label: "Transactions",   href: "/transactions", icon: ArrowLeftRight  },
]
const BOTTOM = [{ label: "Paramètres", href: "/settings", icon: Settings }]

interface SidebarProps {
  collapsed:  boolean
  onToggle:   () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const [user, setUser] = useState<{ email?: string; name?: string; avatar?: string } | null>(null)

  useEffect(() => {
    const sb = createClient()
    if (!sb) return
    sb.auth.getUser().then(({ data }) => {
      if (data.user) {
        const meta = data.user.user_metadata ?? {}
        setUser({
          email:  data.user.email,
          name:   meta.full_name ?? meta.name ?? data.user.email?.split("@")[0],
          avatar: meta.avatar_url ?? meta.picture,
        })
      }
    })
  }, [])

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex flex-col border-r transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
      style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}
    >
      {/* ─── Logo ─── */}
      <div
        className="flex h-14 flex-shrink-0 items-center border-b"
        style={{ borderColor: "var(--border)", padding: collapsed ? "0 12px" : "0 16px" }}
      >
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}
        >
          <Wallet className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <span className="ml-2.5 text-sm font-semibold tracking-tight text-zinc-100 truncate">
            Patrimoine
          </span>
        )}
        {/* Toggle button */}
        <button
          onClick={onToggle}
          className={cn(
            "ml-auto flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200",
            collapsed && "mx-auto ml-auto"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronLeft  className="h-3.5 w-3.5" />
          }
        </button>
      </div>

      {/* ─── Navigation ─── */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 pt-3">
        {!collapsed && (
          <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-widest text-zinc-600">
            Menu
          </p>
        )}

        {NAV.map((item) => {
          const Icon     = item.icon
          const isActive = pathname === item.href

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                // ← NO inline style — pure Tailwind for correct hover behaviour
                "group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-all duration-150",
                collapsed ? "justify-center px-2" : "px-3",
                isActive
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-100"
              )}
            >
              {isActive && !collapsed && (
                <motion.div
                  layoutId="activeNav"
                  className="absolute inset-0 rounded-lg bg-zinc-800"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.3 }}
                />
              )}

              <Icon
                className={cn(
                  "relative z-10 h-4 w-4 flex-shrink-0 transition-colors",
                  isActive ? "text-blue-400" : "group-hover:text-zinc-300"
                )}
              />

              {!collapsed && (
                <>
                  <span className="relative z-10 flex-1">{item.label}</span>
                  {isActive && (
                    <ChevronRight className="relative z-10 h-3.5 w-3.5 text-blue-400 opacity-60" />
                  )}
                </>
              )}
            </Link>
          )
        })}
      </nav>

      {/* ─── Bottom ─── */}
      <div className="border-t p-2 pb-3" style={{ borderColor: "var(--border)" }}>
        {BOTTOM.map((item) => {
          const Icon     = item.icon
          const isActive = pathname === item.href
          return (
            <Link key={item.href} href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-all duration-150",
                collapsed ? "justify-center px-2" : "px-3",
                isActive ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-100"
              )}
            >
              <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-blue-400" : "")} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}

        {/* User strip */}
        {user && (
          <div className={cn(
            "mt-2 flex items-center gap-3 rounded-lg py-2 transition-colors",
            collapsed ? "justify-center px-2" : "px-3"
          )}>
            {/* Avatar */}
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="h-7 w-7 flex-shrink-0 rounded-full object-cover" />
            ) : (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
                {(user.name ?? "U").charAt(0).toUpperCase()}
              </div>
            )}

            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-300">{user.name}</p>
                  <p className="truncate text-[11px] text-zinc-600">{user.email}</p>
                </div>
                <button
                  onClick={signOut}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-red-500/20 hover:text-red-400"
                  title="Se déconnecter"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
