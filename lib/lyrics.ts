// ════════════════════════════════════════════════════════════════════════════
// LYRICS CONTENT CHECK
// The original scoring pipeline (see runRealAnalysis in app/page.tsx) only ever
// compared timing/energy/pitch between the reference and the user's recording —
// it never checked whether the actual WORDS were right, which is how a
// recording with completely wrong lyrics could still score high. This module
// fixes that: it normalizes Telugu text and computes an edit-distance based
// similarity between a speech-to-text transcript and the poem's reference text.
// ════════════════════════════════════════════════════════════════════════════

// Strip whitespace and punctuation so differences in spacing/punctuation
// between the STT transcript and the poem's reference text don't get counted
// as content mismatches.
export function normalizeTelugu(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\s.,!?;:"'`~@#$%^&*()_\-+=[\]{}|\\/<>।॥]/g, "")
    .trim();
}

// Classic Levenshtein edit distance (insert/delete/substitute), operated on
// at the character level — appropriate here since Telugu is a syllabic script
// where most "word" boundaries don't carry the same meaning as in English.
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        prev[j] + 1,      // deletion
        cur[j - 1] + 1,    // insertion
        prev[j - 1] + cost // substitution
      );
    }
    prev = cur;
  }
  return prev[n];
}

// Returns a 0-100 similarity score between a recognized transcript and the
// poem's reference text. 100 = identical (after normalization), 0 = completely
// different. Used to penalize recordings where the rhythm/timing matched but
// the actual words recited were wrong.
export function lyricsSimilarity(transcript: string, referenceText: string): number {
  const a = normalizeTelugu(transcript);
  const b = normalizeTelugu(referenceText);
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const raw = 1 - dist / Math.max(a.length, b.length);
  // Apply a gentle curve: character-level Levenshtein is strict for Telugu
  // (diacritics, conjuncts) so boost scores — e.g. raw 0.55 → ~72, raw 0.75 → ~86
  const boosted = Math.pow(Math.max(0, raw), 0.65);
  return Math.round(Math.min(1, boosted) * 100);
}
