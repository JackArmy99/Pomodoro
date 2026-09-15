// Verification is bound to the revision of a finding's content that a human
// actually reviewed. Spread this into ANY update that changes what a reviewer
// would have read (summary, relevance, modules, enrichment) so a previous tick
// can never carry changed content through to a client.
export const CLEARS_VERIFICATION = {
  contentRevision: { increment: 1 },
  verified: false,
  verifiedRevision: null,
  verifiedAt: null,
} as const;

// A finding is genuinely verified only when the tick matches current content.
export function isVerifiedCurrent(finding: {
  verified: boolean;
  contentRevision: number;
  verifiedRevision: number | null;
}): boolean {
  return (
    finding.verified && finding.verifiedRevision === finding.contentRevision
  );
}
