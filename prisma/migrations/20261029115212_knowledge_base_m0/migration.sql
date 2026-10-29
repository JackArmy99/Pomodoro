-- Knowledge base M0: what kind of source each item is (and so how much it may
-- say), the Tagetik release a document version covers, and the release each
-- client runs. Column additions only: no table rebuild.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "tagetikRelease" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN "authority" INTEGER;
ALTER TABLE "KnowledgeSource" ADD COLUMN "docType" TEXT;

-- AlterTable
ALTER TABLE "SourceVersion" ADD COLUMN "release" TEXT;

-- Back-fill (mirrors defaultDocType() in lib/knowledge/authority.ts): videos
-- are webinars (tier 3), watched pages community content (tier 5). Uploaded
-- documents stay unclassified at the lowest tier until Jack says what they
-- are: an upload must never be taken for a manual by default.
UPDATE "KnowledgeSource" SET "docType" = 'webinar', "authority" = 3 WHERE "kind" IN ('youtube', 'portal_video');
UPDATE "KnowledgeSource" SET "docType" = 'community', "authority" = 5 WHERE "kind" = 'page';
UPDATE "KnowledgeSource" SET "authority" = 5 WHERE "authority" IS NULL;
