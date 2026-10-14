import {
  canonicalizeDelegate,
  DelegateIdentifierError,
  verifyDelegation,
  verifyPublishedDelegation,
  type DelegateInput,
  type FetchLike,
  type TrustedIssuer,
  type VerificationResult,
} from '@proof-holdings/delegation-verifier';
import { DEFAULT_API_ORIGIN, proofHoldingsTrust } from './trust.js';

/**
 * The check itself (m-artifact-lookup-surface, decision 5): ask proof.holdings WHERE delegations for
 * an artifact were found, then verify every token found HERE, against the issuer's own keys, with the
 * identity taken from the command line — never from the lookup's answer and never from a card's
 * description of itself. A "delegated by" answer therefore never rests on our word: the lookup can
 * only tell this tool where to look, and a token naming another artifact fails locally.
 *
 * Three answers, three exit codes:
 *   0 `delegated`            — at least one token verified locally (and matched `--principal`);
 *   1 `no_delegation_found`  — none did, and every one that failed failed on a completed check;
 *   2 `could_not_check`      — the identifier was rejected, the lookup could not be read, or a token
 *                              could not be confirmed (keys or status unreachable). A token we could
 *                              not confirm might be valid, so it never becomes "no delegation found".
 */

export type Answer = 'delegated' | 'no_delegation_found' | 'could_not_check';
export type ExitCode = 0 | 1 | 2;

export interface CheckedLocation {
  id: string;
  location: string;
  url: string | null;
  result: string;
  reason: string | null;
  detail: string;
}

export interface CheckedToken {
  /** What the lookup said about the token — context only, never what the answer rests on. */
  reportedPrincipal: string | null;
  foundAt: string[];
  outcome: 'verified' | 'invalid' | 'unconfirmed';
  reason: string | null;
  message: string | null;
  /** Only for a token that verified: the claims its signature covers. */
  delegation: { principal: string; scope: string[]; delegationId: string; issuedAt: string; expiresAt: string } | null;
}

export interface CheckReport {
  exitCode: ExitCode;
  answer: Answer;
  /** The issuer this run trusted — printed first, every run. */
  issuer: TrustedIssuer;
  /** Where the locations were looked up; null for `--card`, which asks no one. */
  apiOrigin: string | null;
  /** The canonical identity from the command line; null when it was rejected. */
  delegate: string | null;
  checkedAt: string | null;
  /** Why the check could not run, when it could not. */
  message: string | null;
  tokens: CheckedToken[];
  locations: CheckedLocation[];
}

