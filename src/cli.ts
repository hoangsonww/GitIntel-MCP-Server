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
import {
  bold,
  dim,
  cyan,
  green,
  yellow,
  red,
  magenta,
  blue,
  gray,
  brightCyan,
  brightGreen,
  brightYellow,
  brightMagenta,
  success,
  error,
  warn,
  info,
  muted,
  accent,
  highlight,
  boxed,
  hr,
  box,
  colorizeOutput,
} from './util/colors.js';

function expandHome(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\') || p === '~') {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

const TOOL_CATEGORIES: Record<string, { color: (s: string) => string; tools: string[] }> = {
  'Hotspot Analysis': {
    color: red,
    tools: ['hotspots', 'churn', 'coupling'],
  },
  'Code Archaeology': {
    color: yellow,
    tools: ['file_history', 'code_age', 'complexity_trend'],
  },
  'Team Analysis': {
    color: blue,
    tools: ['knowledge_map', 'contributor_stats', 'commit_patterns'],
  },
  'Risk & Release': {
    color: magenta,
    tools: ['risk_assessment', 'release_notes', 'branch_risk'],
  },
};

function getToolCategory(name: string): { label: string; color: (s: string) => string } {
  for (const [label, cat] of Object.entries(TOOL_CATEGORIES)) {
    if (cat.tools.includes(name)) return { label, color: cat.color };
  }
  return { label: 'Other', color: gray };
}

function buildHelp(): string {
  const w = 64;
  const title = bold(brightCyan('  mcp-git-intel ')) + muted('— Interactive Test CLI');

  const commands = [
    `  ${highlight('tools')}                     ${dim('List all available tools')}`,
    `  ${highlight('resources')}                 ${dim('List all available resources')}`,
    `  ${highlight('call')} ${cyan('<tool>')} ${gray('[json-args]')}   ${dim('Call a tool with optional JSON arguments')}`,
    `  ${highlight('read')} ${cyan('<uri>')}                ${dim('Read a resource')}`,
    `  ${highlight('help')}                      ${dim('Show this help')}`,
    `  ${highlight('exit')}                      ${dim('Quit')}`,
  ];

  const examples = [
    ['hotspots', '{"days": 60, "limit": 5}'],
    ['churn', '{"days": 30}'],
    ['coupling', '{"min_coupling": 0.3}'],
    ['knowledge_map', '{"path": "src/auth"}'],
    ['complexity_trend', '{"path": "src/index.ts"}'],
    ['risk_assessment', ''],
    ['release_notes', '{"from_ref": "v1.0.0"}'],
    ['contributor_stats', '{"days": 180}'],
    ['file_history', '{"path": "src/index.ts"}'],
    ['code_age', '{"sort": "oldest", "limit": 15}'],
    ['commit_patterns', '{"days": 90}'],
    ['branch_risk', '{"base_branch": "main"}'],
  ];

  const exLines = examples.map(([tool, args]) => {
    const cat = getToolCategory(tool);
    const toolStr = cat.color(tool.padEnd(20));
    const argsStr = args ? gray(args) : muted('(uses defaults)');
    return `  ${dim('call')} ${toolStr} ${argsStr}`;
  });

  const resourceExamples = [
    `  ${dim('read')} ${green('git://repo/summary')}`,
    `  ${dim('read')} ${green('git://repo/activity')}`,
  ];

  return [
    '',
    title,
    hr(w),
    '',
    `  ${bold('Commands')}`,
    '',
    ...commands,
    '',
    `  ${bold('Examples')}`,
    '',
    ...exLines,
    '',
    ...resourceExamples,
    '',
    hr(w),
  ].join('\n');
}

function formatElapsed(ms: number): string {
  if (ms < 100) return success(`${ms}ms`);
  if (ms < 1000) return green(`${ms}ms`);
  if (ms < 3000) return yellow(`${(ms / 1000).toFixed(1)}s`);
  return warn(`${(ms / 1000).toFixed(1)}s`);
}

function banner(repoPath: string): string {
  const lines = [
    bold(brightCyan('  ⬡  mcp-git-intel')),
    `     ${dim('Git Intelligence MCP Server')}`,
    '',
    `  ${gray('Repo')}  ${white(repoPath)}`,
    `  ${gray('Type')}  ${cyan('help')} ${dim('for commands,')} ${cyan('exit')} ${dim('to quit')}`,
  ];
  return '\n' + boxed(lines, 62, cyan) + '\n';
}

function white(t: string): string {
  return `\x1b[37m${t}\x1b[0m`;
}

async function main() {
  const repoPath = expandHome(process.argv[2] || process.cwd());
  const serverScript = resolve(import.meta.dirname, 'index.ts');

  console.log(banner(repoPath));
  console.log(dim('  Connecting to server...'));

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', serverScript, repoPath],
    stderr: 'ignore',
  });

  const client = new Client({ name: 'test-cli', version: '1.0.0' });

  try {
    await client.connect(transport);
  } catch (err) {
    console.error(error(`  Failed to connect: ${err}`));
    process.exit(1);
  }

  console.log(success('  Connected.') + '\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${cyan(bold('git-intel'))}${gray('>')} `,
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
          console.log(buildHelp());
          break;

        case 'exit':
        case 'quit':
        case 'q':
          console.log(dim('\n  Disconnecting...'));
          await client.close();
          console.log(muted('  Bye.\n'));
          process.exit(0);

        case 'tools': {
          const result = await client.listTools();
          console.log(`\n  ${bold('Available Tools')} ${muted(`(${result.tools.length})`)}\n`);

          // Group by category
          const grouped = new Map<string, Array<{ name: string; desc: string; params: string }>>();
          for (const tool of result.tools) {
            const cat = getToolCategory(tool.name);
            if (!grouped.has(cat.label)) grouped.set(cat.label, []);
            const params = tool.inputSchema?.properties
              ? Object.keys(tool.inputSchema.properties as Record<string, unknown>)
                  .filter((p) => p !== 'repo_path')
                  .join(', ')
              : 'none';
            grouped.get(cat.label)!.push({
              name: tool.name,
              desc: tool.description?.slice(0, 70) ?? '',
              params,
            });
          }

          for (const [category, cat] of Object.entries(TOOL_CATEGORIES)) {
            const tools = grouped.get(category);
            if (!tools || tools.length === 0) continue;
            console.log(`  ${cat.color(bold(category))}`);
            for (const t of tools) {
              console.log(`    ${cat.color('●')} ${highlight(t.name.padEnd(20))} ${dim(t.desc)}`);
              console.log(`      ${gray('params:')} ${cyan(t.params)}`);
            }
            console.log('');
          }
          break;
        }

        case 'resources': {
          const result = await client.listResources();
          console.log(
            `\n  ${bold('Available Resources')} ${muted(`(${result.resources.length})`)}\n`,
          );
          for (const resource of result.resources) {
            console.log(`    ${green('◆')} ${highlight(resource.uri)}`);
            console.log(`      ${dim(resource.description ?? '')}`);
          }
          console.log('');
          break;
        }

        case 'call': {
          const toolName = rest[0];
          if (!toolName) {
            console.log(warn('  Usage: call <tool-name> [json-args]'));
            break;
          }

          let args: Record<string, unknown> = {};
          const jsonPart = rest.slice(1).join(' ').trim();
          if (jsonPart) {
            try {
              args = JSON.parse(jsonPart);
            } catch {
              console.log(error(`  Invalid JSON: `) + dim(jsonPart));
              break;
            }
          }

          const cat = getToolCategory(toolName);
          const argsDisplay =
            Object.keys(args).length > 0 ? gray(` ${JSON.stringify(args)}`) : muted(' (defaults)');

          console.log(`\n  ${cat.color('▶')} ${bold(toolName)}${argsDisplay}`);

          const start = Date.now();
          const result = await client.callTool({ name: toolName, arguments: args });
          const elapsed = Date.now() - start;

          if (result.isError) {
            console.log(`  ${error('✗ ERROR')} ${dim('in')} ${formatElapsed(elapsed)}\n`);
          } else {
            console.log(`  ${success('✓ OK')} ${dim('in')} ${formatElapsed(elapsed)}\n`);
          }

          for (const content of result.content as Array<{ type: string; text?: string }>) {
            if (content.type === 'text' && content.text) {
              console.log(colorizeOutput(content.text));
            }
          }
          console.log('');
          break;
        }

        case 'read': {
          const uri = argStr.trim();
          if (!uri) {
            console.log(warn('  Usage: read <resource-uri>'));
            break;
          }

          console.log(`\n  ${green('◆')} ${bold(uri)}`);

          const start = Date.now();
          const result = await client.readResource({ uri });
          const elapsed = Date.now() - start;

          console.log(`  ${success('✓ OK')} ${dim('in')} ${formatElapsed(elapsed)}\n`);

          for (const content of result.contents) {
            if ('text' in content && content.text) {
              console.log(colorizeOutput(content.text));
            }
          }
          console.log('');
          break;
        }

        default:
          console.log(
            warn(`  Unknown command: ${command}`) + dim('  Type "help" for available commands.'),
          );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${error('Error:')} ${msg}\n`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await client.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(error(`Fatal: ${err}`));
  process.exit(1);
});
