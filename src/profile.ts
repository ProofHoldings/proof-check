import * as verifier from '@proof-holdings/delegation-verifier';
import type { FetchLike, TrustedIssuer } from '@proof-holdings/delegation-verifier';
import { runCheck, type CheckReport, type ExitCode } from './check.js';
import { DEFAULT_API_ORIGIN, proofHoldingsTrust } from './trust.js';

/**
 * `proof-check https://proof.holdings/u/<username>` (m-public-profile-sheet, SC-11): read a public
 * profile, then check HERE every token it publishes — each proof token against the issuer's keys and
 * the value exactly as the profile prints it, each delegation through the same lookup-and-verify as
 * `proof-check <artifact>`, pinned to the domain the profile lists it under.
 *
 * The value is hashed AS PRINTED, never rewritten into a canonical form: the profile publishes a proof's
 * token only when the printed value is byte for byte the one the token was issued for
 * (`publishableProofTokens`), so a genuine token cannot fail on formatting, and a value printed any
 * other way carries no token at all.
 *
 * What the profile read itself is trusted for: which tokens belong to this profile — the same thing the
 * page shows. What it is never trusted for: whether a token holds. That is decided here.
 *
 * Four answers, three exit codes:
 *   0 `every_token_verified`     — at least one token, and every one verified locally;
 *   1 `a_token_did_not_verify`   — some token completed its check with a negative answer;
 *   1 `nothing_to_check`         — the profile publishes no token (every value masked or hidden);
 *   2 `could_not_check`          — the profile could not be read, or a token could not be confirmed.
 */

export type ProfileAnswer = 'every_token_verified' | 'a_token_did_not_verify' | 'nothing_to_check' | 'could_not_check';
export type TokenOutcome = 'verified' | 'invalid' | 'unconfirmed';

export interface CheckedProof {
  type: string;
  /** The value as the profile prints it. */
  value: string;
  /** Null when the profile publishes no token for this value (it is masked or hidden). */
  outcome: TokenOutcome | null;
  reason: string | null;
  message: string | null;
  /** Only for a proof that verified: what its signature covers. */
  proof: { channel: string | null; verifiedAt: string | null; expiresAt: string } | null;
}

export interface CheckedProfileDelegation {
  delegate: string;
  /** The domain the profile lists this delegation under — the pin it is checked with. */
  principal: string;
  outcome: TokenOutcome;
  check: CheckReport;
}

export interface ProfileReport {
  exitCode: ExitCode;
  answer: ProfileAnswer;
  issuer: TrustedIssuer;
  apiOrigin: string;
  /** The profile address as typed. */
  profile: string;
  message: string | null;
  proofs: CheckedProof[];
  delegations: CheckedProfileDelegation[];
}

