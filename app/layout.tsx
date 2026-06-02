import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { CurrencyProvider } from "@/hooks/use-currency"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Patrimoine Tracker",
    template: "%s · Patrimoine Tracker",
  },
  description: "Suivez et analysez votre patrimoine en temps réel",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className={`${inter.variable} h-full`}>
      <body className="h-full antialiased">
        <CurrencyProvider>{children}</CurrencyProvider>
      </body>
    </html>
  )
}
