-- Repair Finding rows damaged by the mis-ordered migration.
--
-- On machines where `add_knowledge_base` ran BEFORE
-- `revision_aware_verification` (the mis-ordered one, which then failed), the
-- Finding table rebuild selected three columns that did not exist yet:
-- contentRevision, verifiedRevision, verifiedAt. SQLite's legacy compatibility
-- rule accepts a double-quoted identifier that matches no column as a STRING
-- LITERAL, so instead of erroring, the rebuild silently wrote each column's own
-- NAME into it as text. Prisma then fails to read the table at all:
--   "Inconsistent column data: Conversion failed: input contains invalid characters"
--
-- This restores exactly what revision_aware_verification would have written.
-- Both guards (typeof + the exact corrupt literal) are deliberate: on a healthy
-- database every statement below matches nothing and does nothing.

UPDATE "Finding" SET "contentRevision" = 0
 WHERE typeof("contentRevision") = 'text' AND "contentRevision" = 'contentRevision';

-- Verbatim intent of the original back-fill: a finding already ticked as
-- verified keeps its tick, bound to the current (unchanged) content.
UPDATE "Finding" SET "verifiedRevision" = CASE WHEN "verified" THEN 0 ELSE NULL END
 WHERE typeof("verifiedRevision") = 'text' AND "verifiedRevision" = 'verifiedRevision';

UPDATE "Finding" SET "verifiedAt" = NULL
 WHERE typeof("verifiedAt") = 'text' AND "verifiedAt" = 'verifiedAt';
