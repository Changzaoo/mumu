-- Artist: curation metadata for the underground shelves.
--   label      → record company the artist works with (most frequent in catalog)
--   catalogTag → operator-curated tag ("underground", "freestyle", ...)
ALTER TABLE "Artist" ADD COLUMN     "label" TEXT;
ALTER TABLE "Artist" ADD COLUMN     "catalogTag" TEXT;
ALTER TABLE "Artist" ADD COLUMN     "location" TEXT;
ALTER TABLE "Artist" ADD COLUMN     "externalLinks" JSONB;

-- Track: where it came from, and its own curation tag.
ALTER TABLE "Track" ADD COLUMN     "sourceUrl" TEXT;
ALTER TABLE "Track" ADD COLUMN     "catalogTag" TEXT;

-- Underground listing filters on the tag and orders by listeners.
CREATE INDEX "Artist_catalogTag_monthlyListeners_idx" ON "Artist"("catalogTag", "monthlyListeners");