export interface CheckOptions {
  /** The identifier exactly as typed: `pkg:npm/<name>`, `pkg:pypi/<name>` or `https://<host><path>`. */
  delegate: string;
  apiOrigin?: string;
  jwksUri?: string;
  /** Pin the delegating domain: only a token from this domain counts. */
  principal?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: Date;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** `pkg:` → purl, `https://` → url; anything else is not an artifact identifier. */
export function parseIdentifier(raw: string): DelegateInput | null {
  const value = raw.trim();
  if (/^pkg:/i.test(value)) return { type: 'purl', value };
  if (/^https:\/\//i.test(value)) return { type: 'url', value };
  return null;
}

function canonical(raw: string): { input: DelegateInput } | { error: string } {
  const parsed = parseIdentifier(raw);
  if (!parsed) return { error: 'An artifact identifier starts with pkg: (a package, e.g. pkg:npm/postmark-mcp) or https:// (an endpoint).' };
  try {
    return { input: { type: parsed.type, value: canonicalizeDelegate(parsed) } };
  } catch (error) {
    if (error instanceof DelegateIdentifierError) return { error: error.message };
    throw error;
  }
}

function baseReport(issuer: TrustedIssuer, apiOrigin: string | null): CheckReport {
  return { exitCode: 2, answer: 'could_not_check', issuer, apiOrigin, delegate: null, checkedAt: null, message: null, tokens: [], locations: [] };
}

function couldNotCheck(report: CheckReport, message: string): CheckReport {
  return { ...report, exitCode: 2, answer: 'could_not_check', message };
}

function tokenResult(result: VerificationResult, reportedPrincipal: string | null, foundAt: string[]): CheckedToken {
  if (result.valid) {
    const { delegation } = result;
    return {
      reportedPrincipal,
      foundAt,
      outcome: 'verified',
      reason: null,
      message: null,
      delegation: {
        principal: delegation.principal,
        scope: delegation.scope,
        delegationId: delegation.delegationId,
        issuedAt: delegation.issuedAt.toISOString(),
        expiresAt: delegation.expiresAt.toISOString(),
      },
    };
  }
  return { reportedPrincipal, foundAt, outcome: result.outcome, reason: result.reason, message: result.message, delegation: null };
}

/** The answer the local outcomes support — see the module comment for why `unconfirmed` is never a negative. */
function settle(report: CheckReport): CheckReport {
  if (report.tokens.some((token) => token.outcome === 'verified')) return { ...report, exitCode: 0, answer: 'delegated' };
  const unconfirmed = report.tokens.filter((token) => token.outcome === 'unconfirmed');
  if (unconfirmed.length > 0) {
    const reasons = [...new Set(unconfirmed.map((token) => token.reason))].join(', ');
    return couldNotCheck(report, `A delegation was reported but could not be confirmed (${reasons}).`);
  }
  return { ...report, exitCode: 1, answer: 'no_delegation_found' };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

async function readJson(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function runCheck(options: CheckOptions): Promise<CheckReport> {
  const apiOrigin = (options.apiOrigin ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '');
  const issuer = proofHoldingsTrust(apiOrigin, options.jwksUri);
  const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let report = baseReport(issuer, apiOrigin);

  const identity = canonical(options.delegate);
  if ('error' in identity) return couldNotCheck(report, identity.error);
  report = { ...report, delegate: identity.input.value };

  const url = `${apiOrigin}/api/v1/artifacts/claim?type=${encodeURIComponent(identity.input.type)}&delegate=${encodeURIComponent(identity.input.value)}`;
  let read: { status: number; body: unknown };
  try {
    read = await readJson(fetchImpl, url, timeoutMs);
  } catch (error) {
    return couldNotCheck(report, `The lookup at ${apiOrigin} could not be reached (${error instanceof Error ? error.message : String(error)}).`);
  }

  const body = read.body;
  if (read.status === 400) {
    const message = isRecord(body) && isRecord(body.error) ? str(body.error.message) : null;
    return couldNotCheck(report, message ?? 'The lookup rejected the identifier.');
  }
  if (read.status !== 200 || !isRecord(body) || !Array.isArray(body.locations) || !Array.isArray(body.delegations)) {
    return couldNotCheck(report, `The lookup at ${apiOrigin} answered HTTP ${read.status} without an answer to read.`);
  }

  report = {
    ...report,
    checkedAt: str(body.checked_at),
    locations: body.locations.filter(isRecord).map((location) => ({
      id: str(location.id) ?? 'unknown',
      location: str(location.location) ?? '',
      url: str(location.url),
      result: str(location.result) ?? 'unchecked',
      reason: str(location.reason),
      detail: str(location.detail) ?? '',
    })),
  };

  // Every token is verified here, against the identity from the COMMAND LINE.
  const tokens: CheckedToken[] = [];
  for (const found of body.delegations) {
    const token = isRecord(found) ? str(found.token) : null;
    if (!isRecord(found) || !token) {
      // Told of a delegation we cannot verify: unconfirmed, like an unreachable key — skipping it would
      // turn it into "none found", and a token that did verify still answers (`settle`).
      tokens.push({
        reportedPrincipal: isRecord(found) ? str(found.principal) : null,
        foundAt: [],
        outcome: 'unconfirmed',
        reason: 'token_missing',
        message: 'The lookup listed this delegation without its token, so it could not be verified here.',
        delegation: null,
      });
      continue;
    }
    const result = await verifyDelegation(token, {
      trustedIssuers: [issuer],
      delegate: identity.input,
      ...(options.principal ? { expectedPrincipal: options.principal } : {}),
      fetch: fetchImpl,
      timeoutMs,
      ...(options.now ? { now: options.now } : {}),
    });
    const foundAt = Array.isArray(found.found_at) ? found.found_at.filter((id): id is string => typeof id === 'string') : [];
    tokens.push(tokenResult(result, str(found.principal), foundAt));
  }
  return settle({ ...report, tokens });
}

export interface CardCheckOptions extends Omit<CheckOptions, 'apiOrigin'> {
  /** The card document, already parsed. */
  card: unknown;
  /** Where the card came from, for the report. */
  source: string;
  apiOrigin?: string;
}

/**
 * `--card`: verify a locally installed or fetched card directly, asking proof.holdings nothing about
 * where to look — the card IS the location. The issuer's keys and status are still checked.
 */
export async function runCardCheck(options: CardCheckOptions): Promise<CheckReport> {
  const apiOrigin = (options.apiOrigin ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '');
  const issuer = proofHoldingsTrust(apiOrigin, options.jwksUri);
  let report = baseReport(issuer, null);

  const identity = canonical(options.delegate);
  if ('error' in identity) return couldNotCheck(report, identity.error);
  report = { ...report, delegate: identity.input.value, checkedAt: (options.now ?? new Date()).toISOString() };

  const result = await verifyPublishedDelegation(options.card, {
    trustedIssuers: [issuer],
    delegate: identity.input,
    ...(options.principal ? { expectedPrincipal: options.principal } : {}),
    fetch: options.fetch ?? (globalThis.fetch as FetchLike),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.now ? { now: options.now } : {}),
  });
  const token = tokenResult(result, null, ['card']);
  const location: CheckedLocation = {
    id: 'card',
    location: options.source,
    url: null,
    result: token.outcome === 'verified' ? 'found_in_force' : token.reason === 'no_publication' ? 'nothing_published' : token.outcome,
    reason: token.reason,
    detail: token.message ?? 'Carries a delegation for this artifact that verified.',
  };
  // A card with no publication at all is a completed check with nothing in it — not a token to report.
  const tokens = token.reason === 'no_publication' ? [] : [token];
  return settle({ ...report, tokens, locations: [location] });
}
