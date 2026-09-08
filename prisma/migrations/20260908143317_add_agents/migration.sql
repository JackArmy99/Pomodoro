-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mission" TEXT NOT NULL DEFAULT '',
    "archetype" TEXT NOT NULL DEFAULT 'finder',
    "briefing" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allowedDomains" TEXT,
    "blockedDomains" TEXT,
    "maxItems" INTEGER NOT NULL DEFAULT 6,
    "lookbackDays" INTEGER NOT NULL DEFAULT 30,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "medCount" INTEGER NOT NULL DEFAULT 0,
    "lowCount" INTEGER NOT NULL DEFAULT 0,
    "estCostCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "message" TEXT,
    CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "rawContent" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'rss',
    "externalId" TEXT,
    "publishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "aiProcessed" BOOLEAN NOT NULL DEFAULT false,
    "relevance" TEXT NOT NULL DEFAULT 'medium',
    "relevanceReason" TEXT,
    "agentId" TEXT,
    "briefId" TEXT,
    "ownerId" TEXT NOT NULL DEFAULT 'me',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Finding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Finding" ("aiProcessed", "briefId", "createdAt", "externalId", "id", "ownerId", "publishedAt", "rawContent", "sourceType", "sourceUrl", "status", "summary", "title") SELECT "aiProcessed", "briefId", "createdAt", "externalId", "id", "ownerId", "publishedAt", "rawContent", "sourceType", "sourceUrl", "status", "summary", "title" FROM "Finding";
DROP TABLE "Finding";
ALTER TABLE "new_Finding" RENAME TO "Finding";
CREATE UNIQUE INDEX "Finding_externalId_key" ON "Finding"("externalId");
CREATE TABLE "new_ResearchBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "agentId" TEXT,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchBrief_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ResearchBrief" ("content", "createdAt", "id", "lastRunAt", "name") SELECT "content", "createdAt", "id", "lastRunAt", "name" FROM "ResearchBrief";
DROP TABLE "ResearchBrief";
ALTER TABLE "new_ResearchBrief" RENAME TO "ResearchBrief";
CREATE TABLE "new_Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'rss',
    "url" TEXT NOT NULL DEFAULT '',
    "query" TEXT,
    "moduleHint" TEXT,
    "instructions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "agentId" TEXT,
    "lastFetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Source_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Source" ("active", "createdAt", "id", "instructions", "lastFetchedAt", "moduleHint", "name", "query", "type", "url") SELECT "active", "createdAt", "id", "instructions", "lastFetchedAt", "moduleHint", "name", "query", "type", "url" FROM "Source";
DROP TABLE "Source";
ALTER TABLE "new_Source" RENAME TO "Source";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Back-fill: a default "General Research" Finder owns any pre-existing research
-- config and findings, and inherits the old global research instructions.
INSERT INTO "Agent" ("id", "name", "mission", "archetype", "briefing", "active", "maxItems", "lookbackDays")
VALUES ('agent_default', 'General Research', 'Catch-all research beat', 'finder',
        COALESCE((SELECT "value" FROM "Setting" WHERE "key" = 'research_instructions'), ''), true, 6, 30);
UPDATE "Source" SET "agentId" = 'agent_default' WHERE "agentId" IS NULL;
UPDATE "ResearchBrief" SET "agentId" = 'agent_default' WHERE "agentId" IS NULL;
UPDATE "Finding" SET "agentId" = 'agent_default' WHERE "agentId" IS NULL;
