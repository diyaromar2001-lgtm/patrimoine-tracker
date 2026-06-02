import { createBrowserClient } from "@supabase/ssr"

// These are injected via Vercel environment variables
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ""
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON)

// Returns null when Supabase isn't configured — caller must handle gracefully
export function createClient() {
  if (!isSupabaseConfigured) return null
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON)
}
