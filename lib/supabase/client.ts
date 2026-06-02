import { createBrowserClient } from "@supabase/ssr"

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ""
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON)

export function createClient() {
  if (!isSupabaseConfigured) return null
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON)
}

/** Sign out and redirect to /login */
export async function signOut() {
  const sb = createClient()
  if (sb) await sb.auth.signOut()
  window.location.href = "/login"
}
