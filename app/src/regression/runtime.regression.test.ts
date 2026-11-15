import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';

it('starts the pinned jsdom dependency in a fresh Node worker (CI runtime regression)', async () => {
  // CI on Node 20 failed before collecting any tests: undici's CacheStorage needs newer
  // runtime APIs. Exercise a clean process context rather than Vitest's already loaded DOM.
  const jsdomPath = createRequire(import.meta.url).resolve('jsdom');
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { JSDOM } = require(workerData);
    const dom = new JSDOM('<p data-doc-id="chapter-1">বাংলা manuscript</p>');
    parentPort.postMessage(dom.window.document.querySelector('[data-doc-id="chapter-1"]').textContent);
    dom.window.close();
  `, { eval: true, workerData: jsdomPath });
  try {
    const content = await new Promise<string>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => { if (code !== 0) reject(new Error(`DOM worker exited: ${code}`)); });
    });
    expect(content).toBe('বাংলা manuscript');
  } finally {
    await worker.terminate();
  }
});
