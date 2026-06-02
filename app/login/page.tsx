"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { createClient } from "@/lib/supabase/client"
import {
  Wallet, TrendingUp, BarChart2, Shield,
  ArrowRight, Loader2, CheckCircle2,
} from "lucide-react"

// Google "G" SVG logo
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

const FEATURES = [
  {
    icon: TrendingUp,
    color: "#22c55e",
    title: "Suivi en temps réel",
    desc: "Prix live via Yahoo Finance & CoinGecko. Actions, ETF, Crypto.",
  },
  {
    icon: BarChart2,
    color: "#3b82f6",
    title: "Benchmarks intégrés",
    desc: "Comparez votre performance vs S&P 500 et MSCI World.",
  },
  {
    icon: Shield,
    color: "#a78bfa",
    title: "Données sécurisées",
    desc: "Chaque compte est isolé. Vos données restent privées.",
  },
]

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState("")

  async function signInWithGoogle() {
    const sb = createClient()
    if (!sb) { setError("Supabase non configuré."); return }

    setLoading(true); setError("")
    const { error: authError } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
    } else {
      setDone(true)
      // Browser redirects to Google — no need to setLoading(false)
    }
  }

  return (
    <div
      className="min-h-dvh flex flex-col"
      style={{ backgroundColor: "#09090b", color: "#fafafa", fontFamily: "Inter, ui-sans-serif" }}
    >
      {/* ─── Nav ─── */}
      <nav className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#1f1f23" }}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
            <Wallet className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Patrimoine Tracker</span>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: "#27272a", color: "#71717a" }}>
          Beta
        </span>
      </nav>

      {/* ─── Hero ─── */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 mb-6 text-xs font-medium"
            style={{ borderColor: "#3b82f640", backgroundColor: "#3b82f610", color: "#3b82f6" }}>
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            Prix en temps réel · CHF / USD / EUR
          </div>

          {/* Title */}
          <h1 className="text-4xl font-bold tracking-tight mb-4" style={{ lineHeight: 1.15 }}>
            Suivez votre{" "}
            <span style={{ background: "linear-gradient(135deg,#3b82f6,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              patrimoine
            </span>
            <br />en temps réel
          </h1>

          <p className="text-base mb-10" style={{ color: "#a1a1aa", lineHeight: 1.7 }}>
            Actions, ETF, Crypto — tout centralisé en un tableau de bord.<br />
            Comparez vos performances aux benchmarks mondiaux.
          </p>

          {/* Google Sign-in button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={signInWithGoogle}
            disabled={loading || done}
            className="w-full flex items-center justify-center gap-3 rounded-xl px-6 py-3.5 text-sm font-semibold transition-all disabled:opacity-60"
            style={{
              backgroundColor: "#fff",
              color: "#1a1a1a",
              boxShadow: "0 0 0 1px #e4e4e7, 0 4px 24px rgba(0,0,0,0.4)",
            }}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : done ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <GoogleIcon className="h-4 w-4" />
            )}
            {loading
              ? "Redirection vers Google…"
              : done
              ? "Redirection…"
              : "Se connecter avec Google"
            }
          </motion.button>

          {/* Error */}
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 text-xs"
              style={{ color: "#ef4444" }}
            >
              {error}
            </motion.p>
          )}

          <p className="mt-4 text-xs" style={{ color: "#52525b" }}>
            En continuant, vous acceptez nos conditions d&apos;utilisation.<br />
            Vos données sont chiffrées et isolées par compte.
          </p>
        </motion.div>

        {/* ─── Features ─── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-16 grid gap-4 sm:grid-cols-3 w-full max-w-2xl"
        >
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                className="rounded-2xl border p-5 text-left"
                style={{ backgroundColor: "#111113", borderColor: "#1f1f23" }}
              >
                <div
                  className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ backgroundColor: f.color + "18" }}
                >
                  <Icon className="h-4.5 w-4.5" style={{ color: f.color }} />
                </div>
                <p className="text-sm font-semibold mb-1">{f.title}</p>
                <p className="text-xs leading-relaxed" style={{ color: "#71717a" }}>{f.desc}</p>
              </div>
            )
          })}
        </motion.div>
      </main>

      {/* ─── Footer ─── */}
      <footer className="py-6 text-center border-t" style={{ borderColor: "#1f1f23" }}>
        <p className="text-xs" style={{ color: "#3f3f46" }}>
          © 2026 Patrimoine Tracker · Données fournies par Yahoo Finance & CoinGecko
        </p>
      </footer>
    </div>
  )
}
