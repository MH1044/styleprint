export interface DiffToken {
  text: string;
  changed: boolean;
}

/** Small word-level LCS diff, just for the wizard's highlight view. */
export function wordDiff(original: string, rewritten: string): DiffToken[] {
  const a = original.split(/(\s+)/).filter(Boolean);
  const b = rewritten.split(/(\s+)/).filter(Boolean);

  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      tokens.push({ text: b[j], changed: false });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      tokens.push({ text: b[j], changed: true });
      j++;
    }
  }
  while (j < n) {
    tokens.push({ text: b[j], changed: true });
    j++;
  }

  return tokens;
}
