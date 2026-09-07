-- CreateTable
CREATE TABLE "OpportunityCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "BriefModule" (
    "briefId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,

    PRIMARY KEY ("briefId", "moduleId"),
    CONSTRAINT "BriefModule_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BriefModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Opportunity" (
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
    "categoryId" TEXT,
    "ownerId" TEXT NOT NULL DEFAULT 'me',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_originBriefId_fkey" FOREIGN KEY ("originBriefId") REFERENCES "Brief" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "OpportunityCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Opportunity" ("clientId", "createdAt", "deadline", "description", "id", "likelihood", "nextStep", "originBriefId", "ownerId", "stage", "title", "updatedAt", "value") SELECT "clientId", "createdAt", "deadline", "description", "id", "likelihood", "nextStep", "originBriefId", "ownerId", "stage", "title", "updatedAt", "value" FROM "Opportunity";
DROP TABLE "Opportunity";
ALTER TABLE "new_Opportunity" RENAME TO "Opportunity";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityCategory_name_key" ON "OpportunityCategory"("name");
