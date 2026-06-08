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
      // Step 1: Create portfolio
      const portfolioId = await addPortfolio({
        name: portfolioName,
        description: `Import Trading 212 - ${file.name}`,
        color: "#3b82f6",
        currency: "CHF",
        cashBalances: { CHF: 0, USD: 0, EUR: 0 },
        createdAt: new Date().toISOString().slice(0, 10),
      })

      if (!portfolioId) {
        throw new Error("Impossible de créer le portefeuille")
      }

      try {
        // Step 2: Get file checksum
        const fileChecksum = await computeFileChecksum(file)

        // Step 3: Call RPC import_csv_batch
        if (!supabase) {
          throw new Error("Supabase client not available")
        }

        const { data, error } = await supabase.rpc("import_csv_batch", {
          p_portfolio_id: portfolioId,
          p_broker: "trading_212",
          p_filename: file.name,
          p_file_checksum: fileChecksum,
          p_operations: operations,
        })

        if (error) {
          console.error("Import RPC error:", error)
          throw new Error(`Import failed: ${error.message}`)
        }

        if (!data || !data[0]) {
          throw new Error("Import returned no result")
        }

        const result = data[0]
        if (!result.success) {
          throw new Error(result.error_message || "Import failed")
        }

        return {
          portfolioId,
          batchId: result.batch_id,
        }
      } catch (error) {
        // Atomic compensation: delete created portfolio if import fails
        console.error("Import failed, rolling back portfolio creation:", error)
        try {
          await removePortfolio(portfolioId)
        } catch (rollbackError) {
          console.error("Failed to rollback portfolio:", rollbackError)
          // Still throw original error
        }
        throw error
      }
    },
    [addPortfolio, removePortfolio, supabase]
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
