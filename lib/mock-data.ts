import type {
  Portfolio,
  Transaction,
  DividendEvent,
  WatchlistItem,
  PortfolioSnapshot,
} from "./types"

// ─── Portfolios ───────────────────────────────────────────────────────────────

export const MOCK_PORTFOLIOS: Portfolio[] = [
  {
    id: "p1",
    name: "Actions & ETF",
    description: "Portefeuille long terme d'actions et ETF",
    color: "#3b82f6",
    currency: "CHF",
    createdAt: "2023-01-15",
    assets: [
      {
        id: "a1", portfolioId: "p1", ticker: "MSFT", name: "Microsoft",
        assetClass: "stock", quantity: 10, avgBuyPrice: 285, currentPrice: 385,
        currency: "USD", sector: "Technologie", country: "US",
      },
      {
        id: "a2", portfolioId: "p1", ticker: "AAPL", name: "Apple",
        assetClass: "stock", quantity: 15, avgBuyPrice: 148, currentPrice: 178,
        currency: "USD", sector: "Technologie", country: "US",
      },
      {
        id: "a3", portfolioId: "p1", ticker: "MC.PA", name: "LVMH",
        assetClass: "stock", quantity: 3, avgBuyPrice: 720, currentPrice: 680,
        currency: "CHF", sector: "Luxe", country: "FR",
      },
      {
        id: "a4", portfolioId: "p1", ticker: "CW8", name: "Lyxor MSCI World",
        assetClass: "etf", quantity: 8, avgBuyPrice: 380, currentPrice: 445,
        currency: "CHF", sector: "Monde", country: "FR",
      },
      {
        id: "a5", portfolioId: "p1", ticker: "ASML", name: "ASML Holding",
        assetClass: "stock", quantity: 4, avgBuyPrice: 580, currentPrice: 720,
        currency: "CHF", sector: "Semi-conducteurs", country: "NL",
      },
      {
        id: "a6", portfolioId: "p1", ticker: "SP500", name: "iShares S&P 500",
        assetClass: "etf", quantity: 12, avgBuyPrice: 430, currentPrice: 510,
        currency: "CHF", sector: "USA", country: "IE",
      },
    ],
  },
  {
    id: "p2",
    name: "Crypto",
    description: "Actifs numériques — long terme",
    color: "#a78bfa",
    currency: "CHF",
    createdAt: "2023-06-01",
    assets: [
      {
        id: "a7", portfolioId: "p2", ticker: "BTC", name: "Bitcoin",
        assetClass: "crypto", quantity: 0.5, avgBuyPrice: 22500, currentPrice: 52619,  // BTC CHF (live)
        currency: "CHF", sector: "L1", country: "—",
      },
      {
        id: "a8", portfolioId: "p2", ticker: "ETH", name: "Ethereum",
        assetClass: "crypto", quantity: 3, avgBuyPrice: 1400, currentPrice: 1491,   // ETH CHF (live)
        currency: "CHF", sector: "L1", country: "—",
      },
      {
        id: "a9", portfolioId: "p2", ticker: "SOL", name: "Solana",
        assetClass: "crypto", quantity: 20, avgBuyPrice: 80, currentPrice: 58,     // SOL CHF (live)
        currency: "CHF", sector: "L1", country: "—",
      },
    ],
  },
]

// ─── Net-worth history (12 months) ───────────────────────────────────────────

export const PORTFOLIO_HISTORY: PortfolioSnapshot[] = [
  { date: "2025-06-01", value: 41200 },
  { date: "2025-07-01", value: 43800 },
  { date: "2025-08-01", value: 42100 },
  { date: "2025-09-01", value: 45600 },
  { date: "2025-10-01", value: 47300 },
  { date: "2025-11-01", value: 46100 },
  { date: "2025-12-01", value: 49800 },
  { date: "2026-01-01", value: 52400 },
  { date: "2026-02-01", value: 51200 },
  { date: "2026-03-01", value: 54900 },
  { date: "2026-04-01", value: 57100 },
  { date: "2026-05-01", value: 59200 },
  { date: "2026-06-01", value: 61480 },
]

// ─── Transactions ─────────────────────────────────────────────────────────────

