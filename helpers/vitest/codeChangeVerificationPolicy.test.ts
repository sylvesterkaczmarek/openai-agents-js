import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { getPnpmInvocation } from '../../.agents/skills/code-change-verification/scripts/run.mjs';

const rootDir = resolve(import.meta.dirname, '../..');
const skillPath = resolve(
  rootDir,
  '.agents/skills/code-change-verification/SKILL.md',
);
const promptPath = resolve(
  rootDir,
  '.agents/skills/code-change-verification/agents/openai.yaml',
);
const workflowPath = resolve(rootDir, '.github/workflows/test.yml');

describe('code-change verification policy', () => {
  it('keeps Codex execution inside the workspace sandbox', () => {
    const skill = readFileSync(skillPath, 'utf8');
    const prompt = readFileSync(promptPath, 'utf8');
    const sandboxPolicy =
      'Never request elevated sandbox permissions for verification, and never retry with broader host access after a failure.';

    expect(skill).toContain(sandboxPolicy);
    expect(prompt).toContain(sandboxPolicy);
    expect(skill).not.toContain('sandbox_permissions=require_escalated');
    expect(prompt).not.toContain('sandbox_permissions=require_escalated');
    expect(skill).not.toContain('outside the Codex sandbox');
    expect(prompt).not.toContain('outside the Codex sandbox');
    expect(skill).toContain(
      '/usr/bin/env -u OPENAI_API_KEY bash .agents/skills/code-change-verification/scripts/run.sh',
    );
  });

  it('routes Windows pnpm commands through cmd.exe with explicit quoting', () => {
    const invocation = getPnpmInvocation(
      [
        'exec',
        'concurrently',
        '--names',
        'build-check,dist-check',
        'pnpm -r build-check',
        'pnpm -r -F "@openai/*" dist:check',
      ],
      {
        platform: 'win32',
        comSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
    );

    expect(invocation).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'pnpm.cmd exec concurrently --names build-check,dist-check "pnpm -r build-check" "pnpm -r -F ""@openai/*"" dist:check"',
      ],
      windowsVerbatimArguments: true,
    });
  });

  it('keeps direct pnpm spawning on non-Windows platforms', () => {
    expect(
      getPnpmInvocation(['test'], {
        platform: 'linux',
        comSpec: 'ignored',
      }),
    ).toEqual({
      command: 'pnpm',
      args: ['test'],
      windowsVerbatimArguments: false,
    });
  });

  it('runs CI for code-change verification policy updates', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const relevantBranch = [
      'if (CI_RELEVANT_PREFIXES.some((prefix) => path.startsWith(prefix))) {',
      '                return false;',
      '              }',
    ].join('\n');
    const ignoredBranch =
      'if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))) {';

    expect(workflow).toContain(
      "const CI_RELEVANT_PREFIXES = [\n              '.agents/skills/code-change-verification/',\n            ];",
    );
    expect(workflow).toContain(relevantBranch);
    expect(workflow.indexOf(relevantBranch)).toBeLessThan(
      workflow.indexOf(ignoredBranch),
    );
    expect(workflow).toContain(
      'changedFiles = files.flatMap(changedPathsForFile);',
    );
    expect(workflow).toContain(
      'changedFiles = (comparison.data.files ?? []).flatMap(changedPathsForFile);',
    );

    const scriptStart = workflow.indexOf('            const IGNORED_PREFIXES');
    const scriptEnd = workflow.indexOf('\n\n            let changedFiles');
    expect(scriptStart).toBeGreaterThanOrEqual(0);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    const policyScript = `${workflow
      .slice(scriptStart, scriptEnd)
      .replace(/^ {12}/gm, '')}
this.isIgnoredPath = isIgnoredPath;
this.changedPathsForFile = changedPathsForFile;`;
    const context: {
      isIgnoredPath?: (path: string) => boolean;
      changedPathsForFile?: (file: {
        filename: string;
        previous_filename?: string;
      }) => string[];
    } = {};

    runInNewContext(policyScript, context);
    expect(context.isIgnoredPath).toBeTypeOf('function');
    expect(context.changedPathsForFile).toBeTypeOf('function');

    const changedPaths = context.changedPathsForFile!({
      filename: '.agents/disabled-code-change-verification/SKILL.md',
      previous_filename: '.agents/skills/code-change-verification/SKILL.md',
    });

    expect(changedPaths).toEqual([
      '.agents/disabled-code-change-verification/SKILL.md',
      '.agents/skills/code-change-verification/SKILL.md',
    ]);
    expect(changedPaths.some((path) => !context.isIgnoredPath!(path))).toBe(
      true,
    );
  });
});
