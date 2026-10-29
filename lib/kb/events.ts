import type { PrismaClient, Prisma } from "@prisma/client";

// The knowledge base's audit log: "where it's gone to and from".
//
// APPEND-ONLY. This file is the only place that writes KbEvent, and it only
// ever creates rows. Nothing anywhere updates or deletes one — `npm run test:kb`
// searches the code to make sure that stays true.

type Db = PrismaClient | Prisma.TransactionClient;

export type KbEventInput = {
  actor: string; // "jack" | a job id
  entityType: "topic" | "section" | "statement" | "proposal" | "tree";
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  proposalId?: string | null;
  sourceVersionId?: string | null;
  moduleId?: string | null;
};

function row(e: KbEventInput) {
  return {
    actor: e.actor,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    beforeJson: e.before === undefined ? null : JSON.stringify(e.before),
    afterJson: e.after === undefined ? null : JSON.stringify(e.after),
    proposalId: e.proposalId ?? null,
    sourceVersionId: e.sourceVersionId ?? null,
    moduleId: e.moduleId ?? null,
  };
}

export async function logEvent(db: Db, e: KbEventInput): Promise<void> {
  await db.kbEvent.create({ data: row(e) });
}

export async function logEvents(db: Db, events: KbEventInput[]): Promise<void> {
  if (events.length) await db.kbEvent.createMany({ data: events.map(row) });
}
