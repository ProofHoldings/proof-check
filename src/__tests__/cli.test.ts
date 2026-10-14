/**
 * The BUILT binary (SC-27): `dist/cli.js` spawned the way npx runs it — help, a rejected identifier
 * and a usage error, none of which may touch the network. Run `npm run build` first (CI does).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const CLI = path.resolve(__dirname, '../../dist/cli.js');

function run(...args: string[]) {
  // An unroutable API origin: a test that reached the network would fail rather than pass quietly.
  const result = spawnSync(process.execPath, [CLI, ...args, '--api', 'https://127.0.0.1:9'], { encoding: 'utf8', timeout: 20_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('dist/cli.js', () => {
  it('is built', () => {
    expect(fs.existsSync(CLI), 'run `npm run build` before the tests').toBe(true);
    expect(fs.readFileSync(CLI, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('--help prints usage and exits 0', () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: proof-check <identifier>');
    expect(result.stdout).toContain('0 delegated · 1 no delegation found · 2 could not check');
  });

  it('a rejected identifier exits 2, says why, and names the trusted issuer', () => {
    const result = run('pkg:npm/postmark-mcp@1.0.16');
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/^Trusting issuer proof\.holdings/);
    expect(result.stdout).toContain('Could not check:');
  });

  it('--json emits the same report as JSON', () => {
    const result = run('not-an-identifier', '--json');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ exitCode: 2, answer: 'could_not_check', delegate: null });
  });

  it('a usage error exits 2 — never 1, which means "no delegation found"', () => {
    expect(run('pkg:npm/postmark-mcp', '--frobnicate').status).toBe(2);
    expect(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status).toBe(2);
  });
});
