/**
 * The answer names the artifact's page on proof.holdings (m-public-profile-sheet SC-32), so a terminal user
 * can open the whole company page from it — only when the lookup asked was ours: another API's page
 * address says nothing about our site.
 */
import { describe, expect, it } from 'vitest';
import { formatReport } from '../format.js';
import { pageUrlOf } from '../check.js';
import { proofHoldingsTrust, DEFAULT_API_ORIGIN } from '../trust.js';
import type { CheckReport } from '../check.js';

describe('pageUrlOf', () => {
  it('is the proof.holdings page when the lookup asked was ours', () => {
    expect(pageUrlOf(DEFAULT_API_ORIGIN, '/npm/postmark-mcp')).toBe('https://proof.holdings/npm/postmark-mcp');
  });
  it('is null for another API, a missing path, or one that is not a site path', () => {
    expect(pageUrlOf('https://api.example.test', '/npm/postmark-mcp')).toBeNull();
    expect(pageUrlOf(DEFAULT_API_ORIGIN, null)).toBeNull();
    expect(pageUrlOf(DEFAULT_API_ORIGIN, 'https://evil.test/npm/x')).toBeNull();
    expect(pageUrlOf(DEFAULT_API_ORIGIN, '//evil.test/x')).toBeNull();
  });
});

describe('the report', () => {
  const report: CheckReport = {
    exitCode: 1, answer: 'no_delegation_found', issuer: proofHoldingsTrust(DEFAULT_API_ORIGIN), apiOrigin: DEFAULT_API_ORIGIN,
    delegate: 'pkg:npm/postmark-mcp', checkedAt: '2026-11-09T12:00:00.000Z', message: null, tokens: [], locations: [],
    pageUrl: 'https://proof.holdings/npm/postmark-mcp',
  };
  it('prints the page under the answer', () => {
    expect(formatReport(report)).toContain('Page: https://proof.holdings/npm/postmark-mcp');
  });
  it('prints no page line without one', () => {
    expect(formatReport({ ...report, pageUrl: null })).not.toContain('Page:');
  });
});
