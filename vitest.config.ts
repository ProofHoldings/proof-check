import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // As in delegation-self-refusal: `package.json` installs the PUBLISHED verifier, while the suite
      // resolves this repository's SOURCE — green on a fresh clone with no build, and a verifier change
      // is exercised here before it is published. `cli.test.ts` runs the BUILT `dist/cli.js`, which
      // resolves the installed package instead.
      '@proof-holdings/delegation-verifier': new URL('../delegation-verifier/src/index.ts', import.meta.url).pathname,
    },
  },
});
