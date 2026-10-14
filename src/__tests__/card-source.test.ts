/**
 * `--card <path|https-url>` — where the card comes from (code review, round 2). A URL read is bounded
 * the way the issuer's own reader is: a time limit, a size cap whether or not the server declares a
 * length, and no plaintext hop at the end of a redirect chain.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_CARD_BYTES, loadCard } from '../card-source.js';
import type { FetchLike } from '@proof-holdings/delegation-verifier';

const URL_ = 'https://mcp.example.com/.well-known/mcp/server-card.json';

function answer(body: ReadableStream<Uint8Array> | string, init: { url?: string; status?: number; length?: number } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (init.length !== undefined) headers.set('content-length', String(init.length));
  const stream = typeof body === 'string' ? new Response(body).body : body;
  return { ok: (init.status ?? 200) < 300, status: init.status ?? 200, url: init.url ?? URL_, headers, body: stream } as unknown as Response;
}

const serving = (response: Response): FetchLike => (async () => response) as unknown as FetchLike;

function endless(signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":'));
      signal?.addEventListener('abort', () => controller.error(signal.reason));
    },
  });
}

describe('loadCard', () => {
  it('reads a card from a URL', async () => {
    await expect(loadCard(URL_, { fetch: serving(answer('{"name":"x"}')) })).resolves.toEqual({ name: 'x' });
  });

  it('refuses a body over the cap even when no length is declared', async () => {
    const big = `{"pad":"${'x'.repeat(MAX_CARD_BYTES)}"}`;
    await expect(loadCard(URL_, { fetch: serving(answer(big)) })).rejects.toThrow('larger than 512 KB');
  });

  it('refuses a declared length over the cap before reading', async () => {
    await expect(loadCard(URL_, { fetch: serving(answer('{}', { length: MAX_CARD_BYTES + 1 })) })).rejects.toThrow('larger than 512 KB');
  });

  it('gives up on a body that stalls past the time limit', async () => {
    const fetch = (async (_url: string, init?: { signal?: AbortSignal }) => answer(endless(init?.signal))) as unknown as FetchLike;
    await expect(loadCard(URL_, { fetch, timeoutMs: 50 })).rejects.toThrow();
  });

  it('refuses a redirect chain that ends on plaintext, as the issuer reader does', async () => {
    const fetch = serving(answer('{"name":"x"}', { url: 'http://mcp.example.com/card.json' }));
    await expect(loadCard(URL_, { fetch })).rejects.toThrow('insecure address');
  });

  it('reads a local file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proof-check-card-'));
    const file = join(dir, 'server.json');
    writeFileSync(file, '{"name":"local"}');
    await expect(loadCard(file)).resolves.toEqual({ name: 'local' });
  });
});
