import { useCallback } from "react"
import { useAppData } from "@/hooks/use-app-data"
import { createClient } from "@/lib/supabase/client"

export interface ImportResult {
  portfolioId: string
  batchId: string
  rowsImported: number
  rowsTotal: number
}

/**
 * Parse the raw Supabase RPC response into a typed ImportResult.
 *
 * `RETURNS TABLE` functions are returned by the Supabase JS client as an
 * **array**, even when the function yields a single row.  Previous code did
 * `data.success` directly on the array, which always evaluated to `undefined`
 * (falsy), so the hook threw "Import failed" even on a successful import.
 *
 * Exported so it can be unit-tested independently of React / Supabase.
 */
export function parseImportResult(data: unknown): ImportResult {
  // Unwrap: RETURNS TABLE → array; plain object fallback for future-proofing
  const result = Array.isArray(data) ? data[0] : (data as any)

  if (!result) {
    throw new Error("Import returned no result")
  }

  if (!result.success) {
    const msg: string = result.error_message ?? "Import failed"
    // Surface a clear French message for the duplicate-file case
    if (msg.toLowerCase().includes("already imported")) {
      throw new Error("Ce fichier a déjà été importé.")
    }
    throw new Error(msg)
  }

  return {
    portfolioId: result.portfolio_id,
    batchId:     result.batch_id,
    rowsImported: result.rows_imported ?? 0,
    rowsTotal:    result.rows_total    ?? 0,
  }
}

export function usePortfolioImport() {
  const { addPortfolio, removePortfolio } = useAppData()
  const supabase = createClient()

  const importTrading212CSV = useCallback(
    async (
      portfolioName: string,
      file: File,
      operations: any[]
    ): Promise<ImportResult> => {
      const fileChecksum = await computeFileChecksum(file)

      if (!supabase) {
        throw new Error("Supabase client not available")
      }

      const { data, error } = await supabase.rpc(
        "create_portfolio_and_import_trading212",
        {
          p_portfolio_name:     portfolioName,
          p_portfolio_currency: "CHF",
          p_broker:             "trading_212",
          p_filename:           file.name,
          p_file_checksum:      fileChecksum,
          p_operations:         operations,
        }
      )

      // Log the raw response to aid debugging (visible in browser console)
      console.log("[usePortfolioImport] RPC raw response:", { data, error })

      if (error) {
        console.error("[usePortfolioImport] RPC error:", error)
        throw new Error(`Import failed: ${error.message}`)
      }

      return parseImportResult(data)
    },
    [supabase]
  )

  return { importTrading212CSV }
}

/**
 * SHA-256 checksum of the file bytes (browser crypto API).
 */
async function computeFileChecksum(file: File): Promise<string> {
  const buffer    = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  const hashArray  = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}
