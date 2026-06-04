# Graph Report - .  (2026-06-04)

## Corpus Check
- 91 files · ~59,697 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 526 nodes · 968 edges · 27 communities (15 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Finance Calculation Engine|Finance Calculation Engine]]
- [[_COMMUNITY_App State & Data Layer|App State & Data Layer]]
- [[_COMMUNITY_Asset Search & Portfolio Metrics|Asset Search & Portfolio Metrics]]
- [[_COMMUNITY_Chart API & Benchmark|Chart API & Benchmark]]
- [[_COMMUNITY_Chart Components|Chart Components]]
- [[_COMMUNITY_Dependencies & Config|Dependencies & Config]]
- [[_COMMUNITY_Graphify  Agent Skills|Graphify / Agent Skills]]
- [[_COMMUNITY_Dashboard Layout & Shell|Dashboard Layout & Shell]]
- [[_COMMUNITY_Root Layout & Currency|Root Layout & Currency]]
- [[_COMMUNITY_DCA & Dividends Pages|DCA & Dividends Pages]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Component Registry|Component Registry]]
- [[_COMMUNITY_Next.js Branding|Next.js Branding]]
- [[_COMMUNITY_Supabase Auth Callback|Supabase Auth Callback]]
- [[_COMMUNITY_Middleware & Auth|Middleware & Auth]]
- [[_COMMUNITY_Transactions Page|Transactions Page]]
- [[_COMMUNITY_Portfolio Page|Portfolio Page]]
- [[_COMMUNITY_Revenus Page|Revenus Page]]
- [[_COMMUNITY_Watchlist Page|Watchlist Page]]
- [[_COMMUNITY_Settings Page|Settings Page]]
- [[_COMMUNITY_SQL Migrations|SQL Migrations]]
- [[_COMMUNITY_Transaction Modal|Transaction Modal]]
- [[_COMMUNITY_PnL Module|PnL Module]]
- [[_COMMUNITY_Supabase Queries|Supabase Queries]]
- [[_COMMUNITY_Types & Utilities|Types & Utilities]]

