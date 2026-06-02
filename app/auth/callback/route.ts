import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * OAuth callback — Supabase redirects here after Google login.
 *
 * On Vercel the request.url origin is http:// (behind proxy).
 * We must use x-forwarded-host + https:// to build the correct redirect URL.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get("code")
  const next  = searchParams.get("next") ?? "/"
  const error = searchParams.get("error")

  // Build the base URL correctly for Vercel (https) or local (http)
  const forwardedHost = request.headers.get("x-forwarded-host")
  const host          = forwardedHost ?? request.headers.get("host") ?? "localhost:3000"
  const proto         = forwardedHost ? "https" : "http"
  const base          = `${proto}://${host}`

  if (error) {
    console.error("[auth/callback] OAuth error:", error)
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    console.error("[auth/callback] No code received")
    return NextResponse.redirect(`${base}/login?error=no_code`)
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    console.error("[auth/callback] Exchange error:", exchangeError.message)
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(exchangeError.message)}`)
  }

  // ✅ Session established — send to dashboard
  return NextResponse.redirect(`${base}${next}`)
}
