-- Curation metadata for the underground shelves, plus the import source URL.
--
-- This migration is written defensively because the production database drifted:
-- a migration named `20260725213444_add_source_url_and_labels` is recorded as
-- applied there, but its file never reached the repository (it was generated
-- inside an ephemeral container, so only the database row survived). Its
-- checksum cannot be reproduced, so recreating that file would break every
-- future `migrate deploy` with a checksum mismatch.
--
-- So this migration reconciles BOTH shapes and is safe to run on either:
--   * a drifted database, which already has label/artistLabel/location/
--     externalLinks on Artist and label/sourceUrl on Track  → renames only;
--   * a fresh database built from 0_init                    → plain adds.
--
-- `label` on either table means the record company. The curation tag is
-- deliberately a different name (`catalogTag`) because conflating the two is
-- what made the underground listing filter the wrong column.

-- ── Artist ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Artist' AND column_name = 'artistLabel'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Artist' AND column_name = 'catalogTag'
  ) THEN
    ALTER TABLE "Artist" RENAME COLUMN "artistLabel" TO "catalogTag";
  END IF;
END $$;

ALTER TABLE "Artist" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "Artist" ADD COLUMN IF NOT EXISTS "catalogTag" TEXT;
ALTER TABLE "Artist" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "Artist" ADD COLUMN IF NOT EXISTS "externalLinks" JSONB;

-- ── Track ─────────────────────────────────────────────────────────────────
-- On a drifted database `Track."label"` holds the curation tag (0_init never
-- created a `label` column on Track), so it is renamed rather than dropped.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Track' AND column_name = 'label'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Track' AND column_name = 'catalogTag'
  ) THEN
    ALTER TABLE "Track" RENAME COLUMN "label" TO "catalogTag";
  END IF;
END $$;

ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "Track" ADD COLUMN IF NOT EXISTS "catalogTag" TEXT;

-- Underground listing filters on the tag and orders by listeners.
CREATE INDEX IF NOT EXISTS "Artist_catalogTag_monthlyListeners_idx"
  ON "Artist"("catalogTag", "monthlyListeners");
