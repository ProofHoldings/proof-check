/**
 * The words the text report prints for what the lookup and the local check found
 * (h-docs-key-rotation-public-texts SC-5, SC-6). `found_unverifiable` is what the lookup marks a place
 * with both for content proof.holdings did not sign AND for a token naming one of its revoked keys,
 * which it did sign — so the label says only what holds for both. A verified token's date is its
 * `iat`, which a key-rotation re-sign moves: it is the signing time, not the issuance.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { resetJwksCache } from '@proof-holdings/delegation-verifier';
import { runCheck, type CheckReport } from '../check.js';
import { formatReport } from '../format.js';
import { proofHoldingsTrust } from '../trust.js';
import { API, JWKS_URI, STATUS_ENDPOINT, claimAnswer, claimUrl, delegationClaims, generateKey, jwks, mockFetch, signJwt } from './helpers.js';

const KEY_REVOKED_DETAIL =
  'Carries a token that names a revoked Proof Holdings signing key, so it was not checked further; if its delegation is still active, Proof Holdings serves its current token to replace it.';

function reportWithPlace(result: string, detail: string): CheckReport {
  return {
    exitCode: 1,
    answer: 'no_delegation_found',
    issuer: proofHoldingsTrust(API),
    apiOrigin: API,
    delegate: 'pkg:npm/@proof-holdings/mcp-server',
    checkedAt: '2026-10-18T12:00:00.000Z',
    message: null,
    tokens: [],
    locations: [{ id: 'mcp_registry', location: 'The MCP registry entry', url: null, result, reason: null, detail }],
  };
}

describe('a place the lookup marks found_unverifiable', () => {
  const text = formatReport(reportWithPlace('found_unverifiable', KEY_REVOKED_DETAIL));

  it('is labelled with what holds for unsigned content and a revoked-key token alike', () => {
    expect(text).toContain('not a delegation this issuer can verify');
  });

  it('never says the issuer did not sign it — beside a detail saying the issuer did', () => {
    expect(text).not.toContain('did not sign');
    expect(text).toContain(KEY_REVOKED_DETAIL);
  });
});

describe('a verified token', () => {
  let text: string;

  beforeAll(async () => {
    const key = await generateKey();
    const token = await signJwt(delegationClaims(), key);
    const delegate = 'pkg:npm/postmark-mcp';
    const { fetch } = mockFetch({
      [claimUrl(delegate)]: { json: claimAnswer(delegate, [{ token }]) },
      [JWKS_URI]: jwks(key),
      [STATUS_ENDPOINT]: { json: { valid: true } },
    });
    resetJwksCache();
    const report = await runCheck({ delegate, apiOrigin: API, fetch });
    expect(report.answer).toBe('delegated');
    text = formatReport(report);
  });

  it('prints its iat as the signing date, not as an issuance', () => {
    expect(text).toMatch(/^ {2}signed \d{4}-\d{2}-\d{2} · expires /m);
    expect(text).not.toContain('scope');
    expect(text).not.toContain('· issued ');
  });
});
