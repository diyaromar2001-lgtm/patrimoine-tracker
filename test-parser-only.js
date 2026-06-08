const { parseTrading212CSV, generateParserReport } = require('./lib/parsers/trading212-parser');

const csvPath = 'C:\Users\omard\Downloads\from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv';

try {
  const result = parseTrading212CSV(csvPath);
  console.log(generateParserReport(csvPath, result));
  console.log('\nOperations by type:');
  const byType = {};
  result.operations.forEach(op => {
    byType[op.type] = (byType[op.type] || 0) + 1;
  });
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
} catch (e) {
  console.error('Parser error:', e.message);
  process.exit(1);
}
