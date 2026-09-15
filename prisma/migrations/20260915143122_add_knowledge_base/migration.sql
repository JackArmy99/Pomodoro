-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL DEFAULT 'me',
    "kind" TEXT NOT NULL DEFAULT 'youtube',
    "provider" TEXT NOT NULL DEFAULT 'youtube',
    "externalId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "channel" TEXT,
    "publishedAt" DATETIME,
    "durationMs" INTEGER,
    "language" TEXT,
    "currentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SourceVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transcriptMethod" TEXT NOT NULL DEFAULT 'captions',
    "language" TEXT,
    "coverageStatus" TEXT NOT NULL DEFAULT 'complete',
    "limitations" TEXT,
    "contentHash" TEXT,
    CONSTRAINT "SourceVersion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceVersionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    CONSTRAINT "TranscriptSegment_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceVersionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "segmentOrdinalsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "KnowledgeChunk_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalysisRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceVersionId" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL DEFAULT 'v1',
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "modelConfigJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summaryJson" TEXT,
    "coverageJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisRevision_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'video',
    "state" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'validate',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" DATETIME,
    "heartbeatAt" DATETIME,
    "cancelRequestedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "budgetMicroUsd" INTEGER NOT NULL DEFAULT 1000000,
    "spentMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ResearchJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModelCall_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ResearchJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "sourceBody" TEXT,
    "effectiveDate" DATETIME,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "contentRevision" INTEGER NOT NULL DEFAULT 0,
    "verifiedRevision" INTEGER,
    "verifiedAt" DATETIME,
    "agentId" TEXT,
    "knowledgeSourceId" TEXT,
    "briefId" TEXT,
    "ownerId" TEXT NOT NULL DEFAULT 'me',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Finding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Finding_knowledgeSourceId_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "KnowledgeSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Finding" ("agentId", "aiProcessed", "briefId", "contentRevision", "createdAt", "effectiveDate", "externalId", "id", "ownerId", "publishedAt", "rawContent", "relevance", "relevanceReason", "sourceBody", "sourceType", "sourceUrl", "status", "summary", "title", "verified", "verifiedAt", "verifiedRevision") SELECT "agentId", "aiProcessed", "briefId", "contentRevision", "createdAt", "effectiveDate", "externalId", "id", "ownerId", "publishedAt", "rawContent", "relevance", "relevanceReason", "sourceBody", "sourceType", "sourceUrl", "status", "summary", "title", "verified", "verifiedAt", "verifiedRevision" FROM "Finding";
DROP TABLE "Finding";
ALTER TABLE "new_Finding" RENAME TO "Finding";
CREATE UNIQUE INDEX "Finding_externalId_key" ON "Finding"("externalId");
CREATE UNIQUE INDEX "Finding_knowledgeSourceId_key" ON "Finding"("knowledgeSourceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_provider_externalId_ownerId_key" ON "KnowledgeSource"("provider", "externalId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceVersion_sourceId_version_key" ON "SourceVersion"("sourceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_sourceVersionId_ordinal_key" ON "TranscriptSegment"("sourceVersionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_sourceVersionId_ordinal_key" ON "KnowledgeChunk"("sourceVersionId", "ordinal");
