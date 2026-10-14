import type { CheckReport, CheckedToken } from './check.js';

/**
 * The text report — the only place this tool composes a sentence. Its first line names the issuer
 * the run trusted. Then one of exactly three answers: "Delegated by <domain>", "No delegation found"
 * (always followed by the places checked) or "Could not check". Nothing here judges an artifact or
 * its publisher: a delegation records who authorized it, and the absence of one is the ordinary state
 * of most packages.
 */

const RESULT_TEXT: Record<string, string> = {
  found_in_force: 'delegation found, in force',
  found_not_in_force: 'delegation found, no longer in force',
  found_other_artifact: 'delegation for a different artifact',
  found_unverifiable: 'content this issuer did not sign',
  nothing_published: 'nothing published',
  not_applicable: 'not applicable',
  unchecked: 'could not be read',
  invalid: 'did not verify',
  unconfirmed: 'could not be confirmed',
};

export const ATTESTS = 'A delegation records who authorized this artifact. It does not say the artifact is safe, audited or endorsed.';

function day(iso: string): string {
  return iso.slice(0, 10);
}

function tokenLine(token: CheckedToken): string {
  if (token.delegation) {
    const d = token.delegation;
    return `  scope ${d.scope.join(', ')} · issued ${day(d.issuedAt)} · expires ${day(d.expiresAt)} · ${d.delegationId}`;
  }
  const where = token.reportedPrincipal ? ` (reported as from ${token.reportedPrincipal})` : '';
  return `  A delegation${where} did not count here: ${token.reason ?? 'unknown'} — ${token.message ?? ''}`.trimEnd();
}

export function formatReport(report: CheckReport): string {
  const lines: string[] = [
    `Trusting issuer ${report.issuer.issuer} — keys ${report.issuer.jwksUri}${report.issuer.statusEndpoint ? `, status ${report.issuer.statusEndpoint}` : ''}`,
  ];
  if (report.delegate) lines.push(`Artifact: ${report.delegate}`);
  lines.push('');

  const verified = report.tokens.filter((token) => token.outcome === 'verified');
  const failed = report.tokens.filter((token) => token.outcome !== 'verified');

  if (report.answer === 'delegated') {
    const principals = [...new Set(verified.map((token) => token.delegation?.principal).filter(Boolean))];
    lines.push(`Delegated by ${principals.join(', ')} — verified locally.`);
    for (const token of verified) lines.push(tokenLine(token));
    lines.push(`  ${ATTESTS}`);
  } else if (report.answer === 'no_delegation_found') {
    lines.push('No delegation found — checked:');
  } else {
    lines.push(`Could not check: ${report.message ?? 'the check did not complete.'}`);
  }
  for (const token of failed) lines.push(tokenLine(token));

  if (report.locations.length > 0) {
    lines.push('');
    const when = report.checkedAt ? ` ${report.checkedAt.slice(0, 16).replace('T', ' ')} UTC` : '';
    const by = report.apiOrigin ? `, located by ${report.apiOrigin}` : '';
    lines.push(`Places checked (${when.trim() || 'time unknown'}${by}):`);
    for (const location of report.locations) {
      const result = RESULT_TEXT[location.result] ?? location.result;
      lines.push(`  - ${location.location}: ${result}${location.detail ? ` — ${location.detail}` : ''}`);
      if (location.url) lines.push(`    ${location.url}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
