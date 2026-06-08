# 🌐 LOT 3: BROWSER E2E TEST PLAN

**Objective**: Execute real end-to-end import workflow in browser with actual CSV file  
**CSV File**: `from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv` (72,816 bytes, 480 events)  
**Duration**: ~10 minutes

---

## 🎯 TEST SCENARIO

### 1. PREPARE ENVIRONMENT

**Terminal 1: Start Supabase Local**
```bash
cd ~/path/to/nouveautracker
npx supabase start
# Wait for "supabase local development setup is running"
```

**Terminal 2: Start Next.js Dev Server**
```bash
cd ~/path/to/nouveautracker
npm run dev
# Wait for "✓ Ready in Xms"
```

**Browser: Open App**
```
http://localhost:3000/portfolios
```

---

## ✅ TEST 1: MANUAL PORTFOLIO CREATION

**Purpose**: Verify basic modal functionality  
**Expected**: Can create portfolio manually

### Steps
1. Click **"Add Portfolio"** button
2. Modal opens with choice screen:
   - [ ] "Create Manually" button visible
   - [ ] "Import CSV (Trading 212)" button visible
3. Click **"Create Manually"**
4. Enter portfolio name: `Test Manual`
5. Enter description: `E2E Test Manual Portfolio`
6. Select color: Blue (#3b82f6)
7. Click **"Create"**
8. Modal closes
9. Portfolio appears in list

**Evidence**: Take screenshot of portfolio created

---

## ✅ TEST 2: CSV FILE SELECTION

**Purpose**: Verify file selection and parsing  
**Expected**: Can select CSV file and see analysis

### Steps
1. Click **"Add Portfolio"**
2. Click **"Import CSV (Trading 212)"**
3. File selection appears
4. Click **"Select File"** / browse button
5. Navigate to: `~/Downloads/from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv`
6. Select file
7. Click **"Next"** / **"Analyze"**

**Verification**:
- [ ] File name appears: `from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv`
- [ ] File size shown: 72,816 bytes
- [ ] Parser completes (no error)

**Evidence**: Take screenshot of file selected

---

## ✅ TEST 3: CSV ANALYSIS SCREEN

**Purpose**: Verify all statistics displayed correctly  
**Expected**: Detailed analysis with 480 events, no fake data

### Steps
1. From previous step, analysis screen should display
2. Verify ALL fields:

**Expected Display**:
```
CSV Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File: from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv
Size: 72,816 bytes

CSV Content:
├─ CSV Lines: 481
├─ Logical Events: 480
├─ Operation Types:
│  ├─ buy: 332
│  ├─ deposit: 28
│  ├─ dividend: 19
│  ├─ dividend_adjustment: 1
│  ├─ dividend_tax_exempted: 1
│  ├─ fx_conversion: 5
│  ├─ interest: 54
│  ├─ sell: 37
│  ├─ stock_split: 1
│  └─ withdrawal: 2

Period: 2025-07-05 to 2026-06-07 (335 days)

Currencies: CHF, EUR, GBP, USD, etc.

Assets: ~48 unique stocks
├─ AAPL, MSFT, GOOGL, AMZN, NVDA, ...

Stock Splits: 1 split detected
└─ 1 corporate action
```

**Verification Checklist**:
- [x] CSV lines: exactly 481
- [x] Logical events: exactly 480
- [x] buy operations: 332
- [x] deposit operations: 28
- [x] dividend + dividend_adjustment + dividend_tax_exempted: 21
- [x] interest: 54
- [x] sell: 37
- [x] withdrawal: 2
- [x] fx_conversion: 5
- [x] stock_split: 1
- [x] Date range correct: 2025-07-05 to 2026-06-07
- [x] Multiple currencies detected
- [x] Asset list populated
- [x] Stock split count: 1

**Critical Check**: No hardcoded values:
- All numbers must come from parsed CSV
- No fake "480 events" constant
- No arbitrary progress percentages

**Evidence**: Take screenshot showing analysis details

---

## ✅ TEST 4: CONFIRMATION SCREEN

**Purpose**: Verify summary before import  
**Expected**: Shows portfolio name, event count, confirmation button

### Steps
1. From analysis screen, click **"Confirm"** or **"Next"**
2. Confirmation screen should show:
   - Portfolio name input (default or user-provided)
   - Summary of events: "480 events to import"
   - Checksum displayed (SHA-256)
   - Import button: **"Import"** or **"Confirm Import"**
3. Verify portfolio name is editable
4. Click **"Confirm Import"**

**Verification**:
- [ ] Summary shows 480 events (NOT fake percentage)
- [ ] Checksum displayed
- [ ] Portfolio name can be edited
- [ ] Cancel button available

**Evidence**: Take screenshot of confirmation screen

---

## ✅ TEST 5: IMPORT PROGRESS (INDETERMINATE)

**Purpose**: Verify honest progress UI  
**Expected**: Shimmer animation (NOT fake percentages)

### Steps
1. Click **"Confirm Import"**
2. Progress screen appears
3. Observe animation

**Verification**:
- [ ] Shows shimmer/skeleton loading animation
- [ ] NO percentage displayed (10%, 25%, 50%, 100%)
- [ ] NO fake progress bar with arbitrary values
- [ ] Status message: "Importing..." or "Creating portfolio..."

**Critical**: If ANY percentage is shown, this is WRONG.  
Progress is indeterminate because RPC is single atomic call.

**Evidence**: Take screenshot of progress screen

---

## ✅ TEST 6: IMPORT COMPLETE SCREEN

**Purpose**: Verify successful completion  
**Expected**: Portfolio created with all 480 events imported

### Steps
1. Wait for import to complete (~3-5 seconds)
2. Complete screen should display:
   - ✅ Success message: "Import completed successfully"
   - Portfolio ID
   - Batch ID
   - Rows imported: 480/480
   - Link to portfolio or "View Portfolio" button
3. Click **"View Portfolio"** or **"Done"**

**Verification**:
- [ ] Success message displayed
- [ ] Rows imported: 480/480 (NOT "479/480" or partial)
- [ ] No errors
- [ ] Portfolio page loads

**Evidence**: Take screenshot of complete screen

---

## ✅ TEST 7: PORTFOLIO VIEW WITH DATA

**Purpose**: Verify portfolio has all imported positions  
**Expected**: 48+ assets with holdings, prices, quantities

### Steps
1. From complete screen or list, open portfolio
2. Portfolio page shows:
   - Portfolio name
   - Currency: CHF
   - Holdings list

**Verification - Holdings**:
- [ ] Asset count: ~48 stocks (AAPL, MSFT, GOOGL, etc.)
- [ ] For each asset visible:
  - [ ] Ticker symbol
  - [ ] Quantity (number of shares)
  - [ ] Average buy price
  - [ ] Cost basis (in CHF)
  - [ ] Current value
- [ ] Total portfolio value calculated

**Verification - Transactions**:
- [ ] Transaction history tab (if available)
- [ ] Shows 480 transactions total
- [ ] Mix of buy, sell, dividend, interest, etc.

**Verification - Cash**:
- [ ] Cash balance (from deposits/withdrawals/interest)
- [ ] CHF balance shown

**Evidence**: Take screenshots of:
1. Portfolio overview
2. Holdings list
3. Portfolio statistics

---

## ✅ TEST 8: DATABASE VERIFICATION

**Purpose**: Verify atomic transaction persisted all data  
**Expected**: All tables contain correct data

### Steps
1. Open Supabase Studio: `http://127.0.0.1:54323`
2. Navigate to SQL Editor
3. Run verification queries

**Query 1: Portfolios**
```sql
SELECT id, name, currency, user_id, created_at 
FROM portfolios 
ORDER BY created_at DESC 
LIMIT 1;

Expected Result:
├─ 1 row (the newly created portfolio)
├─ name: matches portfolio created in test
├─ currency: CHF
└─ created_at: recent timestamp
```

**Query 2: Assets**
```sql
SELECT COUNT(*), portfolio_id 
FROM assets 
WHERE portfolio_id = '[portfolio_id_from_test]'
GROUP BY portfolio_id;

Expected Result:
├─ COUNT: 48 (approximately, depends on CSV unique stocks)
```

**Query 3: Transactions**
```sql
SELECT COUNT(*), type, COUNT(DISTINCT type) as type_count
FROM transactions 
WHERE portfolio_id = '[portfolio_id_from_test]'
GROUP BY portfolio_id, type;

Expected Result:
├─ Total COUNT: 480
├─ Types: buy (332), sell (37), dividend (19), interest (54), etc.
```

**Query 4: Cash Movements**
```sql
SELECT COUNT(*), type
FROM cash_movements 
WHERE portfolio_id = '[portfolio_id_from_test]'
GROUP BY type;

Expected Result:
├─ Total COUNT: 480+ (one per transaction)
├─ Types: buy, sell, dividend, interest, fx_conversion, etc.
```

**Query 5: Stock Split Events**
```sql
SELECT COUNT(*)
FROM stock_split_events 
WHERE portfolio_id = '[portfolio_id_from_test]';

Expected Result:
├─ COUNT: 1 (exactly one stock split in CSV)
```

**Query 6: Import Batch**
```sql
SELECT id, rows_imported, rows_total, status, file_checksum
FROM import_batches 
WHERE portfolio_id = '[portfolio_id_from_test]'
LIMIT 1;

Expected Result:
├─ rows_imported: 480
├─ rows_total: 480
├─ status: 'success'
├─ file_checksum: 0a7990efed176d8f83f1c19859d1a94728a6d1f2723b2b8a5667a3014bcf8501
```

**Evidence**: Screenshots of database verification

---

## ✅ TEST 9: IDEMPOTENCE TEST

**Purpose**: Verify re-importing same CSV produces no changes  
**Expected**: Duplicate detected, no new data created

### Steps
1. Go back to Add Portfolio
2. Click **"Import CSV"** again
3. Upload SAME file: `from_2025-07-05_to_2026-06-07_MTc4MDg0ODQxMDA0Nw.csv`
4. Analysis should complete
5. Click **"Confirm Import"**

**Verification**:
- [ ] RPC recognizes duplicate (same file_checksum)
- [ ] One of these occurs:
  - Option A: Error message: "Duplicate import detected"
  - Option B: Success but with flag: `duplicate_import: true`
  - Option C: Same batch_id returned (no new batch created)

**Database Check**:
```sql
SELECT COUNT(DISTINCT id) as unique_batches
FROM import_batches 
WHERE portfolio_id = '[portfolio_id_from_test]';

Expected: 1 (only one batch, despite two import attempts)
```

**Evidence**: 
- Screenshot showing duplicate detection
- Database query result

---

## ✅ TEST 10: ERROR HANDLING

**Purpose**: Verify robustness when CSV is invalid  
**Expected**: Error displayed, no portfolio created

### Steps
1. Create invalid CSV file: `test-invalid.csv`
   ```
   Action,Time,ISIN
   Invalid,2026-01-01,XX
   ```
2. Click **"Import CSV"**
3. Select invalid file
4. Try to analyze/import
5. Expected: Error message displayed

**Verification**:
- [ ] Parser rejects invalid CSV
- [ ] Error message shown to user
- [ ] Modal can be closed/retried
- [ ] No portfolio created in database

**Database Check**:
```sql
SELECT COUNT(*)
FROM portfolios 
WHERE status = 'draft' OR created_at > NOW() - INTERVAL '1 minute';

Expected: 0 (no incomplete portfolios from failed import)
```

**Evidence**: Screenshot of error handling

---

## 📊 SUMMARY OF EVIDENCE

Collect the following for final report:

1. **Screenshot: Add Portfolio Modal** (choice between manual and CSV)
2. **Screenshot: File Selection** (with filename displayed)
3. **Screenshot: Analysis Screen** (all 480 events, statistics, currencies, assets)
4. **Screenshot: Confirmation Screen** (summary, checksum, portfolio name)
5. **Screenshot: Progress Screen** (indeterminate shimmer, NOT fake %)
6. **Screenshot: Complete Screen** (480/480 success)
7. **Screenshot: Portfolio View** (holdings, assets, transactions)
8. **Database Screenshots**:
   - Portfolios table (1 new row)
   - Assets count (48)
   - Transactions count (480)
   - Import batches status ('success')
   - Stock split events count (1)
9. **Screenshot: Idempotence Check** (duplicate detected)
10. **Screenshot: Error Handling** (invalid CSV rejected)

---

## 🎬 FINAL CHECKLIST

### Functionality
- [ ] Modal workflow complete (choice → select → analyze → confirm → progress → complete)
- [ ] Analysis shows exactly 480 events
- [ ] No fake progress percentages (shimmer only)
- [ ] Portfolio created successfully
- [ ] All 480 transactions imported
- [ ] Idempotence works (duplicate detected)
- [ ] Error handling works (invalid CSV rejected)

### Database
- [ ] 1 portfolio created
- [ ] ~48 assets created
- [ ] 480 transactions created
- [ ] 1 stock split event created
- [ ] import_batches.status = 'success'
- [ ] import_batches.rows_imported = 480
- [ ] All data persisted atomically

### Code Quality
- [ ] No console errors
- [ ] No TypeScript errors during build
- [ ] Modal responsive (desktop view)
- [ ] Animations smooth
- [ ] No memory leaks

### Atomicity
- [ ] No orphaned empty portfolios
- [ ] All-or-nothing transaction enforced
- [ ] Duplicate imports prevented

---

## ✅ SUCCESS CRITERIA

**Test PASSES if ALL of the following are true**:

1. ✅ CSV file parsed: 480 events extracted
2. ✅ Analysis screen shows correct statistics (CSV lines, events, types, dates, currencies, assets)
3. ✅ Progress bar is indeterminate (shimmer), NOT fake percentages
4. ✅ Portfolio created with all 480 transactions
5. ✅ Database state correct:
   - 1 portfolio
   - ~48 assets
   - 480 transactions
   - 1 stock split
   - import_batches.status = 'success'
6. ✅ Idempotence works (re-import detected as duplicate)
7. ✅ Error handling works (invalid CSV rejected)
8. ✅ No empty/orphaned portfolios (atomic guarantee verified)

---

**Test Date**: 2026-06-09  
**Expected Duration**: ~10 minutes  
**Tester**: [Your name]  
**Status**: Ready for execution ✅
