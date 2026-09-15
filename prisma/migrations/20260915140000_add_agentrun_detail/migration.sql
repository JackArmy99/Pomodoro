-- Per-source breakdown for a run (JSON: [{label, created, reason}]).
ALTER TABLE "AgentRun" ADD COLUMN "detail" TEXT;
