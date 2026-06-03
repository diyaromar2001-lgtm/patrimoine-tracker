"use client"

import { useCurrency } from "@/hooks/use-currency"
import { formatCurrency } from "@/lib/utils"
import type { AppCurrency } from "@/lib/utils"
import { cn } from "@/lib/utils"

const CURRENCY_FLAGS: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", CHF: "🇨🇭", GBP: "🇬🇧",
  JPY: "🇯🇵", CAD: "🇨🇦", AUD: "🇦🇺",
}

/**
 * Shows an asset price with the correct logic:
 *
 *  ┌─ native currency PRIMARY  (e.g. $445.00)
 *  └─ user's currency SECONDARY  (e.g. ≈ 285.50 CHF)  ← hidden if same as native
 *
 * If native === user currency → show only once.
 *
 * @param price          - already-converted value in user's preferred currency
 * @param originalPrice  - the asset's native price (e.g. 445 USD for NVDA)
 * @param originalCurrency - native currency code (e.g. "USD")
 */
interface DualPriceProps {
  price:             number
  originalPrice?:    number
  originalCurrency?: string
  className?:        string
  size?:             "xs" | "sm" | "md" | "lg"
  showFlag?:         boolean
}

export function DualPrice({
  price,
  originalPrice,
  originalCurrency,
  className,
  size = "sm",
  showFlag = false,
}: DualPriceProps) {
  const { currency, format } = useCurrency()

  // Show secondary only when native ≠ user's currency AND we have the native data
  const showConverted =
    Boolean(originalCurrency) &&
    originalPrice != null &&
    originalPrice > 0 &&
    originalCurrency !== currency

  const mainSize = { xs: "text-[11px]", sm: "text-xs", md: "text-sm", lg: "text-base" }[size]
  const subSize  = "text-[11px]"
  const flag     = originalCurrency ? CURRENCY_FLAGS[originalCurrency] ?? "" : ""

  return (
    <span className={cn("inline-flex flex-col tabular-nums", className)}>
      {showConverted ? (
        /* Native currency FIRST */
        <span className={cn(mainSize, "font-semibold")} style={{ color: "var(--text-primary)" }}>
          {showFlag && flag && <span className="mr-0.5">{flag}</span>}
          {formatCurrency(originalPrice!, originalCurrency as AppCurrency)}
        </span>
      ) : (
        /* Same currency — single display */
        <span className={cn(mainSize, "font-semibold")} style={{ color: "var(--text-primary)" }}>
          {format(price)}
        </span>
      )}

      {/* User's currency in small — only when different */}
      {showConverted && (
        <span className={cn(subSize, "font-normal")} style={{ color: "var(--text-tertiary)" }}>
          ≈ {format(price)}
        </span>
      )}
    </span>
  )
}

/**
 * Inline version — single line: "$445.00  ≈ 285 CHF"
 */
export function DualPriceInline({
  price,
  originalPrice,
  originalCurrency,
  className,
  showFlag = false,
}: DualPriceProps) {
  const { currency, format } = useCurrency()

  const showConverted =
    Boolean(originalCurrency) &&
    originalPrice != null &&
    originalPrice > 0 &&
    originalCurrency !== currency

  const flag = originalCurrency ? CURRENCY_FLAGS[originalCurrency] ?? "" : ""

  if (!showConverted) {
    return (
      <span className={cn("tabular-nums font-semibold", className)} style={{ color: "var(--text-primary)" }}>
        {format(price)}
      </span>
    )
  }

  return (
    <span className={cn("tabular-nums", className)}>
      {/* Native */}
      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
        {showFlag && flag && <span className="mr-0.5">{flag}</span>}
        {formatCurrency(originalPrice!, originalCurrency as AppCurrency)}
      </span>
      {/* Converted */}
      <span className="ml-1.5 text-[11px] font-normal" style={{ color: "var(--text-tertiary)" }}>
        ≈ {format(price)}
      </span>
    </span>
  )
}
