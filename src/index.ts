#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveRepoRoot, checkGitVersion } from './git/repo.js';
import { registerHotspots } from './tools/hotspots.js';
import { registerChurn } from './tools/churn.js';
import { registerCoupling } from './tools/coupling.js';
import { registerKnowledgeMap } from './tools/knowledge-map.js';
import { registerComplexityTrend } from './tools/complexity.js';
import { registerRiskAssessment } from './tools/risk.js';
import { registerReleaseNotes } from './tools/release-notes.js';
import { registerContributorStats } from './tools/contributors.js';
import { registerFileHistory } from './tools/file-history.js';
import { registerCodeAge } from './tools/code-age.js';
import { registerCommitPatterns } from './tools/commit-patterns.js';
import { registerBranchRisk } from './tools/branch-risk.js';
import { registerSummaryResource } from './resources/summary.js';
import { registerActivityResource } from './resources/activity.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Stderr ANSI helpers (stderr goes to humans, not AI clients)
const isTTY = process.stderr.isTTY !== false;
const esc = (code: string, t: string) => (isTTY ? `\x1b[${code}m${t}\x1b[0m` : t);
const sB = (t: string) => esc('1', t);
const sCyan = (t: string) => esc('36', t);
const sGreen = (t: string) => esc('32', t);
const sYellow = (t: string) => esc('33', t);
const sRed = (t: string) => esc('31', t);
const sDim = (t: string) => esc('2', t);
const sTag = sCyan(sB('[mcp-git-intel]'));

function expandHome(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\') || p === '~') {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

async function main() {
  // Determine repo root: use CLI arg, env var, or current directory
  const repoPath = expandHome(process.argv[2] || process.env.GIT_INTEL_REPO || process.cwd());

  // Validate git installation (non-fatal — tools will fail individually if git is missing)
  let gitVersion = 'unknown';
  try {
    const info = await checkGitVersion(repoPath);
    gitVersion = info.version;
  } catch {
    // Try with a safe fallback cwd for version check only
    try {
      const info = await checkGitVersion(homedir());
      gitVersion = info.version;
    } catch {
      process.stderr.write(
        `${sTag} ${sYellow('Warning:')} Could not detect git version. Tools will fail if git is not installed.\n`,
      );
    }
  }

  // Resolve repo root (non-fatal — server starts regardless, tools accept repo_path per-call)
  let repoRoot: string | null = null;
  try {
    repoRoot = await resolveRepoRoot(repoPath);
    process.stderr.write(
      `${sTag} ${sDim('Git')} ${sGreen(gitVersion)} ${sDim('|')} ${sDim('Repo')} ${sB(repoRoot)}\n`,
    );
  } catch {
    process.stderr.write(
      `${sTag} ${sDim('Git')} ${sGreen(gitVersion)} ${sDim('|')} ${sYellow('No repo:')} ${repoPath}\n` +
        `${sTag} Server will start anyway. Tools require ${sB('repo_path')} parameter or open Claude Code in a git repo.\n`,
    );
  }

  // Create MCP server
  const server = new McpServer(
    {
      name: 'mcp-git-intel',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Register all tools (repoRoot may be null — tools resolve per-call via repo_path param)
  registerHotspots(server, repoRoot);
  registerChurn(server, repoRoot);
  registerCoupling(server, repoRoot);
  registerKnowledgeMap(server, repoRoot);
  registerComplexityTrend(server, repoRoot);
  registerRiskAssessment(server, repoRoot);
  registerReleaseNotes(server, repoRoot);
  registerContributorStats(server, repoRoot);
  registerFileHistory(server, repoRoot);
  registerCodeAge(server, repoRoot);
  registerCommitPatterns(server, repoRoot);
  registerBranchRisk(server, repoRoot);

  // Register resources (gracefully degrade when no repo is available)
  registerSummaryResource(server, repoRoot);
  registerActivityResource(server, repoRoot);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (repoRoot) {
    process.stderr.write(
      `${sTag} ${sGreen('✓ Running')} ${sDim('—')} ${sB('12')} tools, ${sB('2')} resources\n`,
    );
  } else {
    process.stderr.write(
      `${sTag} ${sYellow('⚠ Running')} ${sDim('(no default repo) —')} ${sB('12')} tools, ${sB('2')} resources\n` +
        `${sTag} Pass ${sB('repo_path')} to each tool call, or restart Claude Code inside a git repo.\n`,
    );
  }

  // Graceful shutdown
  const shutdown = async () => {
    process.stderr.write(`${sTag} ${sDim('Shutting down...')}\n`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`${sTag} ${sRed('Fatal:')} ${err}\n`);
  process.exit(1);
});
