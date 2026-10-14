/**
 * A real ES256 issuer for the tests — WebCrypto keys, real signatures, a real JWKS — and a routing
 * fetch that records every call, so a case can prove a rejection asked no one.
 */
import type { FetchLike } from '@proof-holdings/delegation-verifier';

export const API = 'https://api.test';
export const JWKS_URI = `${API}/.well-known/jwks.json`;
export const STATUS_ENDPOINT = `${API}/api/v1/proofs/validate`;

export interface TestKey {
  kid: string;
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
}

export async function generateKey(kid = 'es256-test-1'): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, publicJwk: { ...publicJwk, kid, alg: 'ES256', use: 'sig' }, privateKey: pair.privateKey };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const segment = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

export async function signJwt(payload: Record<string, unknown>, key: TestKey): Promise<string> {
  const input = `${segment({ alg: 'ES256', typ: 'JWT', kid: key.kid })}.${segment(payload)}`;
  // WebCrypto's ECDSA signature is the raw r||s form JWS uses.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(input));
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

export function delegationClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'proof.holdings',
    sub: 'ph_dlg_00000000000000000000000000000001',
    iat: now - 60,
    exp: now + 86_400,
    token_type: 'delegation',
    delegation_schema_version: '1.0',
    user_id: 'user-1',
    principal: 'postmarkapp.com',
    delegate: 'pkg:npm/postmark-mcp',
    scope: ['send-email'],
    control_proof: 'ph_ctl_00000000000000000000000000000002',
    proof_id: 'ph_dlg_00000000000000000000000000000001',
    jti: 'ph_jti_00000000000000000000000000000003',
    ...overrides,
  };
}

export function claimUrl(delegate: string, type = 'purl'): string {
  return `${API}/api/v1/artifacts/claim?type=${type}&delegate=${encodeURIComponent(delegate)}`;
}

/** A claim answer as the lookup returns it. */
export function claimAnswer(delegate: string, tokens: Array<{ token: string; principal?: string }>): Record<string, unknown> {
  const checked = '2026-10-08T12:00:00.000Z';
  return {
    delegate,
    delegate_type: delegate.startsWith('https://') ? 'url' : 'purl',
    artifact_path: null,
    claim: tokens.length > 0 ? 'claimed' : 'no_claim_found',
    checked_at: checked,
    locations: [
      {
        id: 'npm_metadata',
        location: "The npm registry's manifest for postmark-mcp (latest published version)",
        url: 'https://registry.npmjs.org/postmark-mcp/latest',
        result: tokens.length > 0 ? 'found_in_force' : 'nothing_published',
        reason: null,
        detail: 'Read; it carries no delegation in any of the sanctioned slots.',
        checked_at: checked,
      },
    ],
    delegations: tokens.map(({ token, principal }) => ({
      principal: principal ?? 'postmarkapp.com',
      proof_id: 'ph_dlg_00000000000000000000000000000001',
      scope: ['send-email'],
      issued_at: checked,
      expires_at: '2027-10-08T00:00:00.000Z',
      token,
      found_at: ['npm_metadata'],
      profile: null,
    })),
    listing: null,
  };
}

type Route = { status?: number; json?: unknown } | (() => never);

export interface MockFetch {
  fetch: FetchLike;
  calls: string[];
}

/** Routing fetch keyed on the full URL. An unrouted URL throws — an unexpected request fails loudly. */
export function mockFetch(routes: Record<string, Route>): MockFetch {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch: ${url}`);
    if (typeof route === 'function') return route();
    return new Response(JSON.stringify(route.json ?? null), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchImpl, calls };
}

export const jwks = (...keys: TestKey[]) => ({ json: { keys: keys.map((key) => key.publicJwk) } });
