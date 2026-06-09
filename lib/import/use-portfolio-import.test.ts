import { describe, test, expect } from "vitest"
import { parseImportResult } from "@/hooks/use-portfolio-import"

// ---------------------------------------------------------------------------
// parseImportResult — unit tests
//
// The Supabase JS client returns RETURNS TABLE results as an array even when
// the function yields a single row.  These tests verify that:
//  1. Array-wrapped success responses are correctly unwrapped.
//  2. Plain-object responses (e.g. from tests / future SDK changes) also work.
//  3. success=false with error_message throws that message.
//  4. "already imported" maps to a clear French user-visible message.
//  5. Null / empty responses throw "no result".
// ---------------------------------------------------------------------------

describe("parseImportResult", () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  test("RETURNS TABLE array + success=true → resolves ImportResult", () => {
    const data = [
      {
        success: true,
        rows_imported: 480,
        rows_total: 480,
        portfolio_id: "pid-123",
        batch_id: "bid-456",
        error_message: null,
      },
    ]
    const result = parseImportResult(data)
    expect(result.portfolioId).toBe("pid-123")
    expect(result.batchId).toBe("bid-456")
    expect(result.rowsImported).toBe(480)
    expect(result.rowsTotal).toBe(480)
  })

  test("plain-object (non-array) + success=true → also resolves", () => {
    const data = {
      success: true,
      rows_imported: 10,
      rows_total: 10,
      portfolio_id: "p",
      batch_id: "b",
      error_message: null,
    }
    const result = parseImportResult(data)
    expect(result.portfolioId).toBe("p")
    expect(result.rowsImported).toBe(10)
  })

  test("missing rows_imported falls back to 0", () => {
    const data = [{ success: true, portfolio_id: "p", batch_id: "b" }]
    const result = parseImportResult(data)
    expect(result.rowsImported).toBe(0)
    expect(result.rowsTotal).toBe(0)
  })

  // ── Error path ────────────────────────────────────────────────────────────

  test("success=false → throws error_message verbatim", () => {
    const data = [
      {
        success: false,
        error_message: "Import failed: oversell detected",
        portfolio_id: null,
        batch_id: null,
        rows_imported: 0,
        rows_total: 5,
      },
    ]
    expect(() => parseImportResult(data)).toThrow(
      "Import failed: oversell detected"
    )
  })

  test("'CSV already imported' → French user message", () => {
    const data = [
      {
        success: false,
        error_message: "CSV already imported",
        portfolio_id: null,
        batch_id: null,
        rows_imported: 0,
        rows_total: 5,
      },
    ]
    expect(() => parseImportResult(data)).toThrow(
      "Ce fichier a déjà été importé."
    )
  })

  test("'Batch already imported' (import_csv_batch path) → French message", () => {
    const data = [
      {
        success: false,
        error_message: "Batch already imported",
        portfolio_id: null,
        batch_id: null,
        rows_imported: 0,
        rows_total: 0,
      },
    ]
    expect(() => parseImportResult(data)).toThrow(
      "Ce fichier a déjà été importé."
    )
  })

  test("success=false with no error_message → generic fallback", () => {
    const data = [{ success: false, error_message: null }]
    expect(() => parseImportResult(data)).toThrow("Import failed")
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  test("null data → throws 'no result'", () => {
    expect(() => parseImportResult(null)).toThrow("Import returned no result")
  })

  test("empty array → throws 'no result'", () => {
    expect(() => parseImportResult([])).toThrow("Import returned no result")
  })

  test("undefined data → throws 'no result'", () => {
    expect(() => parseImportResult(undefined)).toThrow(
      "Import returned no result"
    )
  })
})
