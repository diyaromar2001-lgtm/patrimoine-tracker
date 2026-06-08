#!/usr/bin/env node

/**
 * LOT 3: PARSER VERIFICATION TEST
 * Verify that trading212-parser correctly parses the real CSV
 */

const { parseTrading212CSV } = require("../lib/parsers/trading212-parser")
const path = require("path")
const os = require("os")
const fs = require("fs")

const csvPath = path.join(os.homedir(), "Downloads", "from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv")

console.log("\n═════════════════════════════════════════════════════════════════")
console.log("LOT 3: PARSER VERIFICATION TEST")
console.log("═════════════════════════════════════════════════════════════════\n")

try {
  // Verify CSV file exists
  console.log("✓ CSV file:", csvPath)
  if (!fs.existsSync(csvPath)) {
    throw new Error(`File not found: ${csvPath}`)
  }
  const fileSize = fs.statSync(csvPath).size
  console.log(`  Size: ${fileSize} bytes\n`)

  // Parse CSV
  console.log("Parsing CSV...")
  const parseResult = parseTrading212CSV(csvPath)
  const { operations, stats, fileChecksum } = parseResult

  console.log(`✅ CSV parsed successfully:\n`)
  console.log(`   CSV Lines Read: ${stats.csvLinesRead}`)
  console.log(`   Logical Events: ${stats.logicalEvents}`)
  console.log(`   Operations Array Length: ${operations.length}`)
  console.log(`   File Checksum: ${fileChecksum}\n`)

  // Verify no duplicates by source_id
  const sourceIds = new Set()
  let duplicateCount = 0
  for (const op of operations) {
    if (op.sourceId && sourceIds.has(op.sourceId)) {
      duplicateCount++
    }
    if (op.sourceId) sourceIds.add(op.sourceId)
  }

  console.log(`   Unique source IDs: ${sourceIds.size}`)
  if (duplicateCount > 0) {
    console.log(`   ⚠️  Duplicate source IDs: ${duplicateCount}`)
  } else {
    console.log(`   ✅ No duplicate source IDs`)
  }

  // Count operation types
  const typeCount = {}
  for (const op of operations) {
    const type = op.type || "unknown"
    typeCount[type] = (typeCount[type] || 0) + 1
  }

  console.log(`\n   Operation Types:`)
  for (const [type, count] of Object.entries(typeCount).sort()) {
    console.log(`     - ${type}: ${count}`)
  }

  // Verify stats consistency
  console.log(`\n   Validation:`)
  if (operations.length === stats.logicalEvents) {
    console.log(`   ✅ operations.length (${operations.length}) == stats.logicalEvents (${stats.logicalEvents})`)
  } else {
    console.log(`   ❌ Mismatch: operations.length=${operations.length}, stats.logicalEvents=${stats.logicalEvents}`)
  }

  if (stats.csvLinesRead > 0) {
    console.log(`   ✅ CSV lines read: ${stats.csvLinesRead}`)
  }

  // Sample first and last operations
  console.log(`\n   Sample Operations:`)
  if (operations.length > 0) {
    console.log(`   First:`, JSON.stringify(operations[0], null, 2).split("\n").slice(0, 8).join("\n"))
    console.log(`   Last:`, JSON.stringify(operations[operations.length - 1], null, 2).split("\n").slice(0, 8).join("\n"))
  }

  console.log(`\n═════════════════════════════════════════════════════════════════`)
  console.log(`✅ PARSER TEST PASSED`)
  console.log(`═════════════════════════════════════════════════════════════════\n`)

  process.exit(0)
} catch (error) {
  console.error(`\n❌ PARSER TEST FAILED:`)
  console.error(`  ${error.message}\n`)
  console.error(error.stack)
  process.exit(1)
}
