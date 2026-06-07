"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"

interface AuditResult {
  total_assets: number
  chf_native: number
  missing: number
  corrupted: number
  valid: number
  details: Array<{
    id: string
    ticker: string
    currency: string
    quantity: number
    avg_buy_price: number
    cost_basis_chf: number | null
    native_total: number
    status: string
    cost_from_transactions: number
  }>
}

export default function AuditPage() {
  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch("/api/audit-cost-basis", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("auth_token") || ""}`,
          },
        })
        if (!res.ok) throw new Error(`${res.status}`)
        setResult(await res.json())
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    fetch_()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen gap-2">
        <Loader2 className="animate-spin" /> Audit en cours...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-4xl">
        <div className="rounded-lg border border-red-500 bg-red-900/20 p-4 text-red-300">
          ❌ Erreur audit: {error}
        </div>
      </div>
    )
  }

  if (!result) return <div>Pas de résultats</div>

  const corrupted = result.details.filter(
    (d) => d.status === "CORROMPU (native stocké sans FX)"
  )
  const missing = result.details.filter((d) => d.status === "Manquant")
  const valid = result.details.filter((d) => d.status === "Valide (CHF historique)")
  const chf = result.details.filter((d) => d.status === "CHF natif")

  return (
    <div className="p-6 max-w-7xl space-y-8">
      <h1 className="text-3xl font-bold">Audit costBasisChf</h1>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-xl border p-4 bg-zinc-900/40">
          <p className="text-xs text-gray-400 mb-1">Total</p>
          <p className="text-2xl font-bold">{result.total_assets}</p>
        </div>
        <div className="rounded-xl border p-4 bg-green-900/20 border-green-700">
          <p className="text-xs text-green-300 mb-1">Valide</p>
          <p className="text-2xl font-bold text-green-300">{result.valid}</p>
        </div>
        <div className="rounded-xl border p-4 bg-red-900/20 border-red-700">
          <p className="text-xs text-red-300 mb-1">Corrompu</p>
          <p className="text-2xl font-bold text-red-300">{result.corrupted}</p>
        </div>
        <div className="rounded-xl border p-4 bg-yellow-900/20 border-yellow-700">
          <p className="text-xs text-yellow-300 mb-1">Manquant/CHF</p>
          <p className="text-2xl font-bold text-yellow-300">
            {result.missing + result.chf_native}
          </p>
        </div>
      </div>

      {/* Corrupted assets */}
      {corrupted.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-red-300">
            🔴 Données corrompues ({corrupted.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-red-700/50">
            <table className="w-full text-sm">
              <thead className="bg-red-900/30">
                <tr>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-right">Devise</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Prix moy natif</th>
                  <th className="px-3 py-2 text-right">Native total</th>
                  <th className="px-3 py-2 text-right">costBasisChf en DB</th>
                  <th className="px-3 py-2 text-right">Coût réel (transactions)</th>
                  <th className="px-3 py-2 text-right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {corrupted.map((d) => (
                  <tr
                    key={d.id}
                    className="border-t border-red-700/30 hover:bg-red-900/20"
                  >
                    <td className="px-3 py-2 font-mono font-bold">{d.ticker}</td>
                    <td className="px-3 py-2 text-right">{d.currency}</td>
                    <td className="px-3 py-2 text-right">
                      {d.quantity.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {d.avg_buy_price.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {d.native_total.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-300">
                      {d.cost_basis_chf?.toFixed(2) || "NULL"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-green-300">
                      {d.cost_from_transactions.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-yellow-300">
                      {(
                        d.cost_from_transactions - (d.cost_basis_chf || 0)
                      ).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Valid assets */}
      {valid.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-green-300">
            ✅ Données valides ({valid.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-green-700/50">
            <table className="w-full text-sm">
              <thead className="bg-green-900/30">
                <tr>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-right">Devise</th>
                  <th className="px-3 py-2 text-right">costBasisChf en DB</th>
                  <th className="px-3 py-2 text-right">Coût (transactions)</th>
                  <th className="px-3 py-2 text-right">Match ?</th>
                </tr>
              </thead>
              <tbody>
                {valid.map((d) => (
                  <tr
                    key={d.id}
                    className="border-t border-green-700/30 hover:bg-green-900/20"
                  >
                    <td className="px-3 py-2 font-mono font-bold">{d.ticker}</td>
                    <td className="px-3 py-2 text-right">{d.currency}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {d.cost_basis_chf?.toFixed(2) || "NULL"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {d.cost_from_transactions.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {Math.abs(
                        (d.cost_basis_chf || 0) - d.cost_from_transactions
                      ) < 1 ? (
                        <span className="text-green-300">✓</span>
                      ) : (
                        <span className="text-yellow-300">
                          Δ{(
                            (d.cost_basis_chf || 0) - d.cost_from_transactions
                          ).toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Missing */}
      {missing.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-yellow-300">
            ⚠️ Données manquantes ({missing.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-yellow-700/50">
            <table className="w-full text-sm">
              <thead className="bg-yellow-900/30">
                <tr>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-right">Devise</th>
                  <th className="px-3 py-2 text-right">Coût (transactions)</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((d) => (
                  <tr
                    key={d.id}
                    className="border-t border-yellow-700/30 hover:bg-yellow-900/20"
                  >
                    <td className="px-3 py-2 font-mono font-bold">{d.ticker}</td>
                    <td className="px-3 py-2 text-right">{d.currency}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {d.cost_from_transactions.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conclusion */}
      <div className="rounded-lg border p-4 bg-blue-900/20 border-blue-700">
        <p className="text-sm text-blue-300">
          <strong>Action requise :</strong>
          {corrupted.length > 0 && (
            <>
              {" "}
              Corriger {corrupted.length} données corrompues (native stocké en DB
              sans FX) en utilisant les transactions historiques.
            </>
          )}
          {missing.length > 0 && (
            <>
              {" "}
              Remplir {missing.length} données manquantes en recalculant depuis
              transactions.
            </>
          )}
          {corrupted.length === 0 && missing.length === 0 && (
            <>
              {" "}
              ✓ Toutes les données sont valides ou CHF natif. Aucune correction
              requise.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
