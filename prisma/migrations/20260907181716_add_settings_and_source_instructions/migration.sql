-- AlterTable
ALTER TABLE "Source" ADD COLUMN "instructions" TEXT;

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);
