-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'active',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "notes" TEXT,
    "ownerId" TEXT NOT NULL DEFAULT 'me',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Brief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "publishedAt" DATETIME,
    "ownerId" TEXT NOT NULL DEFAULT 'me',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BriefClient" (
    "briefId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    PRIMARY KEY ("briefId", "clientId"),
    CONSTRAINT "BriefClient_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BriefClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'open',
    "value" INTEGER,
    "likelihood" INTEGER,
    "nextStep" TEXT,
    "deadline" DATETIME,
    "originBriefId" TEXT,
    "ownerId" TEXT NOT NULL DEFAULT 'me',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_originBriefId_fkey" FOREIGN KEY ("originBriefId") REFERENCES "Brief" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
