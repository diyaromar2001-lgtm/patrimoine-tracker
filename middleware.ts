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

  // Pour les routes protégées, vérifier la session Supabase
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // IMPORTANT: getUser() (pas getSession()) pour valider côté serveur
  const { data: { user } } = await supabase.auth.getUser()

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
