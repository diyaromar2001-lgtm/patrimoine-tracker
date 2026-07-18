"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { useState } from "react"
import {
  LayoutDashboard, Briefcase, Eye, ArrowLeftRight,
  Grid3X3, TrendingUp, Calculator, Settings, X, Wallet, ArrowDownUp,
  PieChart, Target,
} from "lucide-react"
import { cn } from "@/lib/utils"

const PRIMARY_ITEMS = [
  { label: "Dashboard",    href: "/",            icon: LayoutDashboard },
  { label: "Portefeuilles",href: "/portfolios",  icon: Briefcase },
  { label: "Watchlist",    href: "/watchlist",   icon: Eye },
  { label: "Transactions", href: "/transactions",icon: ArrowLeftRight },
]

const MORE_ITEMS = [
  { label: "Cashflow",       href: "/cashflow",       icon: ArrowDownUp },
  { label: "Dividendes",     href: "/dividends",      icon: TrendingUp },
  { label: "Analyses",       href: "/analyses",       icon: PieChart },
  { label: "Objectifs",      href: "/objectifs",      icon: Target },
  { label: "Revenus annexes",href: "/revenus",        icon: TrendingUp },
  { label: "Calculateur DCA",href: "/dca-calculator", icon: Calculator },
  { label: "Paramètres",     href: "/settings",       icon: Settings },
]

export function MobileNav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const isMoreActive = MORE_ITEMS.some(i => i.href === pathname)

  return (
    <>
      {/* Bottom bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t lg:hidden"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderColor: "var(--border)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          height: "calc(56px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {PRIMARY_ITEMS.map(item => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors"
              style={{ color: isActive ? "var(--accent)" : "var(--text-tertiary)" }}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="mobileActiveTab"
                  className="absolute bottom-0 h-0.5 w-8 rounded-full"
                  style={{ backgroundColor: "var(--accent)" }}
                  transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
                />
              )}
            </Link>
          )
        })}

        {/* More button */}
        <button
          onClick={() => setMoreOpen(o => !o)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors"
          style={{ color: isMoreActive || moreOpen ? "var(--accent)" : "var(--text-tertiary)" }}
        >
          <Grid3X3 className="h-5 w-5" />
          <span className="text-[10px] font-medium">Plus</span>
        </button>
      </nav>

      {/* "More" bottom sheet */}
      <AnimatePresence>
        {moreOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
              onClick={() => setMoreOpen(false)}
            />

            {/* Sheet */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-x lg:hidden"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border)",
                paddingBottom: "calc(56px + env(safe-area-inset-bottom, 0px))",
              }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="h-1 w-10 rounded-full" style={{ backgroundColor: "var(--border)" }} />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}>
                    <Wallet className="h-4 w-4 text-white" />
                  </div>
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Patrimoine</span>
                </div>
                <button onClick={() => setMoreOpen(false)} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
                  <X className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
                </button>
              </div>

              {/* Links */}
              <div className="px-3 pb-2 space-y-1">
                {MORE_ITEMS.map(item => {
                  const Icon = item.icon
                  const isActive = pathname === item.href
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className="flex items-center gap-3 rounded-xl px-4 py-3.5 transition-colors"
                      style={{
                        backgroundColor: isActive ? "var(--bg-muted)" : "transparent",
                        color: isActive ? "white" : "var(--text-secondary)",
                      }}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" style={{ color: isActive ? "var(--accent)" : "var(--text-tertiary)" }} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
