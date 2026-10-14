/**
 * `--card <path|https-url>`: where a card comes from. A URL read is bounded the way the issuer's own
 * reader (`readDelegationCard`) bounds it — a time limit, the same 512 KB cap whether or not a length
 * is declared, and a refusal when the redirect chain ENDS on plaintext (`fetch` follows one, and a party
 * there could strip the token). Like the issuer's reader it checks only the final hop: a plaintext hop
 * mid-chain can still redirect elsewhere — STATED BOUND, the same one the issuer carries.
 */
import { readFileSync } from 'node:fs';
import type { FetchLike } from '@proof-holdings/delegation-verifier';

export const MAX_CARD_BYTES = 512 * 1024;
export const CARD_TIMEOUT_MS = 10_000;
const ACCEPT = 'application/json, application/*+json;q=0.9, */*;q=0.1';

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_CARD_BYTES) throw new Error('the card is larger than 512 KB');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_CARD_BYTES) {
      await reader.cancel();
      throw new Error('the card is larger than 512 KB');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function loadCard(source: string, options: { fetch?: FetchLike; timeoutMs?: number } = {}): Promise<unknown> {
  if (/^https:\/\//i.test(source)) {
    const fetchImpl = (options.fetch ?? globalThis.fetch) as unknown as typeof fetch;
    const response = await fetchImpl(source, {
      headers: { Accept: ACCEPT },
      signal: AbortSignal.timeout(options.timeoutMs ?? CARD_TIMEOUT_MS),
    });
    if (response.url && new URL(response.url).protocol !== 'https:') {
      throw new Error(`${source} redirected to an insecure address (${response.url})`);
    }
    if (!response.ok) throw new Error(`${source} answered HTTP ${response.status}`);
    return JSON.parse(await readCapped(response));
  }
  return JSON.parse(readFileSync(source, 'utf8'));
}
