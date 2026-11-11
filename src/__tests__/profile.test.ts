/**
 * `proof-check https://proof.holdings/u/<username>` (m-public-profile-sheet, SC-11): every token the
 * profile publishes is checked HERE — real ES256 signatures, a counting fetch, the profile read served
 * as the API returns it. The read only says which tokens belong to the profile; whether each holds is
 * decided locally.
 */
import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache } from '@proof-holdings/delegation-verifier';
import { formatProfileReport } from '../format.js';
import { parseProfileUrl, runProfileCheck } from '../profile.js';
import { API, JWKS_URI, STATUS_ENDPOINT, claimAnswer, claimUrl, delegationClaims, generateKey, jwks, mockFetch, signJwt, type TestKey } from './helpers.js';

const PROFILE = 'https://proof.holdings/u/team';
const PROFILE_READ = `${API}/api/v1/profiles/u/team`;
const DELEGATE = 'pkg:npm/postmark-mcp';

let key: TestKey;
let stranger: TestKey;

function proofClaims(identifier: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'proof.holdings',
    sub: 'verification-1',
    iat: now - 60,
    exp: now + 86_400,
    proof_schema_version: '1.2',
    user_id: 'user-1',
    type: 'domain',
    channel: 'dns',
    identifier_hash: createHash('sha256').update(identifier).digest('hex'),
    verified_at: '2026-10-01T10:00:00.000Z',
    proof_id: 'ph_prf_00000000000000000000000000000001',
    ...overrides,
  };
}

function profileBody(proofs: Array<Record<string, unknown>>, delegations: unknown = []): Record<string, unknown> {
  return { profile_id: 'prof1', username: 'team', proofs, delegations, channels_complete: false };
}

beforeAll(async () => {
  key = await generateKey();
  stranger = await generateKey(key.kid);
});

beforeEach(() => resetJwksCache());

describe('parseProfileUrl', () => {
  it('reads /u/<username> and /p/<id> on proof.holdings only', () => {
    expect(parseProfileUrl('https://proof.holdings/u/team')).toEqual({ by: 'username', key: 'team' });
    expect(parseProfileUrl('https://www.proof.holdings/p/abc123/')).toEqual({ by: 'id', key: 'abc123' });
    expect(parseProfileUrl('http://proof.holdings/u/team')).toBeNull();
    expect(parseProfileUrl('https://example.com/u/team')).toBeNull();
    expect(parseProfileUrl('https://proof.holdings/u/team/extra')).toBeNull();
    expect(parseProfileUrl('pkg:npm/postmark-mcp')).toBeNull();
  });
});

