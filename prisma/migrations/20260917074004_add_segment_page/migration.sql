-- Documents cite a page where videos cite a timestamp.
-- Deliberately a plain ADD COLUMN: a nullable add needs no table rebuild, and a
-- rebuild is what silently wrote column NAMES into rows the last time.
ALTER TABLE "TranscriptSegment" ADD COLUMN "page" INTEGER;
