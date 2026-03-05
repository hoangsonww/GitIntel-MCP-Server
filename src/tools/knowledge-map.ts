import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { validatePathFilter } from '../git/repo.js';
import { textResult, errorResult, formatTable, formatBar } from '../util/formatting.js';
import { knowledgeScore, daysAgoString } from '../util/scoring.js';

interface AuthorStats {
  name: string;
  email: string;
  linesAdded: number;
  linesDeleted: number;
  commits: number;
  firstCommit: number;
  lastCommit: number;
}

export function registerKnowledgeMap(server: McpServer, repoRoot: string) {
  server.registerTool(
    'knowledge_map',
    {
      title: 'Knowledge Map',
      description:
        'Show who knows a file or directory best, weighted by recency, volume of changes, and commit frequency. ' +
        'Use this to find the right reviewer for a PR, identify knowledge silos, or plan for team transitions.',
      inputSchema: z.object({
        path: z.string().describe('File or directory path to analyze (relative to repo root)'),
        days: z.number().int().positive().default(365).describe('Days to look back (default: 365)'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { path, days } = args;
        const cleanPath = validatePathFilter(path, repoRoot);
        const since = `${days} days ago`;
        const nowSec = Math.floor(Date.now() / 1000);

        // Get detailed per-author stats
        const logArgs = [
          'log',
          '--format=COMMIT:%aN|%aE|%at',
          '--numstat',
          '--no-merges',
          `--since=${since}`,
          '--',
          cleanPath,
        ];

        const { stdout } = await gitExec(logArgs, { cwd: repoRoot });
        if (!stdout.trim()) {
          return textResult(`No commits found for "${path}" in the last ${days} days.`);
        }

        const authors = new Map<string, AuthorStats>();
        let currentAuthor: { name: string; email: string; timestamp: number } | null = null;

        for (const line of stdout.split('\n')) {
          if (line.startsWith('COMMIT:')) {
            const parts = line.slice(7).split('|');
            if (parts.length >= 3) {
              currentAuthor = {
                name: parts[0],
                email: parts[1],
                timestamp: parseInt(parts[2], 10),
              };
            }
            continue;
          }

          if (!currentAuthor) continue;

          const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (!match) continue;

          const isBinary = match[1] === '-';
          if (isBinary) continue;

          const additions = parseInt(match[1], 10);
          const deletions = parseInt(match[2], 10);

          const existing = authors.get(currentAuthor.name);
          if (existing) {
            existing.linesAdded += additions;
            existing.linesDeleted += deletions;
            existing.commits++;
            if (currentAuthor.timestamp < existing.firstCommit) {
              existing.firstCommit = currentAuthor.timestamp;
            }
            if (currentAuthor.timestamp > existing.lastCommit) {
              existing.lastCommit = currentAuthor.timestamp;
            }
          } else {
            authors.set(currentAuthor.name, {
              name: currentAuthor.name,
              email: currentAuthor.email,
              linesAdded: additions,
              linesDeleted: deletions,
              commits: 1,
              firstCommit: currentAuthor.timestamp,
              lastCommit: currentAuthor.timestamp,
            });
          }
        }

        if (authors.size === 0) {
          return textResult(`No author data found for "${path}" in the last ${days} days.`);
        }

        // Calculate knowledge scores
        const maxLines = Math.max(
          ...[...authors.values()].map((a) => a.linesAdded + a.linesDeleted),
        );
        const maxCommits = Math.max(...[...authors.values()].map((a) => a.commits));

        const scored = [...authors.values()].map((a) => ({
          ...a,
          totalLines: a.linesAdded + a.linesDeleted,
          score: knowledgeScore({
            linesChanged: a.linesAdded + a.linesDeleted,
            commitCount: a.commits,
            mostRecentTimestamp: a.lastCommit,
            nowSec,
            maxLinesChanged: maxLines,
            maxCommitCount: maxCommits,
          }),
        }));

        // Sort by knowledge score descending
        scored.sort((a, b) => b.score - a.score);

        const headers = ['Author', 'Score', 'Commits', '+Lines', '-Lines', 'Last Active'];
        const rows = scored.map((a) => [
          a.name,
          formatBar(a.score),
          a.commits.toString(),
          `+${a.linesAdded}`,
          `-${a.linesDeleted}`,
          daysAgoString(a.lastCommit, nowSec),
        ]);

        const topAuthor = scored[0];
        const busFactor = scored.filter((a) => a.score >= 30).length;

        const summary = [
          `## Knowledge Map: ${path} (last ${days} days)\n`,
          `**Primary expert**: ${topAuthor.name} (score: ${topAuthor.score}/100)`,
          `**Bus factor**: ${busFactor} (authors with score >= 30)\n`,
          formatTable(headers, rows, { alignRight: new Set([2, 3, 4]) }),
          `\n\n**Score formula**: 30% volume (lines changed) + 30% frequency (commits) + 40% recency (exponential decay, 30-day half-life).`,
          busFactor === 1
            ? `\n⚠️ **Knowledge silo detected**: Only one author has significant knowledge of this area. Consider pair programming or knowledge transfer sessions.`
            : '',
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
