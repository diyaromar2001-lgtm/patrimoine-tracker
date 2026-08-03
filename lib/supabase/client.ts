import { createBrowserClient } from "@supabase/ssr"

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ""
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON)

// 400 days in seconds — keeps the session alive across browser restarts
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60

export function createClient() {
  if (!isSupabaseConfigured) return null
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON, {
    cookieOptions: {
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax",
      // `secure: true` empêche le navigateur d'enregistrer le cookie en HTTP :
      // la session (et le code_verifier PKCE) était impossible en local, donc
      // la connexion échouait silencieusement en développement.
      secure: typeof window === "undefined" || window.location.protocol === "https:",
    },
  })
}

/** Sign out and redirect to /login */
export async function signOut() {
  const sb = createClient()
  if (sb) await sb.auth.signOut()
  window.location.href = "/login"
}
