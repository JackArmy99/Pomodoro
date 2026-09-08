-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'rss',
    "url" TEXT NOT NULL DEFAULT '',
    "query" TEXT,
    "moduleHint" TEXT,
    "instructions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Source" ("active", "createdAt", "id", "instructions", "lastFetchedAt", "moduleHint", "name", "type", "url") SELECT "active", "createdAt", "id", "instructions", "lastFetchedAt", "moduleHint", "name", "type", "url" FROM "Source";
DROP TABLE "Source";
ALTER TABLE "new_Source" RENAME TO "Source";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
