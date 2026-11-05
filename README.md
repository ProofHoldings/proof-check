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
  signed 2026-10-08 · expires 2027-10-08 · ph_dlg_…
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
| `2` | Could not check — a rejected identifier, an unreachable lookup, a token whose keys or status could not be confirmed, or, with `--card`, a delegation token of schema 1.x (`unsupported_version`: no longer read since schema 2.0; its owner re-issues it) |

A token this tool received and could not confirm is never reported as "no delegation found". A
token under a revoked signing key is not one of them: the lookup does not pass it on (see below).

The date beside a verified delegation is when its token was signed (`iat`). proof.holdings re-signs a
live delegation's token when the key that signed it is revoked after a suspected compromise, and
ahead of the one-time retirement of its legacy keys — and the date moves with it.

## A token of schema 1.x

Since schema 2.0 a delegation token of schema 1.x is no longer read; its owner re-issues the delegation. The lookup does not pass such a token on: unless another place carries one that verifies (exit `0`) or one that could not be confirmed (exit `2`), the answer is "No delegation found" and the exit code `1`. One of the artifact's own places says why; a delegating domain's card read on the artifact's behalf reads as nothing found instead. A 1.x token that has also expired is reported as an expired delegation, the same as an expired token of schema 2.0. With `--card` the tool reads the token itself and reports `unsupported_version`, expired or not — exit `2`.

## A token signed by a revoked key

A place can carry a token whose signing key proof.holdings has since revoked — after a suspected
compromise, or when its legacy keys are retired. That token no longer counts: unless another place
carries one that verifies (exit `0`) or one that could not be confirmed (exit `2`), the answer is "No
delegation found" and the exit code `1`. One of the artifact's own places (its npm manifest, its MCP
registry entry, an endpoint's cards) says why; a delegating domain's card read on the artifact's
behalf reads as nothing found instead. With `--card` the tool reads the token itself: one run sees
the key gone from the key set before it can confirm the revocation, so the token's line says
`unknown_key` — still exit `1`.

```
Trusting issuer proof.holdings — keys https://api.proof.holdings/.well-known/jwks.json, status https://api.proof.holdings/api/v1/proofs/validate
Artifact: pkg:npm/example-mcp

No delegation found — checked:

Places checked (2026-10-08 12:00 UTC, located by https://api.proof.holdings):
  - The npm registry's manifest for example-mcp (latest published version): not a delegation this issuer can verify — Carries a token that names a revoked Proof Holdings signing key, so it was not checked further; if its delegation is still active, Proof Holdings serves its current token to replace it.
    https://registry.npmjs.org/example-mcp/latest
  - …
```

If the delegation is still active, its publisher replaces the token in that place with the current one,
from `GET https://api.proof.holdings/api/v1/proofs/delegation-token/<handle>`.

## Programmatic use

```ts
import { runCheck } from '@proof-holdings/proof-check';

const report = await runCheck({ delegate: 'pkg:npm/postmark-mcp' });
if (report.answer === 'delegated') { /* report.tokens[].delegation.principal */ }
```

MIT licensed.
