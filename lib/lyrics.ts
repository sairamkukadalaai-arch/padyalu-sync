// ════════════════════════════════════════════════════════════════════════════
// LYRICS CONTENT CHECK
// ════════════════════════════════════════════════════════════════════════════

export function normalizeTelugu(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\s.,!?;:"'`~@#$%^&*()_\-+=[\]{}|\\/<>।॥]/g, "")
    .trim();
}

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
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// Returns a 0-100 similarity score. Hard floor at raw < 0.25 so a completely
// wrong poem can't get inflated by the boost curve.
export function lyricsSimilarity(transcript: string, referenceText: string): number {
  const a = normalizeTelugu(transcript);
  const b = normalizeTelugu(referenceText);
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const raw = 1 - dist / Math.max(a.length, b.length);
  if (raw < 0.25) return Math.round(raw * 40); // wrong poem: stays near 0, no boost
  const boosted = Math.pow(raw, 0.65);
  return Math.round(Math.min(1, boosted) * 100);
}

// Word-level diff between transcript and reference text.
// Each entry is a reference word tagged as correct / wrong / missed.
// correct — word matched transcript
// wrong   — close but not exact (substitution / mispronunciation)
// missed  — word absent from transcript entirely
export interface WordDiffItem {
  word: string;
  status: "correct" | "wrong" | "missed";
}

export function wordDiff(transcript: string, referenceText: string): WordDiffItem[] {
  const splitWords = (s: string) =>
    s.normalize("NFC")
      .replace(/[.,!?;:"'`~@#$%^&*()_\-+=[\]{}|\\/<>।॥]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

  const refWords = splitWords(referenceText);
  const trnWords = splitWords(transcript);
  if (refWords.length === 0) return [];
  if (trnWords.length === 0) return refWords.map(w => ({ word: w, status: "missed" }));

  // LCS alignment at word level
  const R = refWords.length, T = trnWords.length;
  const dp: number[][] = Array.from({ length: R + 1 }, () => new Array(T + 1).fill(0));
  for (let i = 1; i <= R; i++)
    for (let j = 1; j <= T; j++)
      dp[i][j] = refWords[i-1] === trnWords[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);

  // Backtrack
  const aligned: Array<{ ref: string; matched: boolean }> = [];
  let i = R, j = T;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refWords[i-1] === trnWords[j-1]) {
      aligned.unshift({ ref: refWords[i-1], matched: true }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      j--; // transcript word not in reference — skip
    } else {
      aligned.unshift({ ref: refWords[i-1], matched: false }); i--;
    }
  }

  return aligned.map(({ ref, matched }) => {
    if (matched) return { word: ref, status: "correct" };
    // Check if something phonetically close was said
    const bestSim = trnWords.reduce((acc, w) => {
      const sim = 1 - levenshtein(ref, w) / Math.max(ref.length, w.length);
      return sim > acc ? sim : acc;
    }, 0);
    return { word: ref, status: bestSim > 0.6 ? "wrong" : "missed" };
  });
}
