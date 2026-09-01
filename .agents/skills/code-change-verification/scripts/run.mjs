#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { console, process } = globalThis;
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);

const VALIDATION_NAMES = [
  'build-check',
  'dist-check',
  'lint',
  'test',
  'format-check',
];
const VALIDATION_COMMANDS = [
  'pnpm -r build-check',
  'pnpm -r -F "@openai/*" dist:check',
  'pnpm lint',
  'pnpm test',
  'pnpm format:check:changed',
];
const WINDOWS_UNSAFE_CMD_CHARS_RE = /[&|<>%!\r\n]/u;
const WINDOWS_CMD_QUOTE_CHARS_RE = /[\s()"^]/u;

function printUsage() {
  console.log(`code-change-verification

Usage:
  node .agents/skills/code-change-verification/scripts/run.mjs
`);
}

function getRepoRoot() {
  try {
    return execFileSync(
      'git',
      ['-C', scriptDir, 'rev-parse', '--show-toplevel'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
  } catch {
    return path.resolve(scriptDir, '../../../..');
  }
}

function escapeForCmdExe(arg) {
  if (WINDOWS_UNSAFE_CMD_CHARS_RE.test(arg)) {
    throw new Error(
      `unsafe Windows cmd.exe argument detected: ${JSON.stringify(arg)}`,
    );
  }

  const escaped = arg.replace(/\^/gu, '^^');
  if (!WINDOWS_CMD_QUOTE_CHARS_RE.test(arg)) {
    return escaped;
  }
  return `"${escaped.replace(/"/gu, '""')}"`;
}

function buildCmdExeCommandLine(command, args) {
  return [escapeForCmdExe(command), ...args.map(escapeForCmdExe)].join(' ');
}

export function getPnpmInvocation(
  args,
  {
    platform = process.platform,
    comSpec = process.env.ComSpec ?? 'cmd.exe',
  } = {},
) {
  if (platform === 'win32') {
    return {
      command: comSpec,
      args: ['/d', '/s', '/c', buildCmdExeCommandLine('pnpm.cmd', args)],
      windowsVerbatimArguments: true,
    };
  }

  return {
    command: 'pnpm',
    args,
    windowsVerbatimArguments: false,
  };
}

function runPnpm(repoRoot, label, args) {
  console.log(`Running pnpm ${args.join(' ')}...`);
  const invocation = getPnpmInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });

  if (result.error) {
    console.error(`code-change-verification: ${label} failed to start.`);
    console.error(result.error);
    return 1;
  }
  if (typeof result.status === 'number') {
    if (result.status !== 0) {
      console.error(
        `code-change-verification: ${label} failed with exit code ${result.status}.`,
      );
    }
    return result.status;
  }

  console.error(
    `code-change-verification: ${label} terminated by ${result.signal ?? 'an unknown signal'}.`,
  );
  return 1;
}

function runVerification() {
  const repoRoot = getRepoRoot();
  const installExitCode = runPnpm(repoRoot, 'install', [
    'i',
    '--frozen-lockfile',
  ]);
  if (installExitCode !== 0) {
    return installExitCode;
  }

  const buildExitCode = runPnpm(repoRoot, 'build', ['build']);
  if (buildExitCode !== 0) {
    return buildExitCode;
  }

  const validationExitCode = runPnpm(repoRoot, 'validation', [
    'exec',
    'concurrently',
    '--kill-others-on-fail',
    '--kill-timeout',
    '5000',
    '--names',
    VALIDATION_NAMES.join(','),
    ...VALIDATION_COMMANDS,
  ]);
  if (validationExitCode !== 0) {
    return validationExitCode;
  }

  console.log('code-change-verification: all commands passed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  if (process.argv.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  process.exit(runVerification());
}
