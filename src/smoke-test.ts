#!/usr/bin/env node

/**
 * Smoke test: connects to the MCP server and runs every tool and resource
 * against a real repo, printing all results.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  bold,
  dim,
  cyan,
  green,
  yellow,
  red,
  magenta,
  gray,
  brightCyan,
  success,
  error,
  warn,
  muted,
  highlight,
  boxed,
  hr,
  colorizeOutput,
} from './util/colors.js';

function expandHome(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\') || p === '~') {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

function formatElapsed(ms: number): string {
  if (ms < 100) return success(`${ms}ms`);
  if (ms < 1000) return green(`${ms}ms`);
  if (ms < 3000) return yellow(`${(ms / 1000).toFixed(1)}s`);
  return warn(`${(ms / 1000).toFixed(1)}s`);
}

async function main() {
  const repoPath = expandHome(process.argv[2] || process.cwd());
  const serverScript = resolve(import.meta.dirname, 'index.ts');

  const bannerLines = [
    bold(brightCyan('  ⬡  mcp-git-intel Smoke Test')),
    `     ${dim('Running all tools & resources against a live repo')}`,
    '',
    `  ${gray('Repo')}  ${repoPath}`,
  ];
  console.log('\n' + boxed(bannerLines, 66, cyan));

  console.log(dim('\n  Connecting to server...'));

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', serverScript, repoPath],
    stderr: 'ignore',
  });

  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(transport);
  console.log(success('  Connected.\n'));

  // List tools
  const { tools } = await client.listTools();
  console.log(
    `  ${bold('Tools')} ${muted(`(${tools.length})`)}  ${dim(tools.map((t) => t.name).join(', '))}\n`,
  );

  // List resources
  const { resources } = await client.listResources();
  console.log(
    `  ${bold('Resources')} ${muted(`(${resources.length})`)}  ${dim(resources.map((r) => r.uri).join(', '))}\n`,
  );

  // Test each tool
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'hotspots', args: { days: 365, limit: 10 } },
    { name: 'churn', args: { days: 365, limit: 10 } },
    { name: 'coupling', args: { days: 365, min_coupling: 0.3, min_commits: 2 } },
    { name: 'knowledge_map', args: { path: 'src', days: 365 } },
    { name: 'complexity_trend', args: { path: 'README.md', days: 365, samples: 5 } },
    { name: 'risk_assessment', args: {} },
    { name: 'contributor_stats', args: { days: 365 } },
    { name: 'file_history', args: { path: 'README.md', days: 365, limit: 10 } },
    { name: 'code_age', args: { limit: 15, sort: 'oldest' } },
    { name: 'commit_patterns', args: { days: 365 } },
    { name: 'branch_risk', args: { base_branch: 'HEAD' } },
  ];

  let passed = 0;
  let failed = 0;

  for (const { name, args } of toolCalls) {
    console.log(hr(66));
    const argsStr = Object.keys(args).length > 0 ? gray(` ${JSON.stringify(args)}`) : '';
    console.log(`  ${cyan('▶')} ${bold(name)}${argsStr}`);

    const start = Date.now();
    try {
      const result = await client.callTool({ name, arguments: args });
      const elapsed = Date.now() - start;

      if (result.isError) {
        console.log(`  ${error('✗ FAIL')} ${dim('in')} ${formatElapsed(elapsed)}`);
        failed++;
      } else {
        console.log(`  ${success('✓ PASS')} ${dim('in')} ${formatElapsed(elapsed)}`);
        passed++;
      }

      for (const content of result.content as Array<{ type: string; text?: string }>) {
        if (content.type === 'text' && content.text) {
          console.log(colorizeOutput(content.text));
        }
      }
    } catch (err: unknown) {
      console.log(
        `  ${error('✗ EXCEPTION')} ${red(err instanceof Error ? err.message : String(err))}`,
      );
      failed++;
    }
    console.log('');
  }

  // Test release_notes
  console.log(hr(66));
  console.log(
    `  ${cyan('▶')} ${bold('release_notes')} ${gray('{"from_ref": "HEAD~10", "to_ref": "HEAD"}')}`,
  );
  try {
    const start = Date.now();
    const result = await client.callTool({
      name: 'release_notes',
      arguments: { from_ref: 'HEAD~10', to_ref: 'HEAD' },
    });
    const elapsed = Date.now() - start;

    if (result.isError) {
      console.log(`  ${error('✗ FAIL')} ${dim('in')} ${formatElapsed(elapsed)}`);
      failed++;
    } else {
      console.log(`  ${success('✓ PASS')} ${dim('in')} ${formatElapsed(elapsed)}`);
      passed++;
    }

    for (const content of result.content as Array<{ type: string; text?: string }>) {
      if (content.type === 'text' && content.text) {
        console.log(colorizeOutput(content.text));
      }
    }
  } catch (err: unknown) {
    console.log(
      `  ${error('✗ EXCEPTION')} ${red(err instanceof Error ? err.message : String(err))}`,
    );
    failed++;
  }
  console.log('');

  // Test resources
  for (const resource of resources) {
    console.log(hr(66));
    console.log(`  ${green('◆')} ${bold('RESOURCE')} ${highlight(resource.uri)}`);

    try {
      const start = Date.now();
      const result = await client.readResource({ uri: resource.uri });
      const elapsed = Date.now() - start;
      console.log(`  ${success('✓ PASS')} ${dim('in')} ${formatElapsed(elapsed)}`);
      passed++;

      for (const content of result.contents) {
        if ('text' in content && content.text) {
          console.log(colorizeOutput(content.text));
        }
      }
    } catch (err: unknown) {
      console.log(
        `  ${error('✗ EXCEPTION')} ${red(err instanceof Error ? err.message : String(err))}`,
      );
      failed++;
    }
    console.log('');
  }

  // Summary
  console.log(hr(66));
  const total = passed + failed;
  const statusColor = failed === 0 ? green : red;
  const summaryLines = [
    bold(brightCyan('  Smoke Test Complete')),
    '',
    `  ${success(`${passed} passed`)}  ${failed > 0 ? error(`${failed} failed`) : dim('0 failed')}  ${muted(`${total} total`)}`,
  ];
  console.log(boxed(summaryLines, 40, statusColor));
  console.log('');

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(error(`Fatal: ${err}`));
  process.exit(1);
});
