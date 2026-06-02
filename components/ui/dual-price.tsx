"use client"

import { useCurrency } from "@/hooks/use-currency"
import { formatCurrency } from "@/lib/utils"
import type { AppCurrency } from "@/lib/utils"
import { cn } from "@/lib/utils"

const CURRENCY_FLAGS: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", CHF: "🇨🇭", GBP: "🇬🇧",
  JPY: "🇯🇵", CAD: "🇨🇦", AUD: "🇦🇺", HKD: "🇭🇰",
}

interface DualPriceProps {
  /** Price already in the user's selected display currency */
  price:             number
  /** Asset's native currency (e.g. "USD" for NVDA, "EUR" for LVMH) */
  originalCurrency?: string
  /** Asset's native price (e.g. 445.00) */
  originalPrice?:    number
  /** Extra classes on the wrapper */
  className?:        string
  /** Size variant */
  size?: "sm" | "md" | "lg"
  /** Show flag emoji before original currency */
  showFlag?: boolean
}

/**
 * Shows price in user's currency + original currency in small text.
 *
 * Example:  401.25 CHF  (445.00 USD 🇺🇸)
 */
export function DualPrice({
  price,
  originalCurrency,
  originalPrice,
  className,
  size = "sm",
  showFlag = true,
}: DualPriceProps) {
  const { currency, format } = useCurrency()

  // Only show secondary if the native currency differs from the selected one
  const showOriginal =
    originalCurrency &&
    originalPrice != null &&
    originalPrice > 0 &&
    originalCurrency !== currency

  const mainSize  = { sm: "text-xs",  md: "text-sm",  lg: "text-lg"  }[size]
  const subSize   = "text-[11px]"
  const flag      = originalCurrency ? CURRENCY_FLAGS[originalCurrency] : ""

  return (
    <span className={cn("inline-flex flex-col tabular-nums", className)}>
      {/* Primary — in user's currency */}
      <span className={cn(mainSize, "font-semibold")} style={{ color: "var(--foreground)" }}>
        {format(price)}
      </span>

      {/* Secondary — original currency */}
      {showOriginal && (
        <span
          className={cn(subSize, "font-normal leading-tight")}
          style={{ color: "var(--foreground-dim)" }}
        >
          {showFlag && flag && <span className="mr-0.5">{flag}</span>}
          {formatCurrency(originalPrice, originalCurrency as AppCurrency)}
        </span>
      )}
    </span>
  )
}

/**
 * Inline version — shows on one line: "401.25 CHF (445.00 USD 🇺🇸)"
 */
export function DualPriceInline({
  price,
  originalCurrency,
  originalPrice,
  className,
  showFlag = true,
}: DualPriceProps) {
  const { currency, format } = useCurrency()

  const showOriginal =
    originalCurrency &&
    originalPrice != null &&
    originalPrice > 0 &&
    originalCurrency !== currency

  const flag = originalCurrency ? CURRENCY_FLAGS[originalCurrency] : ""

  return (
    <span className={cn("tabular-nums", className)}>
      <span className="font-semibold" style={{ color: "var(--foreground)" }}>
        {format(price)}
      </span>
      {showOriginal && (
        <span className="ml-1.5 text-[11px] font-normal" style={{ color: "var(--foreground-dim)" }}>
          ({showFlag && flag && <span className="mr-0.5">{flag}</span>}
          {formatCurrency(originalPrice, originalCurrency as AppCurrency)})
        </span>
      )}
    </span>
  )
}
