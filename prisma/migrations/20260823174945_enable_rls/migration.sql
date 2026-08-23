-- Row Level Security, as defense in depth.
--
-- Prisma connects with database credentials and therefore BYPASSES these
-- policies — the app's real protection is that every query in queries.ts and
-- actions.ts is scoped by the userId from requireUser(). These policies exist so
-- a leaked anon key, a future browser-side Supabase query, or a mistake in the
-- Supabase dashboard cannot read one user's food diary as another.
--
-- The policies reference auth.uid(), which only exists on Supabase. Local
-- development runs plain Postgres, so policy creation is guarded on the presence
-- of the `auth` schema and executed dynamically — a bare CREATE POLICY would
-- fail to parse locally and make this migration un-appliable.
--
-- Enabling RLS itself is unconditional and harmless locally: a table's owner
-- bypasses RLS unless FORCE is set, and Prisma connects as the owner.

ALTER TABLE "Profile"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Entry"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EntryItem"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FoodItem"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParseUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParseCache" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regnamespace('auth') IS NULL THEN
    RAISE NOTICE 'No auth schema (local Postgres) — RLS enabled, policies skipped. They are created on Supabase.';
    RETURN;
  END IF;

  -- Profile: you can only see and change your own row.
  EXECUTE $p$
    CREATE POLICY "profile_owner" ON "Profile"
      USING ("userId" = auth.uid()::text)
      WITH CHECK ("userId" = auth.uid()::text)
  $p$;

  -- Entry: same, keyed directly on userId.
  EXECUTE $p$
    CREATE POLICY "entry_owner" ON "Entry"
      USING ("userId" = auth.uid()::text)
      WITH CHECK ("userId" = auth.uid()::text)
  $p$;

  -- EntryItem has no userId of its own; ownership comes from its parent Entry.
  EXECUTE $p$
    CREATE POLICY "entry_item_owner" ON "EntryItem"
      USING (
        EXISTS (
          SELECT 1 FROM "Entry" e
          WHERE e.id = "EntryItem"."entryId" AND e."userId" = auth.uid()::text
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM "Entry" e
          WHERE e.id = "EntryItem"."entryId" AND e."userId" = auth.uid()::text
        )
      )
  $p$;

  -- FoodItem: a NULL userId is the shared food library, readable by everyone.
  -- Writes are restricted to your own rows so nobody can rewrite shared
  -- nutrition for every other user.
  EXECUTE $p$
    CREATE POLICY "food_item_read" ON "FoodItem"
      FOR SELECT
      USING ("userId" IS NULL OR "userId" = auth.uid()::text)
  $p$;

  EXECUTE $p$
    CREATE POLICY "food_item_write" ON "FoodItem"
      FOR ALL
      USING ("userId" = auth.uid()::text)
      WITH CHECK ("userId" = auth.uid()::text)
  $p$;

  EXECUTE $p$
    CREATE POLICY "parse_usage_owner" ON "ParseUsage"
      USING ("userId" = auth.uid()::text)
      WITH CHECK ("userId" = auth.uid()::text)
  $p$;

  -- ParseCache is keyed by a hash of the input text and holds no user
  -- identifier, so there is nothing to scope by. Readable but not writable by
  -- clients: only the server populates it.
  EXECUTE $p$
    CREATE POLICY "parse_cache_read" ON "ParseCache"
      FOR SELECT
      USING (true)
  $p$;
END
$$;
