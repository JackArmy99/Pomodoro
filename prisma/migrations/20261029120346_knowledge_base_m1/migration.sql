-- Knowledge base M1: each manual edition's table of contents (DocSection),
-- Jack's module -> topic tree (KbTopic) and the append-only audit log
-- (KbEvent). New tables plus one nullable column: no table rebuild.

-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN "moduleId" TEXT;

-- CreateTable
CREATE TABLE "DocSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceVersionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "page" INTEGER,
    "startOrdinal" INTEGER,
    "endOrdinal" INTEGER,
    "method" TEXT NOT NULL DEFAULT 'bookmarks',
    "topicId" TEXT,
    CONSTRAINT "DocSection_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocSection_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "KbTopic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KbTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdFrom" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KbTopic_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KbTopic_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KbTopic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KbEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "proposalId" TEXT,
    "sourceVersionId" TEXT,
    "moduleId" TEXT
);

-- CreateIndex
CREATE INDEX "DocSection_topicId_idx" ON "DocSection"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "DocSection_sourceVersionId_ordinal_key" ON "DocSection"("sourceVersionId", "ordinal");

-- CreateIndex
CREATE INDEX "KbTopic_moduleId_parentId_idx" ON "KbTopic"("moduleId", "parentId");

-- CreateIndex
CREATE INDEX "KbEvent_moduleId_at_idx" ON "KbEvent"("moduleId", "at");

-- CreateIndex
CREATE INDEX "KbEvent_entityType_entityId_idx" ON "KbEvent"("entityType", "entityId");

