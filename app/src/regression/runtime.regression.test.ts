import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

/**
 * Node runtime guard (PR #2 review). On Node 20, Vitest itself fails before collecting any test
 * (locked jsdom/undici need newer APIs), so a test cannot report that case; `.node-version` and
 * `engines` are the real guard. This states the intent: the Node running the suite satisfies the
 * declared `engines.node` range (the same range locked jsdom accepts).
 */
function satisfies(version: string, range: string): boolean {
  const [maj, min, pat] = version.replace(/^v/, '').split('.').map(Number);
  const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return range.split('||').some((part) => {
    const m = part.trim().match(/^(\^|>=)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!m) throw new Error(`Unsupported range part: ${part}`);
    const want = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
    const have = [maj, min, pat];
    if (cmp(have, want) < 0) return false;
    return m[1] === '>=' || have[0] === want[0];
  });
}

it('runs on a Node version inside the declared engines range', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { engines: { node: string } };
  expect(satisfies(process.versions.node, pkg.engines.node)).toBe(true);
  // The range keeps Node 22.22+ working (jsdom accepts it) and still refuses Node 20.
  expect(satisfies('22.23.0', pkg.engines.node)).toBe(true);
  expect(satisfies('20.19.0', pkg.engines.node)).toBe(false);
  expect(satisfies('24.14.0', pkg.engines.node)).toBe(false);
});