export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: "t1", portfolioId: "p1", assetId: "a1", ticker: "MSFT", assetName: "Microsoft", assetClass: "stock", type: "buy", quantity: 5, price: 285, fees: 2.5, currency: "USD", date: "2023-03-10", notes: "Achat initial" },
  { id: "t2", portfolioId: "p1", assetId: "a2", ticker: "AAPL", assetName: "Apple", assetClass: "stock", type: "buy", quantity: 10, price: 145, fees: 2.5, currency: "USD", date: "2023-04-15" },
  { id: "t3", portfolioId: "p2", assetId: "a7", ticker: "BTC", assetName: "Bitcoin", assetClass: "crypto", type: "buy", quantity: 0.3, price: 27000, fees: 15, currency: "CHF", date: "2023-06-20" },
  { id: "t4", portfolioId: "p1", assetId: "a4", ticker: "CW8", assetName: "Lyxor MSCI World", assetClass: "etf", type: "buy", quantity: 4, price: 375, fees: 1.5, currency: "CHF", date: "2023-07-05" },
  { id: "t5", portfolioId: "p2", assetId: "a8", ticker: "ETH", assetName: "Ethereum", assetClass: "crypto", type: "buy", quantity: 2, price: 1650, fees: 8, currency: "CHF", date: "2023-08-12" },
  { id: "t6", portfolioId: "p1", assetId: "a1", ticker: "MSFT", assetName: "Microsoft", assetClass: "stock", type: "buy", quantity: 5, price: 310, fees: 2.5, currency: "USD", date: "2023-10-20" },
  { id: "t7", portfolioId: "p1", assetId: "a5", ticker: "ASML", assetName: "ASML Holding", assetClass: "stock", type: "buy", quantity: 4, price: 580, fees: 3, currency: "CHF", date: "2023-11-08" },
  { id: "t8", portfolioId: "p1", assetId: "a3", ticker: "MC.PA", assetName: "LVMH", assetClass: "stock", type: "buy", quantity: 3, price: 720, fees: 3, currency: "CHF", date: "2024-01-15" },
  { id: "t9", portfolioId: "p2", assetId: "a7", ticker: "BTC", assetName: "Bitcoin", assetClass: "crypto", type: "buy", quantity: 0.2, price: 42000, fees: 18, currency: "CHF", date: "2024-03-22" },
  { id: "t10", portfolioId: "p1", assetId: "a2", ticker: "AAPL", assetName: "Apple", assetClass: "stock", type: "buy", quantity: 5, price: 168, fees: 2.5, currency: "USD", date: "2024-05-14" },
  { id: "t11", portfolioId: "p1", assetId: "a6", ticker: "SP500", assetName: "iShares S&P 500", assetClass: "etf", type: "buy", quantity: 12, price: 430, fees: 1.5, currency: "CHF", date: "2024-06-10" },
  { id: "t12", portfolioId: "p2", assetId: "a9", ticker: "SOL", assetName: "Solana", assetClass: "crypto", type: "buy", quantity: 20, price: 95, fees: 5, currency: "CHF", date: "2024-09-18" },
  { id: "t13", portfolioId: "p1", assetId: "a4", ticker: "CW8", assetName: "Lyxor MSCI World", assetClass: "etf", type: "buy", quantity: 4, price: 412, fees: 1.5, currency: "CHF", date: "2025-01-10" },
  { id: "t14", portfolioId: "p2", assetId: "a8", ticker: "ETH", assetName: "Ethereum", assetClass: "crypto", type: "buy", quantity: 1, price: 2800, fees: 10, currency: "CHF", date: "2025-03-05" },
  { id: "t15", portfolioId: "p1", assetId: "a2", ticker: "AAPL", assetName: "Apple", assetClass: "stock", type: "dividend", quantity: 15, price: 0.25, fees: 0, currency: "USD", date: "2025-05-15", notes: "Dividende Q1 2025" },
  { id: "t16", portfolioId: "p1", assetId: "a1", ticker: "MSFT", assetName: "Microsoft", assetClass: "stock", type: "dividend", quantity: 10, price: 0.75, fees: 0, currency: "USD", date: "2025-06-01", notes: "Dividende Q2 2025" },
]

// ─── Dividends ────────────────────────────────────────────────────────────────

