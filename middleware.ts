import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

// Routes accessibles sans authentification
const PUBLIC_PATHS = ["/login", "/auth"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Laisser passer toutes les routes publiques sans toucher aux cookies
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Supabase non configuré → mode local/démo : l'app fonctionne en mémoire
  // (useAppData a déjà ce repli). Sans cette porte de sortie, on redirigeait
  // en boucle vers un login qui ne peut pas aboutir.
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next()
  }

  // Pour les routes protégées, vérifier la session Supabase
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll()  { return request.cookies.getAll() },
        setAll(cs) {
          cs.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response = NextResponse.next({ request })
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // IMPORTANT: getUser() (pas getSession()) pour valider côté serveur.
  // Si Supabase est injoignable (projet supprimé, panne réseau), on ne veut
  // pas d'une erreur 500 sur toutes les pages : on retombe sur le login.
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (e) {
    console.error("[middleware] Supabase injoignable:", e)
  }

  if (!user) {
    // Non authentifié → page de login
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // Exclure: fichiers statiques, API routes, login, auth
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)|api/|login|auth).*)",
  ],
}
