/**
 * `@proof-holdings/proof-check` — the programmatic half of the `proof-check` CLI: ask proof.holdings
 * where delegations for an artifact were found, then verify every token locally.
 */
export { runCheck, runCardCheck, parseIdentifier } from './check.js';
export type { Answer, CardCheckOptions, CheckOptions, CheckReport, CheckedLocation, CheckedToken, ExitCode } from './check.js';
export { formatReport, ATTESTS } from './format.js';
export { DEFAULT_API_ORIGIN, proofHoldingsTrust } from './trust.js';