describe('runProfileCheck', () => {
  it('verifies every published proof token against the value as printed, and every delegation pinned to its domain', async () => {
    const domainToken = await signJwt(proofClaims('team.management'), key);
    const handleToken = await signJwt(proofClaims('teammgmt', { type: 'social', channel: 'x' }), key);
    const delegation = await signJwt(delegationClaims({ principal: 'team.management' }), key);
    const net = mockFetch({
      [PROFILE_READ]: {
        json: profileBody(
          [
            { type: 'domain', display_value: 'team.management', proof_token: domainToken },
            { type: 'social', display_value: 'teammgmt', proof_token: handleToken },
            { type: 'phone', display_value: '+3••••••••99', proof_token: null },
          ],
          [{ delegate: DELEGATE, principal: 'team.management' }]
        ),
      },
      [JWKS_URI]: jwks(key),
      [STATUS_ENDPOINT]: { json: { valid: true } },
      [claimUrl(DELEGATE)]: { json: claimAnswer(DELEGATE, [{ token: delegation, principal: 'team.management' }]) },
    });

    const report = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: net.fetch });

    expect(report.answer).toBe('every_token_verified');
    expect(report.exitCode).toBe(0);
    expect(report.proofs.map((proof) => proof.outcome)).toEqual(['verified', 'verified', null]);
    expect(report.proofs[1].proof?.channel).toBe('x');
    expect(report.delegations).toHaveLength(1);
    expect(report.delegations[0].outcome).toBe('verified');
    const text = formatProfileReport(report);
    expect(text).toContain('domain team.management: verified locally · dns');
    expect(text).toContain('phone +3••••••••99: no token published');
    expect(text).toContain(`${DELEGATE}, from team.management: verified locally`);
  });

  it('answers 1 when a published token is about another value than the one printed beside it', async () => {
    const elsewhere = await signJwt(proofClaims('someone-else.example'), key);
    const net = mockFetch({ [PROFILE_READ]: { json: profileBody([{ type: 'domain', display_value: 'team.management', proof_token: elsewhere }]) } });

    const report = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: net.fetch });

    expect(report.answer).toBe('a_token_did_not_verify');
    expect(report.exitCode).toBe(1);
    expect(report.proofs[0]).toMatchObject({ outcome: 'invalid', reason: 'identifier_mismatch' });
    // Decided before the network: only the profile read was fetched.
    expect(net.calls).toEqual([PROFILE_READ]);
  });

  it('answers 1 when a token is signed by a key the issuer does not publish', async () => {
    const forged = await signJwt(proofClaims('team.management'), stranger);
    const net = mockFetch({
      [PROFILE_READ]: { json: profileBody([{ type: 'domain', display_value: 'team.management', proof_token: forged }]) },
      [JWKS_URI]: jwks(key),
    });

    const report = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: net.fetch });

    expect(report.exitCode).toBe(1);
    expect(report.proofs[0]).toMatchObject({ outcome: 'invalid', reason: 'bad_signature' });
  });

  it('answers 1 with nothing to check when every value is masked or hidden', async () => {
    const net = mockFetch({ [PROFILE_READ]: { json: profileBody([{ type: 'email', display_value: 'h•••@team.management', proof_token: null }]) } });

    const report = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: net.fetch });

    expect(report.answer).toBe('nothing_to_check');
    expect(report.exitCode).toBe(1);
  });

  it('answers 2 — never 1 — when the issuer status cannot be read', async () => {
    const token = await signJwt(proofClaims('team.management'), key);
    const net = mockFetch({
      [PROFILE_READ]: { json: profileBody([{ type: 'domain', display_value: 'team.management', proof_token: token }]) },
      [JWKS_URI]: jwks(key),
      [STATUS_ENDPOINT]: { status: 503, json: {} },
    });

    const report = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: net.fetch });

    expect(report.exitCode).toBe(2);
    expect(report.proofs[0].outcome).toBe('unconfirmed');
  });

  it('answers 2 when the profile cannot list its delegations (null = unknown, not none)', async () => {
    const token = await signJwt(proofClaims('team.management'), key);
    const net = mockFetch({
      [PROFILE_READ]: { json: profileBody([{ type: 'domain', display_value: 'team.management', proof_token: token }], null) },
      [JWKS_URI]: jwks(key),
      [STATUS_ENDPOINT]: { json: { valid: true } },
    });

    const report = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: net.fetch });

    expect(report.exitCode).toBe(2);
    expect(report.message).toContain('delegations');
  });

  it('answers 2 for a missing profile, an unreachable read, and an address that is not a profile', async () => {
    const missing = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: mockFetch({ [PROFILE_READ]: { status: 404, json: {} } }).fetch });
    const down = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: mockFetch({}).fetch });
    const notProfile = await runProfileCheck({ url: 'https://example.com/u/team', apiOrigin: API, fetch: mockFetch({}).fetch });

    for (const report of [missing, down, notProfile]) expect(report).toMatchObject({ exitCode: 2, answer: 'could_not_check' });
    expect(missing.message).toBe('There is no public profile at this address.');
  });

  it('a delegation whose lookup finds nothing from the listed domain is a 1', async () => {
    const otherDomain = await signJwt(delegationClaims({ principal: 'other.example' }), key);
    const net = mockFetch({
      [PROFILE_READ]: { json: profileBody([], [{ delegate: DELEGATE, principal: 'team.management' }]) },
      [JWKS_URI]: jwks(key),
      [STATUS_ENDPOINT]: { json: { valid: true } },
      [claimUrl(DELEGATE)]: { json: claimAnswer(DELEGATE, [{ token: otherDomain, principal: 'other.example' }]) },
    });

    const report = await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: net.fetch });

    expect(report.exitCode).toBe(1);
    expect(report.delegations[0].outcome).toBe('invalid');
  });
});

describe('no verdict words in a profile report', () => {
  const BANNED = ['fake', 'malicious', 'unofficial', 'official', 'unverified', 'unsafe', 'impostor', 'scam', 'legitimate'];

  it('scans every answer, as text and JSON', async () => {
    const good = await signJwt(proofClaims('team.management'), key);
    const elsewhere = await signJwt(proofClaims('someone-else.example'), key);
    const read = (proofs: Array<Record<string, unknown>>) =>
      mockFetch({ [PROFILE_READ]: { json: profileBody(proofs) }, [JWKS_URI]: jwks(key), [STATUS_ENDPOINT]: { json: { valid: true } } }).fetch;
    const reports = [
      await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: read([{ type: 'domain', display_value: 'team.management', proof_token: good }]) }),
      await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: read([{ type: 'domain', display_value: 'team.management', proof_token: elsewhere }]) }),
      await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: read([{ type: 'email', display_value: 'h•••@x.example', proof_token: null }]) }),
      await runProfileCheck({ url: PROFILE, apiOrigin: API, fetch: mockFetch({}).fetch }),
    ];
    expect(new Set(reports.map((report) => report.answer))).toEqual(
      new Set(['every_token_verified', 'a_token_did_not_verify', 'nothing_to_check', 'could_not_check'])
    );
    for (const report of reports) {
      for (const rendered of [formatProfileReport(report), JSON.stringify(report)]) {
        for (const word of BANNED) expect(new RegExp(`\\b${word}\\b`, 'i').test(rendered), `${report.answer} says "${word}"`).toBe(false);
      }
    }
  });
});