## God Nodes (most connected - your core abstractions)
1. `useCurrency()` - 29 edges
2. `cacheFetch()` - 18 edges
3. `cn()` - 16 edges
4. `compilerOptions` - 16 edges
5. `AppCurrency` - 14 edges
6. `useAppData()` - 13 edges
7. `Topbar()` - 10 edges
8. `generateInsights()` - 10 edges
9. `formatCurrency()` - 10 edges
10. `Graphify Skill Definition` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Next.js Portfolio Tracker Project` --references--> `Next.js Wordmark Logo SVG`  [INFERRED]
  README.md → public/next.svg
- `Vercel Deployment Platform` --references--> `Vercel Triangle Logo SVG`  [INFERRED]
  README.md → public/vercel.svg
- `DCACalculatorPage()` --calls--> `formatCurrency()`  [EXTRACTED]
  app/(dashboard)/dca-calculator/page.tsx → lib/utils.ts
- `SettingsPage()` --calls--> `useCurrency()`  [EXTRACTED]
  app/(dashboard)/settings/page.tsx → hooks/use-currency.tsx
- `Graphify Skill Entry Point` --references--> `Graphify CLAUDE.md Integration`  [INFERRED]
  .claude/CLAUDE.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphify Core Output Files** — graphify_graph_json, graphify_graph_report, graphify_god_nodes, graphify_community_detection [INFERRED 0.85]
- **Graphify Reference Documentation Set** — graphify_extraction_spec, graphify_query_ref, graphify_update_ref, graphify_add_watch_ref, graphify_exports_ref, graphify_github_merge_ref, graphify_hooks_ref, graphify_transcribe_ref [EXTRACTED 1.00]

## Communities (27 total, 12 thin omitted)

### Community 0 - "Finance Calculation Engine"
Cohesion: 0.06
Nodes (56): amountToChf(), annualDividendPerShare(), assetCurrentValue(), AssetInput, assetLatentPnL(), assetLatentPnLPct(), benchmarkAlpha(), cagr() (+48 more)

### Community 1 - "App State & Data Layer"
Cohesion: 0.07
Nodes (47): AppData, AppDataContext, DEFAULT, RealizedPnLEvent, MOCK_DIVIDENDS, MOCK_PORTFOLIOS, MOCK_TRANSACTIONS, MOCK_WATCHLIST (+39 more)

### Community 2 - "Asset Search & Portfolio Metrics"
Cohesion: 0.08
Nodes (39): SearchResult, useAssetSearch(), GlobalSearch(), GlobalSearchProps, QUICK_LINKS, PortfolioMetrics, ASSET_CLASS_COLORS, ASSET_CLASS_LABELS (+31 more)

### Community 3 - "Chart API & Benchmark"
Cohesion: 0.06
Nodes (33): ChartPoint, fetchChartData(), GET(), normalize(), PERIOD_CFG, today(), yf, DividendInfo (+25 more)

### Community 4 - "Chart Components"
Cohesion: 0.06
Nodes (38): AreaChart(), AreaChartProps, ChartPoint, COMPARE_COLORS, CompareMode, ComparisonSeries, LiveChart(), LiveChartData (+30 more)

### Community 5 - "Dependencies & Config"
Cohesion: 0.05
Nodes (42): dependencies, class-variance-authority, clsx, framer-motion, lightweight-charts, lucide-react, next, @radix-ui/react-avatar (+34 more)

### Community 6 - "Graphify / Agent Skills"
Cohesion: 0.06
Nodes (41): Next.js Agent Rules, Next.js Breaking Changes Warning, Graphify Skill Entry Point, Graphify CLAUDE.md Integration, Knowledge Graph at graphify-out/, graphify add URL Command, Add URL and Watch Reference, AST Structural Extraction (Part A) (+33 more)

### Community 7 - "Dashboard Layout & Shell"
Cohesion: 0.06
Nodes (14): AppDataProvider(), DashboardShell(), MobileNav(), MORE_ITEMS, PRIMARY_ITEMS, BOTTOM, NAV_SECTIONS, Sidebar() (+6 more)

### Community 8 - "Root Layout & Currency"
Cohesion: 0.10
Nodes (19): inter, metadata, CurrencyContext, CurrencyContextValue, CurrencyProvider(), LivePrice, RawPrice, UsePortfolioHistoryResult (+11 more)

### Community 9 - "DCA & Dividends Pages"
Cohesion: 0.10
Nodes (19): DCACalculatorPage(), DAYS_FR, daysInMonth(), DividendsPage(), firstDow(), FREQ_LABEL, MONTHS_FR, MarketState (+11 more)

### Community 10 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 11 - "Component Registry"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 12 - "Next.js Branding"
Cohesion: 0.29
Nodes (7): Next.js Wordmark Logo SVG, Vercel Triangle Logo SVG, create-next-app Bootstrap Tool, Geist Font Family, next/font Optimization, Next.js Portfolio Tracker Project, Vercel Deployment Platform

## Knowledge Gaps
- **206 isolated node(s):** `PreToolUse`, `QuoteData`, `MONTHS_FR`, `DAYS_FR`, `FREQ_LABEL` (+201 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cacheFetch()` connect `Chart API & Benchmark` to `Root Layout & Currency`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `AppCurrency` connect `Root Layout & Currency` to `Finance Calculation Engine`, `App State & Data Layer`, `Asset Search & Portfolio Metrics`, `Chart API & Benchmark`, `Chart Components`, `DCA & Dividends Pages`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `useCurrency()` connect `Chart Components` to `App State & Data Layer`, `Asset Search & Portfolio Metrics`, `Dashboard Layout & Shell`, `Root Layout & Currency`, `DCA & Dividends Pages`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `PreToolUse`, `QuoteData`, `MONTHS_FR` to the rest of the system?**
  _208 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Finance Calculation Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.05827505827505827 - nodes in this community are weakly interconnected._
- **Should `App State & Data Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.06721215663354763 - nodes in this community are weakly interconnected._
- **Should `Asset Search & Portfolio Metrics` be split into smaller, more focused modules?**
  _Cohesion score 0.07510204081632653 - nodes in this community are weakly interconnected._