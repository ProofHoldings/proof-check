/**
 * The CLI's half of the copy guard (SC-17): every report it can print — delegated, no delegation
 * found, could not check, and the card check — rendered from REAL runs, so the verifier's own failure
 * messages are inside the scan too. None may carry a verdict word, or a count or ratio of claimed
 * artifacts. The web half is `web/__tests__/artifact-copy-guard.test.ts`, with the same list.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DELEGATION_META_KEY, resetJwksCache } from '@proof-holdings/delegation-verifier';
import { runCardCheck, runCheck, type CheckReport } from '../check.js';
import { formatReport } from '../format.js';
import { API, JWKS_URI, STATUS_ENDPOINT, claimAnswer, claimUrl, delegationClaims, generateKey, jwks, mockFetch, signJwt, type TestKey } from './helpers.js';

const BANNED = ['fake', 'malicious', 'unofficial', 'official', 'unverified', 'unsafe', 'impostor', 'scam', 'legitimate'];
const DELEGATE = 'pkg:npm/postmark-mcp';

let key: TestKey;
const reports: Array<[string, CheckReport]> = [];

beforeAll(async () => {
  key = await generateKey();
  const good = await signJwt(delegationClaims(), key);
  const other = await signJwt(delegationClaims({ delegate: 'pkg:npm/other' }), key);
  const lookup = (tokens: Array<{ token: string }>, extra: Record<string, unknown> = {}) =>
    mockFetch({ [claimUrl(DELEGATE)]: { json: claimAnswer(DELEGATE, tokens) }, [JWKS_URI]: jwks(key), [STATUS_ENDPOINT]: { json: { valid: true } }, ...extra });

  resetJwksCache();
  reports.push(['delegated', await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: lookup([{ token: good }]).fetch })]);
  resetJwksCache();
  reports.push(['no delegation found', await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: lookup([]).fetch })]);
  resetJwksCache();
  reports.push(['a token for another artifact', await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: lookup([{ token: other }]).fetch })]);
  resetJwksCache();
  reports.push(['could not check (lookup down)', await runCheck({ delegate: DELEGATE, apiOrigin: API, fetch: mockFetch({ [claimUrl(DELEGATE)]: { status: 503, json: {} } }).fetch })]);
  reports.push(['could not check (rejected identifier)', await runCheck({ delegate: 'pkg:npm/x@1.0.0', apiOrigin: API, fetch: mockFetch({}).fetch })]);
  resetJwksCache();
  reports.push(['card', await runCardCheck({ card: { _meta: { [DELEGATION_META_KEY]: { token: good } } }, source: './server.json', delegate: DELEGATE, apiOrigin: API, fetch: lookup([]).fetch })]);
});

beforeEach(() => resetJwksCache());

describe('no verdict, no tally', () => {
  it('covers all three answers', () => {
    expect(new Set(reports.map(([, report]) => report.answer))).toEqual(new Set(['delegated', 'no_delegation_found', 'could_not_check']));
  });

  it('no report, as text or JSON, carries a verdict word', () => {
    for (const [label, report] of reports) {
      for (const rendered of [formatReport(report), JSON.stringify(report)]) {
        for (const word of BANNED) {
          expect(new RegExp(`\\b${word}\\b`, 'i').test(rendered), `${label} says "${word}"`).toBe(false);
        }
      }
    }
  });

  it('no report counts claimed artifacts', () => {
    for (const [label, report] of reports) {
      const text = formatReport(report);
      expect(/\d+\s*(of|\/)\s*\d+/.test(text) || /\d+(\.\d+)?\s*%/.test(text), `${label} carries a ratio`).toBe(false);
    }
  });

  it('the negative names the places it is about; the positive names the signer', () => {
    const byLabel = Object.fromEntries(reports.map(([label, report]) => [label, formatReport(report)]));
    expect(byLabel['no delegation found']).toMatch(/^No delegation found — checked:$/m);
    expect(byLabel['no delegation found']).toContain('Places checked');
    expect(byLabel.delegated).toMatch(/^Delegated by postmarkapp\.com — verified locally\.$/m);
    expect(byLabel.delegated.split('\n')[0]).toMatch(/^Trusting issuer proof\.holdings — keys /);
  });
});
