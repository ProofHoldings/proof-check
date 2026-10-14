# @proof-holdings/proof-check

Has a domain published a **Proof of Delegation** for this package or endpoint? Check it from the
terminal, where the install decision is made:

```sh
npx @proof-holdings/proof-check pkg:npm/@proof-holdings/mcp-server
```

```
Trusting issuer proof.holdings — keys https://api.proof.holdings/.well-known/jwks.json, status https://api.proof.holdings/api/v1/proofs/validate
Artifact: pkg:npm/@proof-holdings/mcp-server

Delegated by proof.holdings — verified locally.
  scope mcp-serve · issued 2026-10-08 · expires 2027-10-08 · ph_dlg_…
  A delegation records who authorized this artifact. It does not say the artifact is safe, audited or endorsed.

Places checked (2026-10-08 12:00 UTC, located by https://api.proof.holdings):
  - The MCP registry entry holdings.proof/mcp-server (registry.modelcontextprotocol.io): delegation found, in force — …
  - …
```

## How it works

1. It asks `https://api.proof.holdings/api/v1/artifacts/claim` **where** delegations for the artifact
   were found — the npm manifest, the MCP registry entry the package names, an endpoint's own and host
   cards, and the delegating domains' `_mcp` DNS pointers and `.well-known` cards.
2. It verifies **every token found itself**, with
   [`@proof-holdings/delegation-verifier`](https://www.npmjs.com/package/@proof-holdings/delegation-verifier):
   the signature against the issuer's key set, that the token names **exactly the identifier you
   typed**, and that it is still in force. A "delegated by" answer never rests on the lookup's word.

The answer names the domain that signed. Any domain owner can delegate any artifact, so read the
domain: `--principal <domain>` makes only a delegation from that domain count.

## Usage

```
proof-check <identifier> [--principal <domain>] [--json] [--api <origin>] [--jwks <url>]
proof-check <identifier> --card <path-or-https-url> [--principal <domain>] [--json]
```

- `<identifier>` — `pkg:npm/<name>`, `pkg:pypi/<name>` or `https://<host><path>`. No version: a
  delegation covers the artifact, not one release.
- `--card` — verify a server card or agent card you already have (for example the `server.json` in
  an installed package) instead of asking where to look.
- `--json` — the full report as JSON.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Delegated — at least one token verified locally (and matched `--principal`) |
| `1` | No delegation found at the places checked, which are listed |
| `2` | Could not check — a rejected identifier, an unreachable lookup, or a token whose keys or status could not be confirmed |

A token that could not be confirmed is never reported as "no delegation found".

## Programmatic use

```ts
import { runCheck } from '@proof-holdings/proof-check';

const report = await runCheck({ delegate: 'pkg:npm/postmark-mcp' });
if (report.answer === 'delegated') { /* report.tokens[].delegation.principal */ }
```

MIT licensed.
