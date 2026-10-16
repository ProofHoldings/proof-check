import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The sibling verifier package sits next to this one only in the monorepo. The public mirror
// (ProofHoldings/proof-check) has none, so there the suite resolves the published verifier `npm ci`
// installs — the one `npx @proof-holdings/proof-check` runs on. Keyed on the package rather than on
// its entry point, so that inside the monorepo a moved `src/index.ts` still fails to resolve, loudly.
const IN_MONOREPO = existsSync(new URL('../delegation-verifier/package.json', import.meta.url));

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: IN_MONOREPO ? {
      // As in delegation-self-refusal: `package.json` installs the PUBLISHED verifier, while the suite
      // resolves this repository's SOURCE — green on a fresh clone with no build, and a verifier change
      // is exercised here before it is published. `cli.test.ts` runs the BUILT `dist/cli.js`, which
      // resolves the installed package instead.
      '@proof-holdings/delegation-verifier': new URL('../delegation-verifier/src/index.ts', import.meta.url).pathname,
    } : {},
  },
});
