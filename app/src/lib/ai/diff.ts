/**
 * Small, dependency-free diffs for the AI change cards: paragraph hunks, then a word diff inside
 * each hunk. Inputs are the plain text from `documentToText` (paragraphs separated by blank lines).
 */

export type DiffOp = { type: 'eq' | 'del' | 'ins'; text: string };

export interface Hunk {
  before: string;
  after: string;
}

/** LCS over two token arrays → aligned ops. O(n·m); callers cap the size. */
function lcs(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffOp[] = [];
  const push = (type: DiffOp['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('eq', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i++]);
    } else {
      push('ins', b[j++]);
    }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return out;
}

const MAX_TOKENS = 1500;

/** Word-level diff (whitespace kept as its own tokens so the text reassembles exactly). */
export function wordDiff(before: string, after: string): DiffOp[] {
  if (before === after) return before ? [{ type: 'eq', text: before }] : [];
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return [
      ...(before ? [{ type: 'del' as const, text: before }] : []),
      ...(after ? [{ type: 'ins' as const, text: after }] : []),
    ];
  }
  return lcs(a, b);
}

const MAX_PARAGRAPHS = 600;

/** Changed paragraph ranges between two plain texts. */
export function paragraphHunks(before: string, after: string): Hunk[] {
  const a = before ? before.split(/\n{2,}/) : [];
  const b = after ? after.split(/\n{2,}/) : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (!midA.length && !midB.length) return [];
  if (midA.length > MAX_PARAGRAPHS || midB.length > MAX_PARAGRAPHS) {
    return [{ before: midA.join('\n\n'), after: midB.join('\n\n') }];
  }
  // Align paragraphs, then group each run of non-equal paragraphs into one hunk.
  const SEP = '\u0000';
  const ops = lcs(
    midA.map((p) => p + SEP),
    midB.map((p) => p + SEP),
  );
  const hunks: Hunk[] = [];
  let cur: { before: string[]; after: string[] } | null = null;
  const flush = () => {
    if (cur) hunks.push({ before: cur.before.join('\n\n'), after: cur.after.join('\n\n') });
    cur = null;
  };
  for (const op of ops) {
    const paras = op.text.split(SEP).filter((_, i, arr) => i < arr.length - 1);
    if (op.type === 'eq') {
      flush();
      continue;
    }
    cur ??= { before: [], after: [] };
    (op.type === 'del' ? cur.before : cur.after).push(...paras);
  }
  flush();
  return hunks;
}

/** FNV-1a — a short fingerprint of a document's text, to tell whether it changed since an edit. */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
