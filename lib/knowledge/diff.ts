// Compare two versions of a document, locally and for free.
//
// This is the answer to "will keyword search be enough if the wording changes?"
// — change detection doesn't use search at all. A text diff catches a reworded
// sentence exactly, because a reworded sentence is simply a paragraph whose text
// no longer matches. No model call, no index, no cost.
//
// Only the paragraphs that actually changed are ever sent to a model, which is
// what makes re-checking a 300-page manual cost pennies rather than pounds.

export type DiffSegment = { ordinal: number; page: number | null; text: string };

export type Change =
  | { kind: "added"; page: number | null; text: string }
  | { kind: "removed"; page: number | null; text: string }
  | { kind: "changed"; page: number | null; before: string; after: string };

export type DiffResult = {
  changes: Change[];
  unchanged: number;
  changedChars: number;
};

// Normalise away the noise that isn't a real edit: whitespace runs, smart
// quotes, and the hyphenation PDFs introduce at line ends. Without this, a
// re-exported but unedited manual would look like it changed on every page.
export function normalise(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    // A hyphen followed by whitespace is a PDF line-break artefact
    // ("elimin- ation"), so drop it entirely rather than keeping the hyphen.
    // Both versions normalise the same way, so a genuine dash is harmless.
    .replace(/-\s+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Words for comparison purposes, with punctuation stripped: "paragraph." and
// "paragraph," are the same word, and counting them as different was enough to
// make a lightly-edited sentence read as an unrelated replacement.
function tokens(text: string): Set<string> {
  return new Set(
    text
      .split(/[^\p{L}\p{N}]+/u)
      .map((w) => w.trim())
      .filter(Boolean),
  );
}

// Similar enough to be "the same paragraph, reworded" rather than two unrelated
// paragraphs? Dice coefficient — 2×shared / total — rather than dividing by the
// longer side, which punished an added clause so heavily that "X." vs "X, and
// now some more" scored below the threshold and split into add + remove.
function similarity(a: string, b: string): number {
  const wordsA = tokens(a);
  const wordsB = tokens(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  return (2 * shared) / (wordsA.size + wordsB.size);
}

const REWORDED_THRESHOLD = 0.5;

export function diffVersions(
  before: DiffSegment[],
  after: DiffSegment[],
): DiffResult {
  // Identical paragraphs are the overwhelming majority of any real revision, so
  // match those first and only reason about what's left.
  const beforeByText = new Map<string, DiffSegment[]>();
  for (const seg of before) {
    const key = normalise(seg.text);
    const list = beforeByText.get(key);
    if (list) list.push(seg);
    else beforeByText.set(key, [seg]);
  }

  const leftoverAfter: DiffSegment[] = [];
  let unchanged = 0;

  for (const seg of after) {
    const key = normalise(seg.text);
    const matches = beforeByText.get(key);
    if (matches && matches.length > 0) {
      matches.shift();
      unchanged++;
    } else {
      leftoverAfter.push(seg);
    }
  }

  const leftoverBefore: DiffSegment[] = [];
  for (const list of beforeByText.values()) leftoverBefore.push(...list);

  // Pair up what's left: a leftover pair that's still mostly the same words is
  // an edit; anything unpaired is a genuine addition or removal.
  const changes: Change[] = [];
  const takenBefore = new Set<number>();
  let changedChars = 0;

  for (const seg of leftoverAfter) {
    const afterNorm = normalise(seg.text);
    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < leftoverBefore.length; i++) {
      if (takenBefore.has(i)) continue;
      const score = similarity(afterNorm, normalise(leftoverBefore[i].text));
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestScore >= REWORDED_THRESHOLD) {
      takenBefore.add(bestIndex);
      changes.push({
        kind: "changed",
        page: seg.page,
        before: leftoverBefore[bestIndex].text,
        after: seg.text,
      });
      changedChars += seg.text.length;
    } else {
      changes.push({ kind: "added", page: seg.page, text: seg.text });
      changedChars += seg.text.length;
    }
  }

  for (let i = 0; i < leftoverBefore.length; i++) {
    if (takenBefore.has(i)) continue;
    changes.push({
      kind: "removed",
      page: leftoverBefore[i].page,
      text: leftoverBefore[i].text,
    });
    changedChars += leftoverBefore[i].text.length;
  }

  // Report in document order so a reader can follow the revision through.
  changes.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));

  return { changes, unchanged, changedChars };
}

// What actually gets sent to a model: only the changed paragraphs, with their
// pages, never the whole manual.
export function renderChanges(changes: Change[], limit = 400): string {
  return changes
    .slice(0, limit)
    .map((c) => {
      const where = c.page ? `p${c.page}` : "?";
      if (c.kind === "changed") {
        return `[${where}] CHANGED\n  was: ${c.before}\n  now: ${c.after}`;
      }
      return `[${where}] ${c.kind.toUpperCase()}\n  ${c.text}`;
    })
    .join("\n\n");
}
