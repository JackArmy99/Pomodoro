-- An audit trail of every URL a portal run touched, stored on the job.
-- Nullable ADD COLUMN: no table rebuild, so none of the SQLite string-literal
-- hazard that corrupted Finding rows.
ALTER TABLE "ResearchJob" ADD COLUMN "detail" TEXT;
