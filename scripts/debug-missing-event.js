#!/usr/bin/env node

/**
 * DEBUG: Find which exact event is missing (479/480)
 */

const { parseTrading212CSV } = require('../lib/parsers/trading212-parser');
const path = require('path');
const os = require('os');

const csvPath = path.join(os.homedir(), 'Downloads', 'from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv');

const parseResult = parseTrading212CSV(csvPath);
const events = parseResult.operations;

// Find dividend_tax_exempted event
const divTaxExempted = events.find(e => e.type === 'dividend_tax_exempted');
console.log('Found dividend_tax_exempted event:');
console.log(`  Index: ${events.indexOf(divTaxExempted)}`);
console.log(`  Source ID: ${divTaxExempted.sourceId}`);
console.log(`  Type: ${divTaxExempted.type}`);
console.log(`  Ticker: ${divTaxExempted.ticker}`);
console.log(`  ISIN: ${divTaxExempted.isin}`);
console.log(`  Date: ${divTaxExempted.date}`);
console.log(`  Amount: ${divTaxExempted.totalAmount} ${divTaxExempted.totalCurrency}`);
console.log(`  Withholding: ${divTaxExempted.withholdingTax}`);

// Find UBSG buy events
const ubsgBuys = events.filter(e => e.ticker === 'UBSG' && e.type === 'buy');
console.log(`\nUBSG BUY events: ${ubsgBuys.length}`);
ubsgBuys.forEach(b => {
  console.log(`  [${events.indexOf(b)}] ${b.date} @ ${b.price} ${b.priceCurrency}`);
});

// Find all UBSG dividend events (including the tax exempted)
const ubsgDividends = events.filter(e => e.ticker === 'UBSG' && (e.type.includes('dividend')));
console.log(`\nUBSG DIVIDEND events: ${ubsgDividends.length}`);
ubsgDividends.forEach(d => {
  console.log(`  [${events.indexOf(d)}] ${d.date} ${d.type}`);
});

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('HYPOTHESIS:\n');
console.log('The dividend_tax_exempted for UBSG might be missing because:');
console.log('1. It has the same source_external_id as dividend (conflict)');
console.log('2. Asset transaction doesn\'t exist when processing it');
console.log('3. ON CONFLICT DO NOTHING silently skips duplicate');
console.log('\nLet\'s check if both dividend events have different source IDs:\n');

const ubsgDivRegular = events.find(e => e.ticker === 'UBSG' && e.type === 'dividend');
const ubsgDivTaxEx = events.find(e => e.ticker === 'UBSG' && e.type === 'dividend_tax_exempted');

console.log(`Regular dividend source_external_id: ${ubsgDivRegular.sourceId}`);
console.log(`Tax exempted source_external_id: ${ubsgDivTaxEx.sourceId}`);

if (ubsgDivRegular.sourceId === ubsgDivTaxEx.sourceId) {
  console.log('\n❌ PROBLEM: Both events have the SAME source_external_id!');
  console.log('This causes the second one to be skipped by ON CONFLICT DO NOTHING.');
} else {
  console.log('\n✅ Source IDs are different, so conflict is not the issue.');
}
