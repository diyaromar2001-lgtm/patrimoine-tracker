"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { User, Globe, Palette, Wrench, CheckCircle2, Loader2, RefreshCw } from "lucide-react"
import { useCurrency } from "@/hooks/use-currency"
import { useAppData } from "@/hooks/use-app-data"
import type { AppCurrency } from "@/lib/utils"
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client"
import * as Q from "@/lib/supabase/queries"
import { replayPosition } from "@/lib/replay-position"

const CURRENCY_OPTIONS: { value: AppCurrency; label: string; flag: string }[] = [
  { value: "CHF", label: "Franc suisse", flag: "🇨🇭" },
  { value: "USD", label: "Dollar US",    flag: "🇺🇸" },
  { value: "EUR", label: "Euro",         flag: "🇪🇺" },
]

interface RepairDiff {
  assetId:     string
  ticker:      string
  name:        string
  oldQty:      number
  newQty:      number
  oldAvg:      number
  newAvg:      number
  oldCost:     number
  newCost:     number
}

export default function SettingsPage() {
  const { currency: activeCurrency, setCurrency } = useCurrency()
  const { portfolios, transactions, refresh } = useAppData()

  const [savedField, setSavedField] = useState("")
  const [user, setUser] = useState<{ name: string; email: string; avatar: string } | null>(null)

  // ── Réparation des positions ──────────────────────────────────────────────
  const [repairDiffs,   setRepairDiffs]   = useState<RepairDiff[] | null>(null)
  const [repairRunning, setRepairRunning] = useState(false)
  const [repairApplied, setRepairApplied] = useState(false)

  useEffect(() => {
    const sb = createClient()
    if (!sb) return
    sb.auth.getUser().then(({ data }) => {
      if (data.user) {
        const meta = data.user.user_metadata ?? {}
        const name = meta.full_name ?? meta.name ?? data.user.email?.split("@")[0] ?? "Utilisateur"
        setUser({
          name,
          email: data.user.email ?? "—",
          avatar: String(name).charAt(0).toUpperCase(),
        })
      }
    })
  }, [])

  function showSaved(field: string) {
    setSavedField(field)
    setTimeout(() => setSavedField(""), 2000)
  }

  function handleCurrencyChange(c: AppCurrency) {
    setCurrency(c)
    showSaved("currency")
  }

  /**
   * Aperçu du recalcul : rejoue chaque position depuis SES transactions
   * (replay canonique — avg natif + cost basis CHF historique) et liste les
   * écarts. RIEN n'est écrit tant que l'utilisateur n'a pas confirmé.
   * Les actifs sans transaction chargée sont ignorés (sécurité).
   */
  function computeRepairPreview() {
    const diffs: RepairDiff[] = []
    for (const p of portfolios) {
      for (const a of p.assets) {
        if (a.assetClass === "cash") continue
        const txs = transactions.filter(t =>
          (t.assetId ? t.assetId === a.id : (t.portfolioId === p.id && t.ticker === a.ticker)) &&
          (t.type === "buy" || t.type === "sell")
        )
        if (!txs.some(t => t.type === "buy")) continue  // jamais recalculer sans historique d'achat

        const r = replayPosition(Q.txsToReplayEvents(
          txs.map(t => ({
            type: t.type,
            date: t.date,
            quantity: t.quantity,
            price: t.price,
            fees: t.fees,
            net_amount_chf: t.netAmountChf ?? null,
            fx_rate_to_chf: t.fxRateToChf ?? null,
          }))
        ))

        const changed =
          Math.abs(r.quantity - a.quantity) > 1e-6 ||
          Math.abs(r.avgBuyPriceNative - a.avgBuyPrice) > 0.01 ||
          Math.abs(r.costBasisChf - (a.costBasisChf ?? 0)) > 0.05

        if (changed) {
          diffs.push({
            assetId: a.id, ticker: a.ticker, name: a.name,
            oldQty: a.quantity, newQty: r.quantity,
            oldAvg: a.avgBuyPrice, newAvg: r.avgBuyPriceNative,
            oldCost: a.costBasisChf ?? 0, newCost: r.costBasisChf,
          })
        }
      }
    }
    setRepairDiffs(diffs)
    setRepairApplied(false)
  }

  async function applyRepair() {
    if (!repairDiffs?.length) return
    setRepairRunning(true)
    try {
      for (const d of repairDiffs) {
        await Q.updateAssetPosition(d.assetId, d.newQty, d.newAvg, d.newCost)
      }
      await refresh()
      setRepairApplied(true)
      setRepairDiffs([])
    } finally {
      setRepairRunning(false)
    }
  }

  const fmt = (v: number, dec = 2) => Number(v).toLocaleString("fr-CH", { minimumFractionDigits: dec, maximumFractionDigits: dec })

  return (
    <div className="flex flex-col">
      <Topbar title="Paramètres" subtitle="Gérez votre compte et vos préférences" />
      <div className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-6">

          {/* ── Profil (données réelles Supabase Auth) ── */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <User className="h-4 w-4" style={{ color: "#3b82f6" }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Profil</h2>
            </div>
            <div className="p-5">
              {user ? (
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}>
                    {user.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{user.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{user.email}</p>
                    <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      Connecté via Google — le profil est géré par votre compte Google.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {isSupabaseConfigured ? "Chargement du profil…" : "Mode local — aucun compte connecté."}
                </p>
              )}
            </div>
          </section>

          {/* ── Devise d'affichage (fonctionnel) ── */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4" style={{ color: "#a78bfa" }} />
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Devise d'affichage</h2>
              </div>
              <AnimatePresence>
                {savedField === "currency" && (
                  <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#22c55e" }}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sauvegardé
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Tous les montants s'afficheront dans cette devise. Les prix des actifs affichent aussi leur devise d'origine.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {CURRENCY_OPTIONS.map(opt => {
                  const isActive = activeCurrency === opt.value
                  return (
                    <button key={opt.value}
                      onClick={() => handleCurrencyChange(opt.value)}
                      className="flex flex-col gap-2 rounded-xl border p-4 text-left transition-all hover:border-blue-500/50"
                      style={{
                        backgroundColor: isActive ? "#3b82f615" : "var(--bg-base)",
                        borderColor:     isActive ? "#3b82f6" : "var(--border)",
                        boxShadow:       isActive ? "0 0 0 1px #3b82f640" : "none",
                      }}>
                      <div className="flex items-center justify-between">
                        <span className="text-2xl">{opt.flag}</span>
                        {isActive && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: isActive ? "white" : "var(--text-primary)" }}>{opt.value}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{opt.label}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* ── Maintenance : recalcul des positions ── */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <Wrench className="h-4 w-4" style={{ color: "#f59e0b" }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Maintenance</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    Recalculer les positions depuis les transactions
                  </p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    Rejoue chronologiquement vos achats/ventes pour recalculer quantité, prix moyen (devise native)
                    et coût d'acquisition (CHF historique). Un aperçu s'affiche avant toute modification —
                    vos transactions ne sont jamais touchées.
                  </p>
                </div>
                <button
                  onClick={computeRepairPreview}
                  className="flex flex-shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors hover:bg-zinc-800"
                  style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                  <RefreshCw className="h-3.5 w-3.5" /> Analyser
                </button>
              </div>

              {repairApplied && (
                <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-xs font-medium"
                  style={{ borderColor: "#22c55e40", backgroundColor: "#22c55e10", color: "#22c55e" }}>
                  <CheckCircle2 className="h-4 w-4" /> Positions recalculées avec succès.
                </div>
              )}

              {repairDiffs !== null && !repairApplied && (
                repairDiffs.length === 0 ? (
                  <div className="rounded-lg border px-4 py-3 text-xs"
                    style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                    ✓ Toutes les positions correspondent déjà au replay des transactions — rien à corriger.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ color: "var(--text-tertiary)" }}>
                            <th className="px-3 py-2 text-left font-medium">Actif</th>
                            <th className="px-3 py-2 text-right font-medium">Quantité</th>
                            <th className="px-3 py-2 text-right font-medium">Prix moyen (natif)</th>
                            <th className="px-3 py-2 text-right font-medium">Coût CHF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {repairDiffs.map(d => (
                            <tr key={d.assetId} style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                              <td className="px-3 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>{d.ticker}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {fmt(d.oldQty, 4)} <span style={{ color: "var(--text-tertiary)" }}>→</span> <span style={{ color: "var(--text-primary)" }}>{fmt(d.newQty, 4)}</span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {fmt(d.oldAvg)} <span style={{ color: "var(--text-tertiary)" }}>→</span> <span style={{ color: "var(--text-primary)" }}>{fmt(d.newAvg)}</span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {fmt(d.oldCost)} <span style={{ color: "var(--text-tertiary)" }}>→</span> <span style={{ color: "var(--text-primary)" }}>{fmt(d.newCost)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setRepairDiffs(null)}
                        className="rounded-lg border px-3.5 py-2 text-xs font-medium"
                        style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                        Annuler
                      </button>
                      <button onClick={applyRepair} disabled={repairRunning}
                        className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-60"
                        style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}>
                        {repairRunning
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Application…</>
                          : <>Appliquer {repairDiffs.length} correction{repairDiffs.length > 1 ? "s" : ""}</>}
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>

          {/* ── Apparence ── */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <Palette className="h-4 w-4" style={{ color: "#22c55e" }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Apparence</h2>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-16 rounded-lg border" style={{ background: "#09090b", borderColor: "#27272a" }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Thème sombre</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    L'application est optimisée pour le thème sombre. Le thème clair arrivera dans une prochaine version.
                  </p>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
