/**
 * The bridge to an older installed verifier (SC-11): `verifyProofToken` arrived in verifier 0.2.3, and
 * this package still builds against 0.2.0. With it missing, a profile's proof token is "could not be
 * confirmed" — exit 2 — never "did not verify".
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@proof-holdings/delegation-verifier', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  // A real 0.2.0 namespace has no such key, which reads as undefined; vitest's mock throws on a missing
  // key instead, so the absence is spelled out.
  return { ...actual, verifyProofToken: undefined };
});

describe('an installed verifier older than 0.2.3', () => {
  it('answers could_not_check for a published proof token, naming the version that can read it', async () => {
    const { runProfileCheck } = await import('../profile.js');
    const fetchImpl = async () =>
      new Response(JSON.stringify({ proofs: [{ type: 'domain', display_value: 'team.management', proof_token: 'a.b.c' }], delegations: [] }), { status: 200 });

    const report = await runProfileCheck({ url: 'https://proof.holdings/u/team', apiOrigin: 'https://api.test', fetch: fetchImpl });

    expect(report.exitCode).toBe(2);
    expect(report.proofs[0]).toMatchObject({ outcome: 'unconfirmed', reason: 'verifier_too_old' });
    expect(report.proofs[0].message).toContain('0.2.3');
  });
});
