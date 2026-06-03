"use client"

import { useState, useEffect } from "react"

interface MarketState {
  isOpen: boolean
  label: string
  next: string
}

function computeMarket(): MarketState {
  const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
  const day = est.getDay()         // 0=Sun, 6=Sat
  const h = est.getHours()
  const m = est.getMinutes()
  const min = h * 60 + m

  const OPEN  = 9  * 60 + 30   // 9:30 AM EST
  const CLOSE = 16 * 60         // 4:00 PM EST
  const isWeekday = day >= 1 && day <= 5
  const isOpen = isWeekday && min >= OPEN && min < CLOSE

  let next = ""
  if (!isOpen) {
    if (!isWeekday || min >= CLOSE) {
      const daysUntilMonday = day === 0 ? 1 : day === 6 ? 2 : 1
      const tomorrow = new Date(est)
      tomorrow.setDate(tomorrow.getDate() + (min >= CLOSE || !isWeekday ? daysUntilMonday : 0))
      tomorrow.setHours(9, 30, 0, 0)
      const diff = tomorrow.getTime() - est.getTime()
      const hours = Math.floor(diff / 3600000)
      if (hours > 0) next = `ouvre dans ${hours}h`
    } else {
      const minsLeft = OPEN - min
      next = `ouvre dans ${minsLeft}min`
    }
  } else {
    const minsLeft = CLOSE - min
    const h2 = Math.floor(minsLeft / 60)
    const m2 = minsLeft % 60
    next = h2 > 0 ? `ferme dans ${h2}h${m2 > 0 ? m2 : ""}` : `ferme dans ${minsLeft}min`
  }

  return { isOpen, label: isOpen ? "OUVERT" : "FERMÉ", next }
}

export function MarketStatus() {
  const [market, setMarket] = useState<MarketState>({ isOpen: false, label: "FERMÉ", next: "" })

  useEffect(() => {
    setMarket(computeMarket())
    const id = setInterval(() => setMarket(computeMarket()), 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      className="hidden lg:flex items-center gap-2 rounded-lg border px-2.5 py-1"
      style={{
        borderColor: market.isOpen ? "#22c55e40" : "#ef444440",
        backgroundColor: market.isOpen ? "#22c55e08" : "#ef444408",
      }}
      title={market.next}
    >
      <span
        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
        style={{
          backgroundColor: market.isOpen ? "#22c55e" : "#ef4444",
          boxShadow: market.isOpen ? "0 0 6px #22c55e" : "none",
          animation: market.isOpen ? "pulse 2s infinite" : "none",
        }}
      />
      <span className="text-[11px] font-medium tabular-nums"
        style={{ color: market.isOpen ? "#22c55e" : "#ef4444" }}>
        {market.label}
      </span>
    </div>
  )
}
