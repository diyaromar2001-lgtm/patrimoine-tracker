import { describe, test, expect } from "vitest"
import { parseCSVRecord, parseCSVLine, parseCSVLines } from "./trading212-parser-shared"

// ---------------------------------------------------------------------------
// parseCSVRecord — RFC 4180 tokeniser
// ---------------------------------------------------------------------------

describe("parseCSVRecord", () => {
  test("simple unquoted fields", () => {
    expect(parseCSVRecord("Market buy,2026-01-01,US123,ROP,Roper,0.1,337.6")).toEqual([
      "Market buy", "2026-01-01", "US123", "ROP", "Roper", "0.1", "337.6",
    ])
  })

  test("quoted field containing a comma — Roper Technologies, Inc.", () => {
    expect(parseCSVRecord('Market buy,2026-01-01,US7766961061,ROP,"Roper Technologies, Inc.",0.0284624,337.6')).toEqual([
      "Market buy", "2026-01-01", "US7766961061", "ROP",
      "Roper Technologies, Inc.",   // comma inside quotes must be preserved
      "0.0284624", "337.6",
    ])
  })

  test("escaped double-quotes inside a quoted field", () => {
    // RFC 4180: "" inside quotes → literal "
    expect(parseCSVRecord('"She said ""hello""",next')).toEqual([
      'She said "hello"',
      "next",
    ])
  })

  test("empty fields (adjacent commas)", () => {
    expect(parseCSVRecord("a,,c")).toEqual(["a", "", "c"])
  })

  test("trailing comma produces empty last field", () => {
    expect(parseCSVRecord("a,b,")).toEqual(["a", "b", ""])
  })

  test("quoted empty field", () => {
    expect(parseCSVRecord('a,"",c')).toEqual(["a", "", "c"])
  })

  test("whitespace in unquoted field is trimmed", () => {
    expect(parseCSVRecord("  hello ,  world  ")).toEqual(["hello", "world"])
  })

  test("whitespace inside quoted field is preserved", () => {
    expect(parseCSVRecord('" hello "," world "')).toEqual([" hello ", " world "])
  })

  test("CRLF stripped before tokenising (caller responsibility)", () => {
    // Simulate line already stripped of \r by parseCSVLines
    const line = "Market buy,2026-01-01,,,test"
    expect(parseCSVRecord(line)[4]).toBe("test")
  })
})

// ---------------------------------------------------------------------------
// parseCSVLine — maps tokens to T212 header keys
// ---------------------------------------------------------------------------

describe("parseCSVLine", () => {
  test("ROP row: ticker, name with comma, quantity, price are all correct", () => {
    const row =
      'Market buy,2026-01-01 10:00:00,US7766961061,ROP,"Roper Technologies, Inc.",,ID123,0.0284624,337.6,USD,1,,,,,,,,,,,,,'
    const raw = parseCSVLine(row)
    expect(raw["Action"]).toBe("Market buy")
    expect(raw["Ticker"]).toBe("ROP")
    expect(raw["Name"]).toBe("Roper Technologies, Inc.")
    expect(raw["No. of shares"]).toBe("0.0284624")
    expect(raw["Price / share"]).toBe("337.6")
  })

  test("plain name without comma (e.g. Apple Inc) parses correctly", () => {
    const row =
      "Market buy,2026-01-01 10:00:00,US0378331005,AAPL,Apple Inc,,ID456,1,150,USD,1,,,,,,,,,,,,,"
    const raw = parseCSVLine(row)
    expect(raw["Ticker"]).toBe("AAPL")
    expect(raw["Name"]).toBe("Apple Inc")
    expect(raw["No. of shares"]).toBe("1")
  })
})

// ---------------------------------------------------------------------------
// parseCSVLines — full-file parse
// ---------------------------------------------------------------------------

describe("parseCSVLines", () => {
  const HEADER =
    "Action,Time,ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share," +
    "Currency (Price / share),Exchange rate,Result,Currency (Result),Total," +
    "Currency (Total),Withholding tax,Currency (Withholding tax)," +
    "Currency conversion from amount,Currency (Currency conversion from amount)," +
    "Currency conversion to amount,Currency (Currency conversion to amount)," +
    "Currency conversion fee,Currency (Currency conversion fee)"

  test("ROP row: exact values required by spec", () => {
    const csv =
      HEADER + "\n" +
      'Market buy,2026-01-01,US7766961061,ROP,"Roper Technologies, Inc.",,,0.0284624,337.6,USD,1,,,,,,,,,,,,,'

    const { operations } = parseCSVLines(csv)
    expect(operations).toHaveLength(1)
    const op = operations[0]
    expect(op.ticker).toBe("ROP")
    expect(op.name).toBe("Roper Technologies, Inc.")
    expect(op.quantity).toBeCloseTo(0.0284624, 7)
    expect(op.price).toBeCloseTo(337.6, 2)
  })

  test("CRLF line endings parse identically to LF", () => {
    const csv =
      HEADER + "\r\n" +
      'Market buy,2026-01-01,US7766961061,ROP,"Roper Technologies, Inc.",,,0.0284624,337.6,USD,1,,,,,,,,,,,,,\r\n'

    const { operations } = parseCSVLines(csv)
    expect(operations).toHaveLength(1)
    expect(operations[0].name).toBe("Roper Technologies, Inc.")
  })

  test("blank lines in CSV are ignored", () => {
    const csv = HEADER + "\n\n" +
      'Market buy,2026-01-01,US7766961061,ROP,"Roper Technologies, Inc.",,,0.0284624,337.6,USD,1,,,,,,,,,,,,,' +
      "\n\n"

    const { operations } = parseCSVLines(csv)
    expect(operations).toHaveLength(1)
  })

  test("plain name (Apple) still works after CSV fix", () => {
    const csv =
      HEADER + "\n" +
      "Market buy,2026-01-01,US0378331005,AAPL,Apple Inc,,,1,150,USD,1,,,,,,,,,,,,,"

    const { operations } = parseCSVLines(csv)
    expect(operations[0].ticker).toBe("AAPL")
    expect(operations[0].name).toBe("Apple Inc")
  })
})
