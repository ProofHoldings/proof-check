/**
 * `runCheck` / `runCardCheck` (SC-26/SC-27): the lookup only says WHERE; every token is verified here,
 * against a real ES256 issuer, with the identity from the command line.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache, DELEGATION_META_KEY } from '@proof-holdings/delegation-verifier';
import { runCardCheck, runCheck } from '../check.js';
import {
  API,
  JWKS_URI,
  STATUS_ENDPOINT,
  claimAnswer,
  claimUrl,
  delegationClaims,
  generateKey,
  jwks,
  mockFetch,
  signJwt,
  type TestKey,
} from './helpers.js';

let key: TestKey;
let stranger: TestKey;

beforeAll(async () => {
  key = await generateKey();
  stranger = await generateKey('someone-else');
});

beforeEach(() => {
  resetJwksCache();
});

const DELEGATE = 'pkg:npm/postmark-mcp';

async function lookupWith(tokens: Array<{ token: string; principal?: string }>, status: unknown = { valid: true }) {
  return mockFetch({
    [claimUrl(DELEGATE)]: { json: claimAnswer(DELEGATE, tokens) },
    [JWKS_URI]: jwks(key),
    [STATUS_ENDPOINT]: { json: status },
  });
}

describe('exit 0 — delegated', () => {
  it('a token found by the lookup that verifies locally', async () => {
    const token = await signJwt(delegationClaims(), key);
    const net = await lookupWith([{ token }]);
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });

    expect(report.exitCode).toBe(0);
    expect(report.answer).toBe('delegated');
    expect(report.issuer).toEqual({ issuer: 'proof.holdings', jwksUri: JWKS_URI, statusEndpoint: STATUS_ENDPOINT });
    expect(report.tokens[0]).toMatchObject({ outcome: 'verified', delegation: { principal: 'postmarkapp.com', scope: ['send-email'] } });
    expect(net.calls).toContain(STATUS_ENDPOINT);
  });

  it('--principal matching the signer still answers delegated', async () => {
    const token = await signJwt(delegationClaims(), key);
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, principal: 'postmarkapp.com', fetch: (await lookupWith([{ token }])).fetch });
    expect(report.exitCode).toBe(0);
  });

  it('asks the lookup about the CANONICAL identity', async () => {
    const token = await signJwt(delegationClaims(), key);
    const net = await lookupWith([{ token }]);
    const report = await runCheck({ delegate: 'pkg:npm/Postmark-MCP', apiOrigin: API, fetch: net.fetch });
    expect(report.delegate).toBe(DELEGATE);
    expect(net.calls[0]).toBe(claimUrl(DELEGATE));
    expect(report.exitCode).toBe(0);
  });
});

describe('exit 1 — no delegation found', () => {
  it('the lookup found nothing: every place checked is reported', async () => {
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: (await lookupWith([])).fetch });
    expect(report.exitCode).toBe(1);
    expect(report.answer).toBe('no_delegation_found');
    expect(report.locations.map((location) => location.result)).toEqual(['nothing_published']);
  });

  it('a lookup token naming another artifact exits 1 — the identity comes from argv, not the response', async () => {
    const token = await signJwt(delegationClaims({ delegate: 'pkg:npm/some-other-package' }), key);
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: (await lookupWith([{ token }])).fetch });
    expect(report.exitCode).toBe(1);
    expect(report.tokens[0]).toMatchObject({ outcome: 'invalid', reason: 'delegate_mismatch' });
  });

  it('a token signed by a key the issuer does not publish', async () => {
    const token = await signJwt(delegationClaims(), stranger);
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: (await lookupWith([{ token }])).fetch });
    expect(report.exitCode).toBe(1);
    expect(report.tokens[0].outcome).toBe('invalid');
  });

  it('an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(delegationClaims({ iat: now - 7200, exp: now - 3600 }), key);
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: (await lookupWith([{ token }])).fetch });
    expect(report.exitCode).toBe(1);
    expect(report.tokens[0]).toMatchObject({ outcome: 'invalid', reason: 'expired' });
  });

  it('a token the issuer reports revoked', async () => {
    const token = await signJwt(delegationClaims(), key);
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: (await lookupWith([{ token }], { valid: false, reason: 'revoked' })).fetch });
    expect(report.exitCode).toBe(1);
    expect(report.tokens[0].outcome).toBe('invalid');
  });

  it('--principal pins the signer: a delegation from another domain does not count', async () => {
    const token = await signJwt(delegationClaims(), key);
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, principal: 'postmark.example', fetch: (await lookupWith([{ token }])).fetch });
    expect(report.exitCode).toBe(1);
    expect(report.tokens[0].outcome).toBe('invalid');
  });
});

describe('exit 2 — could not check', () => {
  it.each([
    ['a versioned purl', 'pkg:npm/postmark-mcp@1.0.16'],
    ['something that is not an artifact identifier', 'postmark-mcp'],
    ['a plain-http endpoint', 'http://mcp.example.com'],
  ])('%s is rejected before anyone is asked', async (_label, delegate) => {
    const net = mockFetch({});
    const report = await runCheck({ delegate, apiOrigin: API, fetch: net.fetch });
    expect(report.exitCode).toBe(2);
    expect(report.answer).toBe('could_not_check');
    expect(report.message).toBeTruthy();
    expect(net.calls).toEqual([]);
  });

  it('a lookup listing a delegation without its token is unconfirmed, never "no delegation found"', async () => {
    const answer = claimAnswer(DELEGATE, [{ token: 'placeholder' }]);
    answer.delegations = [{ proof_id: 'ph_dlg_x', principal: 'postmarkapp.com', found_at: ['npm_metadata'] }];
    const net = mockFetch({ [claimUrl(DELEGATE)]: { json: answer } });
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report).toMatchObject({ exitCode: 2, answer: 'could_not_check' });
    expect(report.tokens[0]).toMatchObject({ outcome: 'unconfirmed', reason: 'token_missing', reportedPrincipal: 'postmarkapp.com' });
  });

  it('a token that verified still answers delegated beside an entry without one', async () => {
    const token = await signJwt(delegationClaims(), key);
    const answer = claimAnswer(DELEGATE, [{ token }]);
    (answer.delegations as unknown[]).push({ proof_id: 'ph_dlg_x', principal: 'other.example', found_at: [] });
    const net = mockFetch({ [claimUrl(DELEGATE)]: { json: answer }, [JWKS_URI]: jwks(key), [STATUS_ENDPOINT]: { json: { valid: true } } });
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report.exitCode).toBe(0);
  });

  it('the lookup rejects the identifier — its message is reported', async () => {
    const net = mockFetch({ [claimUrl(DELEGATE)]: { status: 400, json: { error: { code: 'invalid_delegate', message: 'not that one' } } } });
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report).toMatchObject({ exitCode: 2, message: 'not that one' });
  });

  it.each([
    ['unreachable', () => { throw new TypeError('fetch failed'); }],
    ['busy', { status: 503, json: { error: { code: 'artifact_claim_busy', message: 'busy' } } }],
    ['answering garbage', { json: { claim: 'maybe' } }],
  ] as const)('the lookup %s', async (_label, route) => {
    const net = mockFetch({ [claimUrl(DELEGATE)]: route as never });
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report.exitCode).toBe(2);
    expect(report.answer).toBe('could_not_check');
  });

  it('a found token that cannot be confirmed (keys unreachable) is never "no delegation found"', async () => {
    const token = await signJwt(delegationClaims(), key);
    const net = mockFetch({
      [claimUrl(DELEGATE)]: { json: claimAnswer(DELEGATE, [{ token }]) },
      [JWKS_URI]: { status: 503, json: {} },
    });
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report.exitCode).toBe(2);
    expect(report.tokens[0].outcome).toBe('unconfirmed');
  });

  it('one token failed and one could not be confirmed: still not a negative', async () => {
    const mismatched = await signJwt(delegationClaims({ delegate: 'pkg:npm/other' }), key);
    const good = await signJwt(delegationClaims({ jti: 'ph_jti_00000000000000000000000000000004' }), key);
    const net = mockFetch({
      [claimUrl(DELEGATE)]: { json: claimAnswer(DELEGATE, [{ token: mismatched }, { token: good }]) },
      [JWKS_URI]: jwks(key),
      [STATUS_ENDPOINT]: { status: 503, json: {} },
    });
    const report = await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report.tokens.map((token) => token.outcome)).toEqual(['invalid', 'unconfirmed']);
    expect(report.exitCode).toBe(2);
  });
});

describe('--card', () => {
  const card = (token: string) => ({ name: 'io.example/postmark', _meta: { [DELEGATION_META_KEY]: { token } } });

  it('a card carrying a delegation for this artifact verifies without asking the lookup', async () => {
    const token = await signJwt(delegationClaims(), key);
    const net = mockFetch({ [JWKS_URI]: jwks(key), [STATUS_ENDPOINT]: { json: { valid: true } } });
    const report = await runCardCheck({ card: card(token), source: './server.json', delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report.exitCode).toBe(0);
    expect(report.apiOrigin).toBeNull();
    expect(net.calls.some((url) => url.includes('/artifacts/claim'))).toBe(false);
  });

  it('a card with no publication is a completed check: no delegation found', async () => {
    const net = mockFetch({});
    const report = await runCardCheck({ card: { name: 'x' }, source: './server.json', delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report.exitCode).toBe(1);
    expect(report.locations[0]).toMatchObject({ location: './server.json', result: 'nothing_published' });
  });

  it('a card carrying a token for another artifact: no delegation found', async () => {
    const token = await signJwt(delegationClaims({ delegate: 'pkg:npm/other' }), key);
    const net = mockFetch({ [JWKS_URI]: jwks(key) });
    const report = await runCardCheck({ card: card(token), source: './server.json', delegate: DELEGATE, apiOrigin: API, fetch: net.fetch });
    expect(report.exitCode).toBe(1);
  });
});
