-- ════════════════════════════════════════════════════════════════════════════
-- Patrimoine Tracker — Auth + User-scoped RLS
-- Colle ce SQL dans Supabase > SQL Editor > New Query > Run
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Supprimer les anciennes policies "allow all" ───────────────────────────
DROP POLICY IF EXISTS "allow_all_portfolios"   ON portfolios;
DROP POLICY IF EXISTS "allow_all_assets"       ON assets;
DROP POLICY IF EXISTS "allow_all_transactions" ON transactions;
DROP POLICY IF EXISTS "allow_all_watchlist"    ON watchlist;

-- ── 2. S'assurer que user_id est présent et non nullable dans portfolios ──────
-- (déjà fait si tu as lancé schema.sql, sinon décommente :)
-- ALTER TABLE portfolios  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
-- ALTER TABLE watchlist   ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- ── 3. Policies user-scoped ───────────────────────────────────────────────────

-- Portfolios : chaque user voit uniquement les siens
CREATE POLICY "users_own_portfolios"
  ON portfolios FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Assets : accessible si le portfolio appartient à l'user
CREATE POLICY "users_own_assets"
  ON assets FOR ALL
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
  );

-- Transactions : idem
CREATE POLICY "users_own_transactions"
  ON transactions FOR ALL
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
  );

-- Watchlist : par user
CREATE POLICY "users_own_watchlist"
  ON watchlist FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 4. Trigger : créer un portefeuille vide au premier login ─────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.portfolios (user_id, name, description, color, currency)
  VALUES (
    NEW.id,
    'Mon Portefeuille',
    'Portefeuille principal',
    '#3b82f6',
    'CHF'
  );
  RETURN NEW;
END;
$$;

-- Attache le trigger sur auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── 5. Vérification ──────────────────────────────────────────────────────────
-- Si tout est OK tu dois voir "SUCCESS" dans les résultats.
SELECT 'AUTH SCHEMA APPLIED SUCCESSFULLY' AS status;
