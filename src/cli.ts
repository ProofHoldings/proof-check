#!/usr/bin/env node
/**
 * `proof-check` — has a domain published a Proof of Delegation for this package or endpoint?
 *
 * Usage:
 *   proof-check <identifier> [--principal <domain>] [--json] [--api <origin>] [--jwks <url>]
 *   proof-check <identifier> --card <path-or-https-url> [--principal <domain>] [--json]
 *
 * `<identifier>` is `pkg:npm/<name>`, `pkg:pypi/<name>` or `https://<host><path>`, and it is the ONLY
 * source of the identity checked: every token found is verified against it locally. Exit codes:
 * 0 delegated, 1 no delegation found, 2 could not check (including a usage error — 1 is reserved for
 * the answer, so a typo can never read as "no delegation found").
 */

import { loadCard } from './card-source.js';
import { runCardCheck, runCheck, type CheckReport } from './check.js';
import { formatReport } from './format.js';

const USAGE = `Usage: proof-check <identifier> [options]

Has a domain published a Proof of Delegation for this artifact? The places are looked up at
proof.holdings, and every token found is verified here, against the issuer's keys and the
identifier you typed.

  <identifier>          pkg:npm/<name>, pkg:pypi/<name> or https://<host><path>

Options:
  --principal <domain>  only count a delegation from this domain
  --card <path|url>     verify a card you already have (a local file or an https URL) instead
  --json                print the report as JSON
  --api <origin>        lookup and status origin (default https://api.proof.holdings)
  --jwks <url>          the issuer's key set (default <api>/.well-known/jwks.json)
  -h, --help            show this help

Exit codes: 0 delegated · 1 no delegation found · 2 could not check
`;

interface CliArgs {
  identifier?: string;
  principal?: string;
  card?: string;
  json: boolean;
  api?: string;
  jwks?: string;
}

function usageError(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) usageError(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case '-h':
      case '--help':
        process.stdout.write(USAGE);
        process.exit(0);
      case '--json':
        args.json = true;
        break;
      case '--principal':
        args.principal = next();
        break;
      case '--card':
        args.card = next();
        break;
      case '--api':
        args.api = next();
        break;
      case '--jwks':
        args.jwks = next();
        break;
      default:
        if (arg.startsWith('-')) usageError(`unknown option ${arg}`);
        if (args.identifier !== undefined) usageError('pass exactly one identifier');
        args.identifier = arg;
    }
  }
  return args;
}

/** Exit once the output has reached the OS — `process.exit` right after a write can cut a piped report short. */
function finish(output: string, code: number): void {
  process.stdout.write(output, () => process.exit(code));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.identifier) usageError('pass the identifier to check');

  let report: CheckReport;
  if (args.card) {
    let card: unknown;
    try {
      card = await loadCard(args.card);
    } catch (error) {
      process.stderr.write(`Could not check: the card at ${args.card} could not be read (${error instanceof Error ? error.message : String(error)}).\n`);
      process.exit(2);
    }
    report = await runCardCheck({ card, source: args.card, delegate: args.identifier, principal: args.principal, apiOrigin: args.api, jwksUri: args.jwks });
  } else {
    report = await runCheck({ delegate: args.identifier, principal: args.principal, apiOrigin: args.api, jwksUri: args.jwks });
  }

  finish(args.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report), report.exitCode);
}

main().catch((error) => {
  process.stderr.write(`Could not check: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});
