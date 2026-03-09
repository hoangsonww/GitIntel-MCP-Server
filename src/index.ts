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
import { registerSummaryResource } from './resources/summary.js';
import { registerActivityResource } from './resources/activity.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

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
        `[mcp-git-intel] Warning: Could not detect git version. Tools will fail if git is not installed.\n`,
      );
    }
  }

  // Resolve repo root (non-fatal — server starts regardless, tools accept repo_path per-call)
  let repoRoot: string | null = null;
  try {
    repoRoot = await resolveRepoRoot(repoPath);
    process.stderr.write(`[mcp-git-intel] Git ${gitVersion} | Repo: ${repoRoot}\n`);
  } catch {
    process.stderr.write(
      `[mcp-git-intel] Git ${gitVersion} | No git repo detected in: ${repoPath}\n` +
        `[mcp-git-intel] Server will start anyway. Tools require repo_path parameter or open Claude Code in a git repo.\n`,
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

  // Register resources (gracefully degrade when no repo is available)
  registerSummaryResource(server, repoRoot);
  registerActivityResource(server, repoRoot);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (repoRoot) {
    process.stderr.write(`[mcp-git-intel] Server running. 8 tools, 2 resources registered.\n`);
  } else {
    process.stderr.write(
      `[mcp-git-intel] Server running (no default repo). 8 tools, 2 resources registered.\n` +
        `[mcp-git-intel] Pass repo_path to each tool call, or restart Claude Code inside a git repo.\n`,
    );
  }

  // Graceful shutdown
  const shutdown = async () => {
    process.stderr.write('[mcp-git-intel] Shutting down...\n');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[mcp-git-intel] Fatal error: ${err}\n`);
  process.exit(1);
});