export interface ProfileCheckOptions {
  /** `https://proof.holdings/u/<username>` or `https://proof.holdings/p/<id>`. */
  url: string;
  apiOrigin?: string;
  jwksUri?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: Date;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const PROFILE_HOSTS = new Set(['proof.holdings', 'www.proof.holdings']);

/** `/u/<username>` → by username, `/p/<id>` → by id; null for anything that is not a profile address. */
export function parseProfileUrl(raw: string): { by: 'username' | 'id'; key: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PROFILE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = /^\/(u|p)\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  return { by: match[1] === 'u' ? 'username' : 'id', key: decodeURIComponent(match[2]) };
}

// `verifyProofToken` arrived in verifier 0.2.3. Looked up at run time so this package still builds and
// runs against an older installed verifier — where a profile check answers "could not check" rather
// than failing to compile, the same bridge `check.ts` uses for `unsupported_version`.
interface ProofResult {
  valid: boolean;
  reason?: string;
  outcome?: TokenOutcome;
  message?: string;
  proof?: { channel: string | null; verifiedAt: Date | null; expiresAt: Date };
}
type VerifyProofToken = (token: string, options: Record<string, unknown>) => Promise<ProofResult>;
const verifyProofToken = (verifier as unknown as { verifyProofToken?: VerifyProofToken }).verifyProofToken;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function couldNotCheck(report: ProfileReport, message: string): ProfileReport {
  return { ...report, exitCode: 2, answer: 'could_not_check', message };
}

async function readProfile(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function delegationOutcome(check: CheckReport): TokenOutcome {
  if (check.answer === 'delegated') return 'verified';
  return check.answer === 'no_delegation_found' ? 'invalid' : 'unconfirmed';
}

export async function runProfileCheck(options: ProfileCheckOptions): Promise<ProfileReport> {
  const apiOrigin = (options.apiOrigin ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '');
  const issuer = proofHoldingsTrust(apiOrigin, options.jwksUri);
  const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let report: ProfileReport = {
    exitCode: 2,
    answer: 'could_not_check',
    issuer,
    apiOrigin,
    profile: options.url,
    message: null,
    proofs: [],
    delegations: [],
  };

  const address = parseProfileUrl(options.url);
  if (!address) return couldNotCheck(report, 'A profile address is https://proof.holdings/u/<username> or https://proof.holdings/p/<id>.');

  const readUrl = `${apiOrigin}/api/v1/profiles/${address.by === 'username' ? 'u' : 'p'}/${encodeURIComponent(address.key)}`;
  let read: { status: number; body: unknown };
  try {
    read = await readProfile(fetchImpl, readUrl, timeoutMs);
  } catch (error) {
    return couldNotCheck(report, `The profile at ${apiOrigin} could not be reached (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (read.status === 404) return couldNotCheck(report, 'There is no public profile at this address.');
  const body = read.body;
  if (read.status !== 200 || !isRecord(body) || !Array.isArray(body.proofs)) {
    return couldNotCheck(report, `The profile at ${apiOrigin} answered HTTP ${read.status} without a profile to read.`);
  }

  const proofs: CheckedProof[] = [];
  for (const entry of body.proofs.filter(isRecord)) {
    const type = str(entry.type) ?? 'unknown';
    const value = str(entry.display_value) ?? '';
    const token = str(entry.proof_token);
    if (!token) {
      proofs.push({ type, value, outcome: null, reason: null, message: null, proof: null });
      continue;
    }
    if (!verifyProofToken) {
      proofs.push({
        type,
        value,
        outcome: 'unconfirmed',
        reason: 'verifier_too_old',
        message: 'The installed @proof-holdings/delegation-verifier cannot read proof tokens (0.2.3 or later can).',
        proof: null,
      });
      continue;
    }
    const result = await verifyProofToken(token, {
      trustedIssuers: [issuer],
      expected: { type, identifier: value },
      fetch: fetchImpl,
      timeoutMs,
      ...(options.now ? { now: options.now } : {}),
    });
    proofs.push(
      result.valid && result.proof
        ? {
            type,
            value,
            outcome: 'verified',
            reason: null,
            message: null,
            proof: {
              channel: result.proof.channel,
              verifiedAt: result.proof.verifiedAt ? result.proof.verifiedAt.toISOString() : null,
              expiresAt: result.proof.expiresAt.toISOString(),
            },
          }
        : { type, value, outcome: result.outcome ?? 'invalid', reason: result.reason ?? null, message: result.message ?? null, proof: null }
    );
  }

  // `delegations: null` means the profile could not say ("unknown"), which is not "none".
  const delegations: CheckedProfileDelegation[] = [];
  let delegationsUnknown = false;
  if (body.delegations === null) {
    delegationsUnknown = true;
  } else if (Array.isArray(body.delegations)) {
    for (const entry of body.delegations.filter(isRecord)) {
      const delegate = str(entry.delegate);
      const principal = str(entry.principal);
      if (!delegate || !principal) continue;
      const check = await runCheck({
        delegate,
        principal,
        apiOrigin,
        ...(options.jwksUri ? { jwksUri: options.jwksUri } : {}),
        fetch: fetchImpl,
        timeoutMs,
        ...(options.now ? { now: options.now } : {}),
      });
      delegations.push({ delegate, principal, outcome: delegationOutcome(check), check });
    }
  }

  report = { ...report, proofs, delegations };
  const outcomes = [...proofs.map((proof) => proof.outcome), ...delegations.map((delegation) => delegation.outcome)].filter(
    (outcome): outcome is TokenOutcome => outcome !== null
  );
  // As for an artifact: a token that could not be confirmed might be valid, so it never becomes a 1.
  if (outcomes.includes('unconfirmed')) {
    return couldNotCheck(report, 'A token could not be confirmed — the issuer keys or status could not be read.');
  }
  if (delegationsUnknown) {
    return couldNotCheck(report, 'The profile could not list its delegations just now, so they were not checked.');
  }
  if (outcomes.includes('invalid')) return { ...report, exitCode: 1, answer: 'a_token_did_not_verify' };
  if (outcomes.length === 0) return { ...report, exitCode: 1, answer: 'nothing_to_check' };
  return { ...report, exitCode: 0, answer: 'every_token_verified' };
}
