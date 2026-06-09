"use client"

import { useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Upload, FileText, Loader2, CheckCircle, AlertCircle, ChevronRight } from "lucide-react"
import { parseTrading212CSVContent } from "@/lib/parsers/trading212-parser-client"
import type { Portfolio } from "@/lib/types"

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = "choice" | "manual" | "import"
type ImportStep = "select" | "analyze" | "confirm" | "progress" | "complete" | "error"

interface ImportAnalysis {
  filename: string
  fileChecksum: string
  periodStart: string
  periodEnd: string
  csvLines: number
  logicalEvents: number
  eventsByType: Record<string, number>
  currencies: string[]
  assetCount: number
  splitsDetected: number
  warnings: string[]
  errors: string[]
}

interface ImportProps {
  open: boolean
  onClose: () => void
  onCreateManual: (name: string, desc: string, color: string) => Promise<void>
  onCreateWithImport: (
    name: string,
    file: File,
    analysis: ImportAnalysis,
    operations: any[]
  ) => Promise<{ portfolioId: string; batchId: string }>
}

// ─── Manual Portfolio Creation ────────────────────────────────────────────────
function ManualCreationForm({
  onSubmit,
  onBack,
}: {
  onSubmit: (name: string, desc: string, color: string) => Promise<void>
  onBack: () => void
}) {
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [color, setColor] = useState("#3b82f6")
  const [submitting, setSubmitting] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          style={{ color: "var(--text-tertiary)" }}
        >
          ←
        </button>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Création manuelle
        </h3>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Nom *
        </label>
        <input
          type="text"
          placeholder="Ex: Actions Long Terme"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
          style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Description
        </label>
        <input
          type="text"
          placeholder="Stratégie, objectif…"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none"
          style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)", color: "var(--text-primary)" }}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Couleur
        </label>
        <div className="flex gap-2">
          {["#3b82f6", "#22c55e", "#a78bfa", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"].map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="h-7 w-7 rounded-full transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                outline: color === c ? "2px solid white" : "none",
                outlineOffset: "2px",
              }}
            />
          ))}
        </div>
      </div>

      <button
        onClick={async () => {
          if (!name.trim()) return
          setSubmitting(true)
          try {
            await onSubmit(name, desc, color)
          } finally {
            setSubmitting(false)
          }
        }}
        disabled={!name.trim() || submitting}
        className="w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Création en cours…
          </span>
        ) : (
          "Créer le portefeuille"
        )}
      </button>
    </div>
  )
}

