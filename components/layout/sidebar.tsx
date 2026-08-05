"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect } from "react"
import {
  LayoutDashboard, Briefcase, TrendingUp, Eye,
  Calculator, ArrowLeftRight, Settings, Wallet,
  ChevronLeft, ChevronRight, LogOut, ArrowDownUp,
  PieChart, Target, User, ChevronUp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient, signOut } from "@/lib/supabase/client"

const NAV_SECTIONS = [
  {
    label: "Patrimoine",
    items: [
      { label: "Tableau de bord", href: "/",           icon: LayoutDashboard },
      { label: "Portefeuilles",   href: "/portfolios", icon: Briefcase       },
      { label: "Cashflow",        href: "/cashflow",   icon: ArrowDownUp     },
      { label: "Dividendes",      href: "/dividends",  icon: TrendingUp      },
      { label: "Analyses",        href: "/analyses",   icon: PieChart        },
      { label: "Objectifs",       href: "/objectifs",  icon: Target          },
    ],
  },
  {
    label: "Outils",
    items: [
      { label: "Watchlist",       href: "/watchlist",      icon: Eye            },
      { label: "Transactions",    href: "/transactions",   icon: ArrowLeftRight },
      { label: "Calculateur DCA", href: "/dca-calculator", icon: Calculator     },
    ],
  },
]

interface SidebarProps {
  collapsed: boolean
  onToggle:  () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const [user, setUser] = useState<{ email?: string; name?: string; avatar?: string } | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)

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
        "fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
      style={{
        backgroundColor: "var(--sidebar-bg)",
        borderRight:     "1px solid var(--border)",
      }}
    >
      {/* ── Logo ───────────────────────────────────────────────────────── */}
      <div
        className="flex h-14 flex-shrink-0 items-center border-b"
        style={{ borderColor: "var(--border)", padding: collapsed ? "0 12px" : "0 16px" }}
      >
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{
            background: "linear-gradient(135deg, #6366f1, #818cf8)",
            boxShadow: "0 0 12px #6366f140",
          }}
        >
          <Wallet className="h-3.5 w-3.5 text-white" />
        </div>

        {!collapsed && (
          <span className="ml-2.5 text-sm font-semibold tracking-tight truncate"
            style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            Patrimoine
          </span>
        )}

        <button
          onClick={onToggle}
          className={cn(
            "ml-auto flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150",
            "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
          )}
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronLeft  className="h-3.5 w-3.5" />
          }
        </button>
      </div>

      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <nav className="flex flex-1 flex-col overflow-y-auto p-2 gap-0.5">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className={cn("mb-1", si > 0 && "mt-2")}>
            {/* Section label */}
            {!collapsed && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-tertiary)", letterSpacing: "0.08em" }}>
                {section.label}
              </p>
            )}

            {section.items.map((item) => {
              const Icon     = item.icon
              const isActive = pathname === item.href

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex items-center rounded-lg py-2 text-sm font-medium",
                    "transition-all duration-150 select-none",
                    collapsed ? "justify-center px-2" : "gap-2.5 px-2.5",
                    isActive
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  {/* Active indicator */}
                  {isActive && (
                    <motion.div
                      layoutId="navActive"
                      className="absolute inset-0 rounded-lg"
                      style={{ backgroundColor: "var(--bg-subtle)" }}
                      transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
                    />
                  )}

                  {/* Hover bg */}
                  {!isActive && (
                    <span className="absolute inset-0 rounded-lg opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ backgroundColor: "var(--bg-muted)" }} />
                  )}

                  {/* Icon */}
                  <Icon
                    className={cn(
                      "relative z-10 flex-shrink-0 transition-colors",
                      collapsed ? "h-[18px] w-[18px]" : "h-4 w-4",
                      isActive ? "text-[var(--accent)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"
                    )}
                  />

                  {/* Label */}
                  {!collapsed && (
                    <span className="relative z-10 flex-1 truncate">{item.label}</span>
                  )}

                  {/* Active dot for collapsed */}
                  {collapsed && isActive && (
                    <span className="absolute right-1 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: "var(--accent)" }} />
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* ── Bottom : menu de compte ────────────────────────────────────── */}
      <div className="relative flex flex-col gap-0.5 border-t p-2 pb-3"
        style={{ borderColor: "var(--border)" }}>

        <AnimatePresence>
          {accountOpen && !collapsed && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-xl border shadow-2xl"
              style={{ backgroundColor: "var(--bg-overlay)", borderColor: "var(--border)" }}
            >
              {[
                { label: "Mon profil",  href: "/settings", icon: User     },
                { label: "Paramètres",  href: "/settings", icon: Settings },
              ].map(item => (
                <Link key={item.label} href={item.href}
                  onClick={() => setAccountOpen(false)}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--bg-muted)]"
                  style={{ color: "var(--text-secondary)" }}>
                  <item.icon className="h-3.5 w-3.5" style={{ color: "var(--text-tertiary)" }} />
                  {item.label}
                </Link>
              ))}
              <button onClick={signOut}
                className="flex w-full items-center gap-2.5 border-t px-3.5 py-2.5 text-[13px] font-medium transition-colors hover:bg-red-500/10"
                style={{ color: "var(--loss)", borderColor: "var(--border-subtle)" }}>
                <LogOut className="h-3.5 w-3.5" />
                Se déconnecter
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {user && !collapsed && (
          <button
            onClick={() => setAccountOpen(o => !o)}
            aria-expanded={accountOpen}
            aria-label="Menu du compte"
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--bg-muted)]"
            style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          >
            {user.avatar ? (
              <img src={user.avatar} alt="" className="h-7 w-7 flex-shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]" />
            ) : (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}>
                {(user.name ?? "U").charAt(0).toUpperCase()}
              </div>
            )}
            {/* Nom uniquement — l'email reste dans Mon profil */}
            <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              {user.name}
            </span>
            <ChevronUp className={cn("h-3.5 w-3.5 flex-shrink-0 transition-transform", accountOpen && "rotate-180")}
              style={{ color: "var(--text-tertiary)" }} />
          </button>
        )}

        {user && collapsed && (
          <button onClick={signOut}
            title="Se déconnecter"
            className="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-red-500/20 mx-auto"
            style={{ color: "var(--text-tertiary)" }}>
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  )
}
