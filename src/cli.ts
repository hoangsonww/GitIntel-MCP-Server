#!/usr/bin/env node

/**
 * Interactive CLI for testing mcp-git-intel tools.
 * Connects to the MCP server as a real client over stdio,
 * then provides a REPL to call tools and read resources.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

function expandHome(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\') || p === '~') {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

const HELP = `
mcp-git-intel — Interactive Test CLI

Commands:
  tools                     List all available tools
  resources                 List all available resources
  call <tool> [json-args]   Call a tool with optional JSON arguments
  read <uri>                Read a resource
  help                      Show this help
  exit                      Quit

Examples:
  call hotspots {"days": 60, "limit": 5}
  call hotspots                              (uses defaults)
  call coupling {"min_coupling": 0.3}
  call knowledge_map {"path": "src/auth"}
  call churn {"days": 30}
  call complexity_trend {"path": "src/index.ts"}
  call risk_assessment
  call release_notes {"from_ref": "v1.0.0"}
  call contributor_stats {"days": 180}
  read git://repo/summary
  read git://repo/activity
`.trim();

async function main() {
  const repoPath = expandHome(process.argv[2] || process.cwd());
  const serverScript = resolve(import.meta.dirname, 'index.ts');

  console.log(`\n  mcp-git-intel Test CLI`);
  console.log(`  Repo: ${repoPath}`);
  console.log(`  Type "help" for commands, "exit" to quit.\n`);

  // Spawn the MCP server as a child process and connect as a client
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', serverScript, repoPath],
    stderr: 'ignore',
  });

  const client = new Client({ name: 'test-cli', version: '1.0.0' });

  try {
    await client.connect(transport);
  } catch (err) {
    console.error(`Failed to connect to server: ${err}`);
    process.exit(1);
  }

  console.log('  Connected to mcp-git-intel server.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'git-intel> ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    const [command, ...rest] = trimmed.split(/\s+/);
    const argStr = rest.join(' ');

    try {
      switch (command) {
        case 'help':
          console.log(`\n${HELP}\n`);
          break;

        case 'exit':
        case 'quit':
        case 'q':
          console.log('Bye.');
          await client.close();
          process.exit(0);

        case 'tools': {
          const result = await client.listTools();
          console.log(`\n  Available tools (${result.tools.length}):\n`);
          for (const tool of result.tools) {
            const inputProps = tool.inputSchema?.properties
              ? Object.keys(tool.inputSchema.properties as Record<string, unknown>).join(', ')
              : 'none';
            console.log(`  ${(tool.name).padEnd(22)} ${tool.description?.slice(0, 80) ?? ''}`);
            console.log(`  ${''.padEnd(22)} params: ${inputProps}\n`);
          }
          break;
        }

        case 'resources': {
          const result = await client.listResources();
          console.log(`\n  Available resources (${result.resources.length}):\n`);
          for (const resource of result.resources) {
            console.log(`  ${resource.uri}`);
            console.log(`    ${resource.description ?? ''}\n`);
          }
          break;
        }

        case 'call': {
          const toolName = rest[0];
          if (!toolName) {
            console.log('  Usage: call <tool-name> [json-args]');
            break;
          }

          let args: Record<string, unknown> = {};
          const jsonPart = rest.slice(1).join(' ').trim();
          if (jsonPart) {
            try {
              args = JSON.parse(jsonPart);
            } catch {
              console.log(`  Invalid JSON: ${jsonPart}`);
              break;
            }
          }

          console.log(`\n  Calling ${toolName}...`);
          const start = Date.now();

          const result = await client.callTool({ name: toolName, arguments: args });
          const elapsed = Date.now() - start;

          console.log(`  (${elapsed}ms)\n`);

          if (result.isError) {
            console.log('  ERROR:');
          }

          for (const content of result.content as Array<{ type: string; text?: string }>) {
            if (content.type === 'text' && content.text) {
              console.log(content.text);
            }
          }
          console.log('');
          break;
        }

        case 'read': {
          const uri = argStr.trim();
          if (!uri) {
            console.log('  Usage: read <resource-uri>');
            break;
          }

          console.log(`\n  Reading ${uri}...`);
          const start = Date.now();

          const result = await client.readResource({ uri });
          const elapsed = Date.now() - start;

          console.log(`  (${elapsed}ms)\n`);

          for (const content of result.contents) {
            if ('text' in content && content.text) {
              console.log(content.text);
            }
          }
          console.log('');
          break;
        }

        default:
          console.log(`  Unknown command: ${command}. Type "help" for available commands.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Error: ${msg}\n`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await client.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
