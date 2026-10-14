import type { TrustedIssuer } from '@proof-holdings/delegation-verifier';

/**
 * The issuer this CLI trusts by default — held HERE, in the CLI, and deliberately not in
 * `@proof-holdings/delegation-verifier`, which ships no default trust: the verifier is the
 * issuer-agnostic library a non-customer runs, and whom to trust is the caller's decision. This tool
 * is the caller, and it states the decision on its first line of output every run.
 *
 * Same shape as the MCP server's `proofHoldingsTrust` (`mcp/src/tools/delegation-verify.ts`): the
 * JWKS for signatures, and `/api/v1/proofs/validate` — the public surface that resolves the
 * control-proof cascade, since a delegation is worth no more than the domain proof under it.
 */
export const DEFAULT_API_ORIGIN = 'https://api.proof.holdings';

export function proofHoldingsTrust(apiOrigin: string = DEFAULT_API_ORIGIN, jwksUri?: string): TrustedIssuer {
  const origin = apiOrigin.replace(/\/+$/, '');
  return {
    issuer: 'proof.holdings',
    jwksUri: jwksUri ?? `${origin}/.well-known/jwks.json`,
    statusEndpoint: `${origin}/api/v1/proofs/validate`,
  };
}
