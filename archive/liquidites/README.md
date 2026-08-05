# Liquidités — retiré de l'interface

Toute la surface « Liquidités » a été retirée de l'interface le 2026-08-06,
à la demande de l'utilisateur, **sans supprimer la logique**. Ce dossier
garde ce qui ne vit plus dans l'application, et note ce qui a été retiré
ailleurs, pour pouvoir tout remettre.

Les fichiers portent l'extension `.bak` : sans elle, Next.js verrait
`page.tsx` et recréerait une route.

## Ce qui est conservé ici

| Fichier | Origine |
|---|---|
| `revenus-page.tsx.bak` | `app/(dashboard)/revenus/page.tsx` |

La page portait trois onglets : **Liquidité**, **Revenus annexes** et
**Dividendes**. Les trois disparaissent avec elle. La page `/dividends`,
elle, existe toujours et reste dans la navigation.

## Ce qui reste en place (intact, non affiché)

Rien de la logique n'a été touché — seul l'affichage a disparu :

- `lib/cash.ts` et `lib/cash.test.ts` — moteur de trésorerie, 22 tests
- `hooks/use-app-data.tsx` — `cashAccounts`, `globalCash`, `depositCash`,
  `withdrawCash`, `convertCash`, `transferCash`, `getAvailableCash`
- `lib/supabase/queries.ts` — `fetchGlobalCash`, `upsertGlobalCash`,
  `updateCashBalance`, `fetchCashMovements`, `insertCashMovement`
- Les tables `global_cash`, `cash_movements` et la colonne
  `portfolios.cash_balances` — **aucune donnée n'a été effacée**
- Les achats/ventes continuent de débiter/créditer la trésorerie du
  portefeuille et de journaliser les mouvements : l'historique reste
  complet et cohérent pendant la mise en sommeil.

La page **Cashflow** reste en place : elle décrit des *flux* (entrées,
sorties, taux d'épargne), pas un solde de liquidité.

## Ce qui a été retiré de l'interface

| Emplacement | Élément |
|---|---|
| `components/layout/sidebar.tsx` | entrée de navigation « Liquidités » |
| `components/layout/mobile-nav.tsx` | entrée de navigation « Liquidités » |
| `app/(dashboard)/page.tsx` | carte « Liquidités », bouton « Déposer des liquidités », cash dans le patrimoine net |
| `app/(dashboard)/portfolios/page.tsx` | pastilles « … en liquidité », ligne « Liquidités (cash) », cash dans les métriques affichées |
| `components/portfolio/mobile-portfolio.tsx` | tuile « Liquidités » de l'onglet Aperçu |
| `components/ui/portfolio-creation-modal.tsx` | bloc « Liquidités reprises » de l'aperçu d'import |
| `components/ui/transaction-modal.tsx` | mode « Liquidité » (dépôt/retrait) |

### Conséquence sur les totaux

Les montants affichés (**Patrimoine net total**, valeur d'un portefeuille)
ne comptent plus que les **positions**. La trésorerie continue d'exister en
base mais n'est plus additionnée nulle part : un total qui inclurait un
montant invisible serait impossible à recouper.

## Remettre en service

1. `cp archive/liquidites/revenus-page.tsx.bak "app/(dashboard)/revenus/page.tsx"`
2. Remettre l'entrée `{ label: "Liquidités", href: "/revenus", icon: Wallet }`
   dans `sidebar.tsx` et `mobile-nav.tsx`
3. Rétablir les blocs listés ci-dessus — ils sont repérables dans l'historique
   git par le commit qui référence ce dossier.
