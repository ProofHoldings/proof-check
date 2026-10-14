/**
 * The default trust entry (SC-25) lives in THIS package; the verifier ships none.
 */
import { describe, expect, it } from 'vitest';
import { verifyDelegation } from '@proof-holdings/delegation-verifier';
import { DEFAULT_API_ORIGIN, proofHoldingsTrust } from '../trust.js';

describe('proofHoldingsTrust', () => {
  it('names the issuer, its key set and its public status endpoint', () => {
    expect(DEFAULT_API_ORIGIN).toBe('https://api.proof.holdings');
    expect(proofHoldingsTrust()).toEqual({
      issuer: 'proof.holdings',
      jwksUri: 'https://api.proof.holdings/.well-known/jwks.json',
      statusEndpoint: 'https://api.proof.holdings/api/v1/proofs/validate',
    });
  });

  it('follows --api and --jwks', () => {
    expect(proofHoldingsTrust('https://staging-api.example/', 'https://keys.example/jwks.json')).toEqual({
      issuer: 'proof.holdings',
      jwksUri: 'https://keys.example/jwks.json',
      statusEndpoint: 'https://staging-api.example/api/v1/proofs/validate',
    });
  });
});

describe('the verifier itself trusts no one by default', () => {
  // Behaviour, not a text scan: the verifier's docblock shows OUR entry as a usage example, which is
  // exactly where it belongs — what matters is that nothing applies it unless a caller passes it.
  it('refuses to verify with no trusted issuers — the default lives in this CLI', async () => {
    const result = await verifyDelegation('a.b.c', { trustedIssuers: [], delegate: { type: 'purl', value: 'pkg:npm/postmark-mcp' } });
    expect(result).toMatchObject({ valid: false, reason: 'no_trust_policy' });
  });
});
