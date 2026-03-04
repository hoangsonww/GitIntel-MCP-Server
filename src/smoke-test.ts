#!/usr/bin/env node

/**
 * Smoke test: connects to the MCP server and runs every tool and resource
 * against a real repo, printing all results.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

function expandHome(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\') || p === '~') {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

async function main() {
  const repoPath = expandHome(process.argv[2] || process.cwd());
  const serverScript = resolve(import.meta.dirname, 'index.ts');

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  mcp-git-intel Smoke Test`);
  console.log(`  Repo: ${repoPath}`);
  console.log(`${'='.repeat(70)}\n`);

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', serverScript, repoPath],
    stderr: 'ignore',
  });

  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(transport);
  console.log('Connected to server.\n');

  // List tools
  const { tools } = await client.listTools();
  console.log(`Registered tools: ${tools.map((t) => t.name).join(', ')}\n`);

  // List resources
  const { resources } = await client.listResources();
  console.log(`Registered resources: ${resources.map((r) => r.uri).join(', ')}\n`);

  // Test each tool
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'hotspots', args: { days: 365, limit: 10 } },
    { name: 'churn', args: { days: 365, limit: 10 } },
    { name: 'coupling', args: { days: 365, min_coupling: 0.3, min_commits: 2 } },
    { name: 'knowledge_map', args: { path: 'src', days: 365 } },
    { name: 'complexity_trend', args: { path: 'README.md', days: 365, samples: 5 } },
    { name: 'risk_assessment', args: {} },
    { name: 'contributor_stats', args: { days: 365 } },
  ];

  for (const { name, args } of toolCalls) {
    console.log(`${'─'.repeat(70)}`);
    console.log(`TOOL: ${name}`);
    console.log(`ARGS: ${JSON.stringify(args)}`);
    console.log(`${'─'.repeat(70)}`);

    const start = Date.now();
    try {
      const result = await client.callTool({ name, arguments: args });
      const elapsed = Date.now() - start;

      if (result.isError) {
        console.log(`[ERROR in ${elapsed}ms]`);
      } else {
        console.log(`[OK in ${elapsed}ms]`);
      }

      for (const content of result.content as Array<{ type: string; text?: string }>) {
        if (content.type === 'text' && content.text) {
          console.log(content.text);
        }
      }
    } catch (err: unknown) {
      console.log(`[EXCEPTION] ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log('');
  }

  // Test release_notes (needs tags)
  console.log(`${'─'.repeat(70)}`);
  console.log(`TOOL: release_notes`);
  try {
    // Find first and latest tags or use commit range
    const result = await client.callTool({
      name: 'release_notes',
      arguments: { from_ref: 'HEAD~10', to_ref: 'HEAD' },
    });
    console.log(`ARGS: {"from_ref": "HEAD~10", "to_ref": "HEAD"}`);
    console.log(`${'─'.repeat(70)}`);
    for (const content of result.content as Array<{ type: string; text?: string }>) {
      if (content.type === 'text' && content.text) {
        console.log(content.text);
      }
    }
  } catch (err: unknown) {
    console.log(`[EXCEPTION] ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log('');

  // Test resources
  for (const resource of resources) {
    console.log(`${'─'.repeat(70)}`);
    console.log(`RESOURCE: ${resource.uri}`);
    console.log(`${'─'.repeat(70)}`);

    try {
      const result = await client.readResource({ uri: resource.uri });
      for (const content of result.contents) {
        if ('text' in content && content.text) {
          console.log(content.text);
        }
      }
    } catch (err: unknown) {
      console.log(`[EXCEPTION] ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log('');
  }

  console.log(`${'='.repeat(70)}`);
  console.log(`  Smoke test complete.`);
  console.log(`${'='.repeat(70)}\n`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
