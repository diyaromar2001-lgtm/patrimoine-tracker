import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
)

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { data, error } = await supabase.rpc("sql", {
      query: `
SELECT
  a.id,
  a.ticker,
  a.currency,
  a.quantity,
  a.avg_buy_price,
  a.cost_basis_chf,
  (a.quantity * a.avg_buy_price) AS native_total,
  CASE
    WHEN a.currency = 'CHF' THEN 'CHF natif'
    WHEN a.cost_basis_chf IS NULL THEN 'Manquant'
    WHEN ABS(a.cost_basis_chf / (a.quantity * a.avg_buy_price) - 1.0) < 0.03
      THEN 'CORROMPU (native stocké sans FX)'
    ELSE 'Valide (CHF historique)'
  END AS status,
  -- Reconstruction via transactions
  COALESCE(
    (SELECT SUM(COALESCE(net_amount_chf, 0))
     FROM transactions t
     WHERE t.asset_id = a.id AND t.type = 'buy'),
    0
  ) AS cost_from_transactions
FROM assets a
WHERE a.asset_class != 'cash'
ORDER BY status, a.ticker
      `
    })

    if (error) {
      console.error("[audit] RPC error:", error)
      // Fallback: direct SQL via query (if RPC doesn't work)
      const { data: results, error: queryError } = await supabase
        .from("assets")
        .select("*")
        .neq("asset_class", "cash")

      if (queryError) {
        return NextResponse.json(
          { error: "Cannot execute audit query", details: queryError },
          { status: 500 }
        )
      }

      // Manual calculation in JS
      const audit = await Promise.all(
        (results || []).map(async (a: any) => {
          const nativeTotal = a.quantity * a.avg_buy_price
          let status = "CHF natif"
          if (a.currency !== "CHF") {
            if (a.cost_basis_chf == null) {
              status = "Manquant"
            } else if (Math.abs(a.cost_basis_chf / nativeTotal - 1.0) < 0.03) {
              status = "CORROMPU (native stocké sans FX)"
            } else {
              status = "Valide (CHF historique)"
            }
          }

          // Get transaction sum
          const { data: txs } = await supabase
            .from("transactions")
            .select("net_amount_chf")
            .eq("asset_id", a.id)
            .eq("type", "buy")

          const costFromTransactions = (txs || []).reduce(
            (s: number, t: any) => s + (t.net_amount_chf || 0),
            0
          )

          return {
            id: a.id,
            ticker: a.ticker,
            currency: a.currency,
            quantity: a.quantity,
            avg_buy_price: a.avg_buy_price,
            cost_basis_chf: a.cost_basis_chf,
            native_total: nativeTotal,
            status,
            cost_from_transactions: costFromTransactions,
          }
        })
      )

      const summary = {
        total_assets: audit.length,
        chf_native: audit.filter((x: any) => x.status === "CHF natif").length,
        missing: audit.filter((x: any) => x.status === "Manquant").length,
        corrupted: audit.filter(
          (x: any) => x.status === "CORROMPU (native stocké sans FX)"
        ).length,
        valid: audit.filter(
          (x: any) => x.status === "Valide (CHF historique)"
        ).length,
        details: audit,
      }

      return NextResponse.json(summary)
    }

    // RPC succeeded
    const summary = {
      total_assets: (data || []).length,
      chf_native: (data || []).filter(
        (x: any) => x.status === "CHF natif"
      ).length,
      missing: (data || []).filter(
        (x: any) => x.status === "Manquant"
      ).length,
      corrupted: (data || []).filter(
        (x: any) => x.status === "CORROMPU (native stocké sans FX)"
      ).length,
      valid: (data || []).filter(
        (x: any) => x.status === "Valide (CHF historique)"
      ).length,
      details: data || [],
    }

    return NextResponse.json(summary)
  } catch (e) {
    console.error("[audit] error:", e)
    return NextResponse.json(
      { error: "Audit failed", details: String(e) },
      { status: 500 }
    )
  }
}