export const MOCK_DIVIDENDS: DividendEvent[] = [
  { id: "d1", ticker: "MSFT", assetName: "Microsoft", assetClass: "stock", exDate: "2026-05-15", payDate: "2026-06-12", amount: 7.50, frequency: "quarterly", currency: "CHF", status: "paid" },
  { id: "d2", ticker: "AAPL", assetName: "Apple", assetClass: "stock", exDate: "2026-05-10", payDate: "2026-06-05", amount: 3.75, frequency: "quarterly", currency: "CHF", status: "paid" },
  { id: "d3", ticker: "CW8", assetName: "Lyxor MSCI World", assetClass: "etf", exDate: "2026-06-15", payDate: "2026-07-10", amount: 12.40, frequency: "annual", currency: "CHF", status: "upcoming" },
  { id: "d4", ticker: "MSFT", assetName: "Microsoft", assetClass: "stock", exDate: "2026-08-15", payDate: "2026-09-12", amount: 7.50, frequency: "quarterly", currency: "CHF", status: "upcoming" },
  { id: "d5", ticker: "AAPL", assetName: "Apple", assetClass: "stock", exDate: "2026-08-10", payDate: "2026-09-05", amount: 3.75, frequency: "quarterly", currency: "CHF", status: "upcoming" },
  { id: "d6", ticker: "ASML", assetName: "ASML Holding", assetClass: "stock", exDate: "2026-07-28", payDate: "2026-08-15", amount: 18.60, frequency: "semi-annual", currency: "CHF", status: "upcoming" },
  { id: "d7", ticker: "SP500", assetName: "iShares S&P 500", assetClass: "etf", exDate: "2026-06-28", payDate: "2026-07-15", amount: 8.90, frequency: "quarterly", currency: "CHF", status: "upcoming" },
  { id: "d8", ticker: "MSFT", assetName: "Microsoft", assetClass: "stock", exDate: "2026-02-15", payDate: "2026-03-12", amount: 7.50, frequency: "quarterly", currency: "CHF", status: "paid" },
  { id: "d9", ticker: "AAPL", assetName: "Apple", assetClass: "stock", exDate: "2026-02-10", payDate: "2026-03-05", amount: 3.75, frequency: "quarterly", currency: "CHF", status: "paid" },
]

// ─── Watchlist ────────────────────────────────────────────────────────────────

const mkSparkline = (base: number, len = 14) => {
  const arr = [base]
  for (let i = 1; i < len; i++) {
    arr.push(arr[i - 1] * (1 + (Math.random() - 0.48) * 0.03))
  }
  return arr
}

export const MOCK_WATCHLIST: WatchlistItem[] = [
  { id: "w1", ticker: "NVDA", name: "NVIDIA", assetClass: "stock", currentPrice: 1085, change24h: 28.4, changePct24h: 2.69, high24h: 1095, low24h: 1052, marketCap: 2680e9, volume24h: 45e9, currency: "USD", sparkline: mkSparkline(980), addedAt: "2025-01-10" },
  { id: "w2", ticker: "BTC",    name: "Bitcoin",   assetClass: "crypto", currentPrice: 52619, change24h: -1200, changePct24h: -2.23, high24h: 54200, low24h: 51800, marketCap: 1040e9, volume24h: 38e9,  currency: "CHF", sparkline: mkSparkline(50000), addedAt: "2025-02-14" },
  { id: "w3", ticker: "TSLA",   name: "Tesla",     assetClass: "stock",  currentPrice: 226,   change24h: -5.8,  changePct24h: -2.50, high24h: 235,   low24h: 222,   marketCap: 720e9,  volume24h: 22e9,  currency: "USD", sparkline: mkSparkline(230),  addedAt: "2025-03-01" },
  { id: "w4", ticker: "AMZN",   name: "Amazon",    assetClass: "stock",  currentPrice: 188,   change24h: 3.2,   changePct24h: 1.73,  high24h: 191,   low24h: 184,   marketCap: 1960e9, volume24h: 31e9,  currency: "USD", sparkline: mkSparkline(175),  addedAt: "2025-03-15" },
  { id: "w5", ticker: "ETH",    name: "Ethereum",  assetClass: "crypto", currentPrice: 1491,  change24h: -79,   changePct24h: -5.03, high24h: 1585,  low24h: 1470,  marketCap: 180e9,  volume24h: 18e9,  currency: "CHF", sparkline: mkSparkline(1600), addedAt: "2025-04-02" },
  { id: "w6", ticker: "AIR.PA", name: "Airbus",    assetClass: "stock",  currentPrice: 167,   change24h: 1.4,   changePct24h: 0.84,  high24h: 169,   low24h: 165,   marketCap: 130e9,  volume24h: 890e6, currency: "EUR", sparkline: mkSparkline(158),  addedAt: "2025-04-20" },
  { id: "w7", ticker: "SOL",    name: "Solana",    assetClass: "crypto", currentPrice: 58,    change24h: -4.5,  changePct24h: -7.21, high24h: 64,    low24h: 57,    marketCap: 25e9,   volume24h: 4e9,   currency: "CHF", sparkline: mkSparkline(65),   addedAt: "2025-05-05" },
]
