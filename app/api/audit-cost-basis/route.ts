import { NextResponse } from "next/server"

export const runtime = "nodejs"

/**
 * Audit API — diagnostic costBasisChf
 *
 * Cette API nécessite une clé service Supabase qui n'est pas disponible
 * en environnement Vercel (ou elle doit être ajoutée aux secrets).
 *
 * Solution : le diagnostic est exécuté côté client via la page audit.
 * Voir /audit-cost-basis (page client avec Supabase client).
 */
export async function GET() {
  return NextResponse.json({
    message: "Audit diagnostic — utilisez la page /audit-cost-basis",
    status: "client-side",
  })
}