// ─── CSV Analysis Display ──────────────────────────────────────────────────────
function AnalysisDisplay({ analysis }: { analysis: ImportAnalysis }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <p className="text-[10px] uppercase font-semibold text-zinc-500">Fichier</p>
          <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
            {analysis.filename}
          </p>
        </div>
        <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <p className="text-[10px] uppercase font-semibold text-zinc-500">Période</p>
          <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
            {analysis.periodStart} → {analysis.periodEnd}
          </p>
        </div>
        <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <p className="text-[10px] uppercase font-semibold text-zinc-500">Lignes CSV</p>
          <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
            {analysis.csvLines}
          </p>
        </div>
        <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <p className="text-[10px] uppercase font-semibold text-zinc-500">Événements logiques</p>
          <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
            {analysis.logicalEvents}
          </p>
        </div>
      </div>

      <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
        <p className="text-[10px] uppercase font-semibold text-zinc-500 mb-2">Types d'opérations</p>
        <div className="space-y-1">
          {Object.entries(analysis.eventsByType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <div key={type} className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {type}
                </span>
                <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {count}
                </span>
              </div>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <p className="text-[10px] uppercase font-semibold text-zinc-500">Devises</p>
          <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
            {analysis.currencies.join(", ")}
          </p>
        </div>
        <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <p className="text-[10px] uppercase font-semibold text-zinc-500">Actifs</p>
          <p className="text-sm font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
            {analysis.assetCount}
          </p>
        </div>
      </div>

      {analysis.splitsDetected > 0 && (
        <div className="rounded-lg border p-3 flex items-start gap-3" style={{ backgroundColor: "#f59e0b18", borderColor: "#f59e0b30" }}>
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
          <div className="text-xs" style={{ color: "#f59e0b" }}>
            <p className="font-semibold">{analysis.splitsDetected} split(s) détecté(s)</p>
            <p className="mt-0.5 opacity-80">Les splits seront appariés (open + close = 1 événement)</p>
          </div>
        </div>
      )}

      {analysis.warnings.length > 0 && (
        <div className="rounded-lg border p-3 flex items-start gap-3" style={{ backgroundColor: "#f59e0b18", borderColor: "#f59e0b30" }}>
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
          <div className="text-xs space-y-1" style={{ color: "#f59e0b" }}>
            {analysis.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {analysis.errors.length > 0 && (
        <div className="rounded-lg border p-3 flex items-start gap-3" style={{ backgroundColor: "#ef444418", borderColor: "#ef444430" }}>
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "#ef4444" }} />
          <div className="text-xs space-y-1" style={{ color: "#ef4444" }}>
            {analysis.errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Import Progress ──────────────────────────────────────────────────────────
function ImportProgress({
  status,
  progress,
  message,
}: {
  status: "progress" | "complete" | "error"
  progress: number
  message: string
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {status === "progress" && <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#3b82f6" }} />}
        {status === "complete" && <CheckCircle className="h-5 w-5" style={{ color: "#22c55e" }} />}
        {status === "error" && <AlertCircle className="h-5 w-5" style={{ color: "#ef4444" }} />}
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {message}
        </p>
      </div>

      {status === "progress" && (
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border)" }}>
          {progress === 0 ? (
            // Indeterminate progress: animated shimmer when progress is 0
            <motion.div
              className="h-full w-1/3"
              animate={{ x: ["0%", "200%"] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              style={{ background: "linear-gradient(90deg, #3b82f6, #22c55e)" }}
            />
          ) : (
            // Determinate progress: fills to percentage if progress > 0
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
              className="h-full"
              style={{ background: "linear-gradient(90deg, #3b82f6, #22c55e)" }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Import Complete Results ───────────────────────────────────────────────────
function ImportComplete({
  results,
  onClose,
}: {
  results: {
    portfolioId: string
    batchId: string
    operationsImported: number
    assetsCreated: number
    cashMovements: number
    dividends: number
    splits: number
  }
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <CheckCircle className="h-12 w-12" style={{ color: "#22c55e" }} />
      </div>

      <div className="text-center">
        <h3 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          Import réussi!
        </h3>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Le portefeuille a été créé avec succès
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Opérations importées
          </span>
          <span className="text-sm font-bold" style={{ color: "#22c55e" }}>
            {results.operationsImported}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Actifs créés
          </span>
          <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {results.assetsCreated}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Mouvements cash
          </span>
          <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {results.cashMovements}
          </span>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Dividendes
          </span>
          <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {results.dividends}
          </span>
        </div>
        {results.splits > 0 && (
          <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Splits appliqués
            </span>
            <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {results.splits}
            </span>
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
        style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }}
      >
        Fermer
      </button>
    </div>
  )
}

// ─── Main Modal ────────────────────────────────────────────────────────────────
export function PortfolioCreationModal({
  open,
  onClose,
  onCreateManual,
  onCreateWithImport,
}: ImportProps) {
  const [mode, setMode] = useState<Mode>("choice")
  const [importStep, setImportStep] = useState<ImportStep>("select")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null)
  const [operations, setOperations] = useState<any[]>([])
  const [importProgress, setImportProgress] = useState(0)
  const [importMessage, setImportMessage] = useState("")
  const [importError, setImportError] = useState("")
  const [importResults, setImportResults] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetModal = () => {
    setMode("choice")
    setImportStep("select")
    setSelectedFile(null)
    setAnalysis(null)
    setOperations([])
    setImportProgress(0)
    setImportMessage("")
    setImportError("")
    setImportResults(null)
    onClose()
  }

  const handleFileSelect = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("Le fichier doit être un CSV")
      return
    }

    setSelectedFile(file)
    setImportMessage("Analyse du fichier…")
    setImportProgress(0) // Indeterminate: 0 means no progress bar percent

    try {
      // Read file content and parse it
      const fileContent = await file.text()
      const parseResult = await parseTrading212CSVContent(fileContent)
      const ops = parseResult.operations
      const stats = parseResult.stats

      // Build analysis
      const periodDates = ops
        .map((o: any) => new Date(o.date))
        .filter((d) => !isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())

      const currencies = new Set<string>()
      const assetTickers = new Set<string>()
      const eventsByType: Record<string, number> = {}

      ops.forEach((op: any) => {
        eventsByType[op.type] = (eventsByType[op.type] || 0) + 1
        if (op.priceCurrency) currencies.add(op.priceCurrency)
        if (op.totalCurrency) currencies.add(op.totalCurrency)
        if (op.ticker) assetTickers.add(op.ticker)
      })

      if (!currencies.has("CHF")) currencies.add("CHF")

      const anal: ImportAnalysis = {
        filename: file.name,
        fileChecksum: parseResult.fileChecksum,
        periodStart: periodDates.length > 0 ? periodDates[0].toLocaleDateString("fr-CH") : "N/A",
        periodEnd: periodDates.length > 0 ? periodDates[periodDates.length - 1].toLocaleDateString("fr-CH") : "N/A",
        csvLines: stats.csvLinesRead,
        logicalEvents: stats.logicalEvents,
        eventsByType,
        currencies: Array.from(currencies).sort(),
        assetCount: assetTickers.size,
        splitsDetected: eventsByType["stock_split"] || 0,
        warnings: [],
        errors: [],
      }

      setAnalysis(anal)
      setOperations(ops)
      setImportStep("analyze")
      setImportProgress(0) // Analysis complete, move to next step
    } catch (e) {
      setImportError(`Erreur lors de l'analyse: ${e instanceof Error ? e.message : "inconnu"}`)
      setImportStep("error")
    }
  }

  if (!open) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={resetModal}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md rounded-2xl border p-6 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {mode === "choice" && "Nouveau portefeuille"}
            {mode === "manual" && "Création manuelle"}
            {mode === "import" && "Import CSV Trading 212"}
          </h3>
          <button
            onClick={resetModal}
            className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4 text-zinc-500" />
          </button>
        </div>

        {/* DIAGNOSTIC MARKER */}
        <div className="text-[10px] text-yellow-400">MODAL-CHOICE-V2</div>

        <AnimatePresence mode="wait">
          {/* Choice: Manual or Import */}
          {mode === "choice" && (
            <motion.div
              key="choice"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="space-y-3"
            >
              <button
                onClick={() => setMode("manual")}
                className="w-full flex items-center justify-between p-4 rounded-lg border hover:bg-zinc-800/40 transition-colors"
                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}
              >
                <div className="text-left">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    Création manuelle
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    Nom, description, couleur
                  </p>
                </div>
                <ChevronRight className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
              </button>

              <button
                onClick={() => setMode("import")}
                className="w-full flex items-center justify-between p-4 rounded-lg border hover:bg-zinc-800/40 transition-colors"
                style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}
              >
                <div className="text-left">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    Import CSV Trading 212
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    Depuis un export broker
                  </p>
                </div>
                <ChevronRight className="h-4 w-4" style={{ color: "var(--text-tertiary)" }} />
              </button>
            </motion.div>
          )}

          {/* Manual Creation */}
          {mode === "manual" && (
            <motion.div key="manual" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <ManualCreationForm
                onSubmit={async (name, desc, color) => {
                  await onCreateManual(name, desc, color)
                  resetModal()
                }}
                onBack={() => setMode("choice")}
              />
            </motion.div>
          )}

          {/* CSV Import Workflow */}
          {mode === "import" && (
            <motion.div key="import" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-4">
              {/* Step: File Selection */}
              {importStep === "select" && (
                <div className="space-y-4">
                  <div
                    className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-zinc-800/40 transition-colors"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-8 w-8 mx-auto mb-2" style={{ color: "var(--text-tertiary)" }} />
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      Sélectionnez un fichier CSV
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                      Trading 212 export (from_YYYY-MM-DD_to_YYYY-MM-DD_*.csv)
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileSelect(file)
                      }}
                    />
                  </div>
                  {selectedFile && (
                    <div className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: "#22c55e18", borderColor: "#22c55e30" }}>
                      <FileText className="h-4 w-4" style={{ color: "#22c55e" }} />
                      <span className="text-sm" style={{ color: "#22c55e" }}>
                        {selectedFile.name}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => setMode("choice")}
                    className="w-full rounded-lg border px-3 py-2.5 text-sm font-medium hover:bg-zinc-800 transition-colors"
                    style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                  >
                    Retour
                  </button>
                </div>
              )}

              {/* Step: Analysis */}
              {importStep === "analyze" && analysis && (
                <div className="space-y-4">
                  <AnalysisDisplay analysis={analysis} />
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setImportStep("select")
                        setSelectedFile(null)
                        setAnalysis(null)
                      }}
                      className="flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium hover:bg-zinc-800 transition-colors"
                      style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                    >
                      Retour
                    </button>
                    <button
                      onClick={() => setImportStep("confirm")}
                      className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
                      style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)" }}
                    >
                      Continuer
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Confirm */}
              {importStep === "confirm" && analysis && (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--bg-base)", borderColor: "var(--border)" }}>
                    <p className="text-xs font-semibold uppercase text-zinc-500 mb-2">Paramètres du portefeuille</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          Nom
                        </span>
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                          {analysis.filename.replace(/\.csv$/i, "")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          Opérations à importer
                        </span>
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                          {analysis.logicalEvents}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                    ⚠️ L'import créera un portefeuille avec tous les actifs et transactions du fichier CSV. Cette opération est irréversible.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setImportStep("analyze")}
                      className="flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium hover:bg-zinc-800 transition-colors"
                      style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                    >
                      Retour
                    </button>
                    <button
                      onClick={async () => {
                        if (!selectedFile || !analysis) return
                        setImportStep("progress")
                        setImportProgress(0) // Indeterminate - single RPC call
                        setImportMessage("Création du portefeuille et import en cours…")

                        try {
                          const results = await onCreateWithImport(
                            analysis.filename.replace(/\.csv$/i, ""),
                            selectedFile,
                            analysis,
                            operations
                          )

                          setImportProgress(0) // Still indeterminate
                          setImportMessage("Import réussi!")
                          setImportResults({
                            portfolioId: results.portfolioId,
                            batchId: results.batchId,
                            operationsImported: analysis.logicalEvents,
                            assetsCreated: analysis.assetCount,
                            cashMovements: analysis.eventsByType["deposit"] || 0 + (analysis.eventsByType["withdrawal"] || 0),
                            dividends: analysis.eventsByType["dividend"] || 0,
                            splits: analysis.splitsDetected,
                          })
                          setImportStep("complete")
                        } catch (e) {
                          setImportError(e instanceof Error ? e.message : "Erreur inconnue")
                          setImportStep("error")
                        }
                      }}
                      className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
                      style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }}
                    >
                      Importer
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Progress */}
              {importStep === "progress" && (
                <ImportProgress status="progress" progress={importProgress} message={importMessage} />
              )}

              {/* Step: Complete */}
              {importStep === "complete" && importResults && (
                <ImportComplete results={importResults} onClose={resetModal} />
              )}

              {/* Step: Error */}
              {importStep === "error" && (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4 flex items-start gap-3" style={{ backgroundColor: "#ef444418", borderColor: "#ef444430" }}>
                    <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: "#ef4444" }} />
                    <div className="text-sm" style={{ color: "#ef4444" }}>
                      <p className="font-semibold">Erreur lors de l'import</p>
                      <p className="mt-1">{importError}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setImportStep("select")
                      setImportError("")
                    }}
                    className="w-full rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-all"
                    style={{ background: "linear-gradient(135deg,#ef4444,#dc2626)" }}
                  >
                    Réessayer
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
