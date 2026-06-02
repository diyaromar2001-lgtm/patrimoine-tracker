import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * OAuth callback — Supabase redirects here after Google login.
 * Exchanges the `code` for a session, then redirects to the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get("code")
  const next  = searchParams.get("next") ?? "/"
  const error = searchParams.get("error")

  // Handle OAuth errors from provider
  if (error) {
    console.error("OAuth error:", error, searchParams.get("error_description"))
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError) {
      // Successful auth → redirect to dashboard
      return NextResponse.redirect(`${origin}${next}`)
    }

    console.error("Code exchange error:", exchangeError.message)
  }

  // Fallback — redirect back to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
