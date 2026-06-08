import { useCallback } from "react"
import { useAppData } from "@/hooks/use-app-data"
import { createClient } from "@/lib/supabase/client"

interface ImportResult {
  portfolioId: string
  batchId: string
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
      // Get file checksum
      const fileChecksum = await computeFileChecksum(file)

      // Call atomic RPC: creates portfolio AND imports in single transaction
      if (!supabase) {
        throw new Error("Supabase client not available")
      }

      const { data, error } = await supabase.rpc("create_portfolio_and_import_trading212", {
        p_portfolio_name: portfolioName,
        p_portfolio_description: `Import Trading 212 - ${file.name}`,
        p_portfolio_color: "#3b82f6",
        p_broker: "trading_212",
        p_filename: file.name,
        p_file_checksum: fileChecksum,
        p_operations: operations,
      })

      if (error) {
        console.error("Atomic import RPC error:", error)
        throw new Error(`Import failed: ${error.message}`)
      }

      if (!data) {
        throw new Error("Import returned no result")
      }

      if (!data.success) {
        throw new Error(data.error_message || "Import failed")
      }

      return {
        portfolioId: data.portfolio_id,
        batchId: data.batch_id,
      }
    },
    [supabase]
  )

  return { importTrading212CSV }
}

/**
 * Compute SHA-256 checksum of file
 */
async function computeFileChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  return hashHex
}
