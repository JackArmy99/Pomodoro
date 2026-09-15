-- Verification is tied to a revision of the finding's content, so an edit,
-- re-summary or dig-deeper invalidates a previous human tick.
ALTER TABLE "Finding" ADD COLUMN "contentRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Finding" ADD COLUMN "verifiedRevision" INTEGER;
ALTER TABLE "Finding" ADD COLUMN "verifiedAt" DATETIME;

-- Existing verified findings: treat the current content as the reviewed one.
UPDATE "Finding" SET "verifiedRevision" = 0 WHERE "verified" = true;
