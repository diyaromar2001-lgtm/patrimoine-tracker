"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Topbar } from "@/components/layout/topbar"
import { SectionHeader } from "@/components/ui/section-header"
import { Check, User, Bell, Shield, Palette, Globe, Trash2, CheckCircle2 } from "lucide-react"
import { useCurrency } from "@/hooks/use-currency"
import type { AppCurrency } from "@/lib/utils"

const LANGUAGES = ["Français", "English", "Español", "Deutsch"]

const CURRENCY_OPTIONS: { value: AppCurrency; label: string; flag: string; description: string }[] = [
  { value: "CHF", label: "Franc suisse",  flag: "🇨🇭", description: "Affichage en CHF — devise par défaut" },
  { value: "USD", label: "Dollar US",     flag: "🇺🇸", description: "Affichage en USD — marché américain" },
  { value: "EUR", label: "Euro",          flag: "🇪🇺", description: "Affichage en EUR — zone euro" },
]

export default function SettingsPage() {
  const { currency: activeCurrency, setCurrency } = useCurrency()
  const [saved, setSaved]     = useState(false)
  const [savedField, setSavedField] = useState("")
  const [profile, setProfile] = useState({ name: "DYAROMAR", email: "contact@patrimoine.fr", avatar: "D" })
  const [prefs, setPrefs]     = useState({ language: "Français" })
  const [notifications, setNotifications] = useState({ dividends: true, priceAlerts: true, weeklyReport: false, monthlyReport: true })

  function showSaved(field = "") {
    setSaved(true); setSavedField(field)
    setTimeout(() => { setSaved(false); setSavedField("") }, 2000)
  }

  function handleCurrencyChange(c: AppCurrency) {
    setCurrency(c)
    showSaved("currency")
  }

  function handleSave() {
    showSaved()
    setTimeout(() => setSaved(false), 2500)
  }

  const sections = [
    { id: "profile", label: "Profil", icon: User },
    { id: "preferences", label: "Préférences", icon: Globe },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Sécurité", icon: Shield },
    { id: "appearance", label: "Apparence", icon: Palette },
  ]

  return (
    <div className="flex flex-col">
      <Topbar title="Paramètres" subtitle="Gérez votre compte et vos préférences" />
      <div className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-6">

          {/* Profile */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <User className="h-4 w-4" style={{ color: "#3b82f6" }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Profil</h2>
            </div>
            <div className="p-5 space-y-4">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}>
                  {profile.avatar}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{profile.name}</p>
                  <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{profile.email}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Nom</label>
                  <input type="text" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors"
                    style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Email</label>
                  <input type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors"
                    style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }} />
                </div>
              </div>
            </div>
          </section>

          {/* Preferences */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4" style={{ color: "#a78bfa" }} />
                <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Devise d'affichage</h2>
              </div>
              <AnimatePresence>
                {savedField === "currency" && (
                  <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#22c55e" }}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sauvegardé
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                Tous les montants s'afficheront dans cette devise. Les prix des actifs affichent aussi leur devise d'origine (ex: USD pour les actions US).
              </p>

              {/* Currency cards */}
              <div className="grid gap-3 sm:grid-cols-3">
                {CURRENCY_OPTIONS.map(opt => {
                  const isActive = activeCurrency === opt.value
                  return (
                    <button key={opt.value}
                      onClick={() => handleCurrencyChange(opt.value)}
                      className="flex flex-col gap-2 rounded-xl border p-4 text-left transition-all hover:border-blue-500/50"
                      style={{
                        backgroundColor: isActive ? "#3b82f615" : "var(--background)",
                        borderColor:     isActive ? "#3b82f6" : "var(--border)",
                        boxShadow:       isActive ? "0 0 0 1px #3b82f640" : "none",
                      }}>
                      <div className="flex items-center justify-between">
                        <span className="text-2xl">{opt.flag}</span>
                        {isActive && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: isActive ? "white" : "var(--foreground)" }}>
                          {opt.value}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                          {opt.label}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Language */}
              <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>Langue</label>
                <select value={prefs.language} onChange={e => setPrefs(p => ({ ...p, language: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
                  style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}>
                  {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Notifications */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <Bell className="h-4 w-4" style={{ color: "#f59e0b" }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Notifications</h2>
            </div>
            <div className="p-5 space-y-0">
              {[
                { key: "dividends", label: "Rappels de dividendes", desc: "Notification avant les ex-dates" },
                { key: "priceAlerts", label: "Alertes de prix", desc: "Variations importantes de vos actifs" },
                { key: "weeklyReport", label: "Rapport hebdomadaire", desc: "Résumé de la performance chaque semaine" },
                { key: "monthlyReport", label: "Rapport mensuel", desc: "Bilan mensuel complet" },
              ].map((item, i) => (
                <div key={item.key} className="flex items-center justify-between py-3.5"
                  style={{ borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none" }}>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{item.label}</p>
                    <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{item.desc}</p>
                  </div>
                  <button
                    onClick={() => setNotifications(n => ({ ...n, [item.key]: !n[item.key as keyof typeof n] }))}
                    className="relative h-5 w-9 rounded-full transition-colors duration-200 flex-shrink-0"
                    style={{ backgroundColor: notifications[item.key as keyof typeof notifications] ? "#3b82f6" : "var(--border)" }}
                  >
                    <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200"
                      style={{ transform: notifications[item.key as keyof typeof notifications] ? "translateX(16px)" : "translateX(2px)" }} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Appearance */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <Palette className="h-4 w-4" style={{ color: "#22c55e" }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Apparence</h2>
            </div>
            <div className="p-5">
              <p className="text-xs mb-3" style={{ color: "var(--foreground-muted)" }}>Thème</p>
              <div className="flex gap-3">
                {[{ label: "Sombre", active: true, bg: "#09090b", border: "#27272a" }, { label: "Clair", active: false, bg: "#ffffff", border: "#e4e4e7" }, { label: "Système", active: false, bg: "linear-gradient(135deg,#09090b 50%,#ffffff 50%)", border: "#27272a" }].map(t => (
                  <button key={t.label} className="flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-colors"
                    style={{ borderColor: t.active ? "#3b82f6" : "var(--border)", opacity: t.active ? 1 : 0.5 }}>
                    <div className="h-10 w-16 rounded-lg border" style={{ background: t.bg, borderColor: t.border }} />
                    <span className="text-xs font-medium" style={{ color: t.active ? "#3b82f6" : "var(--foreground-muted)" }}>{t.label}</span>
                    {t.active && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Danger zone */}
          <section className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--background-card)", borderColor: "#ef444440" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "#ef444430" }}>
              <Trash2 className="h-4 w-4" style={{ color: "#ef4444" }} />
              <h2 className="text-sm font-semibold" style={{ color: "#ef4444" }}>Zone dangereuse</h2>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-4" style={{ borderColor: "#ef444430", backgroundColor: "#ef444408" }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Réinitialiser les données</p>
                  <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Supprime toutes les transactions et positions</p>
                </div>
                <button className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90" style={{ backgroundColor: "#ef4444" }}>
                  Réinitialiser
                </button>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4" style={{ borderColor: "#ef444430", backgroundColor: "#ef444408" }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Supprimer le compte</p>
                  <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>Action irréversible — toutes vos données seront perdues</p>
                </div>
                <button className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-red-500/10" style={{ borderColor: "#ef4444", color: "#ef4444" }}>
                  Supprimer
                </button>
              </div>
            </div>
          </section>

          {/* Save button */}
          <div className="flex justify-end pb-6">
            <motion.button
              onClick={handleSave}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition-all"
              style={{ background: saved ? "#22c55e" : "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 0 20px #3b82f630" }}
            >
              {saved ? <><Check className="h-4 w-4" /> Sauvegardé</> : "Sauvegarder les modifications"}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  )
}