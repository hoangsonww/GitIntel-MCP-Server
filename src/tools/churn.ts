import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { validatePathFilter } from '../git/repo.js';
import { textResult, errorResult, formatTable } from '../util/formatting.js';
import { churnRatio } from '../util/scoring.js';

interface FileChurn {
  additions: number;
  deletions: number;
  commits: number;
  netGrowth: number;
  churnRatio: number;
}

export function registerChurn(server: McpServer, repoRoot: string) {
  server.registerTool(
    'churn',
    {
      title: 'Code Churn Analysis',
      description:
        'Analyze code churn — how much code is being written and then rewritten. High churn indicates instability, unclear requirements, or code that is hard to get right. A file with 500 lines added and 400 deleted in a month is a red flag.',
      inputSchema: z.object({
        days: z.number().int().positive().default(90).describe('Number of days to look back (default: 90)'),
        limit: z.number().int().positive().max(100).default(20).describe('Max results to return (default: 20, max: 100)'),
        path_filter: z.string().optional().describe('Filter to files under this path'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { days, limit, path_filter } = args;
        const since = `${days} days ago`;

        let pathArg: string | undefined;
        if (path_filter) {
          pathArg = validatePathFilter(path_filter, repoRoot);
        }

        const logArgs = [
          'log',
          '--format=COMMIT:%H',
          '--numstat',
          '--no-merges',
          `--since=${since}`,
          '--',
        ];
        if (pathArg) logArgs.push(pathArg);

        const { stdout } = await gitExec(logArgs, { cwd: repoRoot });
        if (!stdout.trim()) {
          return textResult('No commits found in the specified time range.');
        }

        const fileChurn = new Map<string, FileChurn>();
        let currentCommitFiles = new Set<string>();

        for (const line of stdout.split('\n')) {
          if (line.startsWith('COMMIT:')) {
            // New commit — finalize previous
            currentCommitFiles = new Set();
            continue;
          }

          const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (!match) continue;

          const isBinary = match[1] === '-';
          if (isBinary) continue;

          const additions = parseInt(match[1], 10);
          const deletions = parseInt(match[2], 10);
          const file = match[3];

          const existing = fileChurn.get(file);
          if (existing) {
            existing.additions += additions;
            existing.deletions += deletions;
            if (!currentCommitFiles.has(file)) {
              existing.commits++;
              currentCommitFiles.add(file);
            }
          } else {
            fileChurn.set(file, {
              additions,
              deletions,
              commits: 1,
              netGrowth: 0,
              churnRatio: 0,
            });
            currentCommitFiles.add(file);
          }
        }

        // Calculate derived metrics
        for (const [, stats] of fileChurn) {
          stats.netGrowth = stats.additions - stats.deletions;
          stats.churnRatio = churnRatio(stats.additions, stats.deletions);
        }

        // Sort by total churn (additions + deletions) descending
        const sorted = [...fileChurn.entries()]
          .sort((a, b) => (b[1].additions + b[1].deletions) - (a[1].additions + a[1].deletions))
          .slice(0, limit);

        if (sorted.length === 0) {
          return textResult('No file changes found in the specified time range.');
        }

        const headers = ['File', 'Added', 'Deleted', 'Net', 'Churn', 'Commits'];
        const rows = sorted.map(([file, s]) => [
          file,
          `+${s.additions}`,
          `-${s.deletions}`,
          s.netGrowth >= 0 ? `+${s.netGrowth}` : `${s.netGrowth}`,
          s.churnRatio.toFixed(2),
          s.commits.toString(),
        ]);

        const totalAdditions = sorted.reduce((sum, [, s]) => sum + s.additions, 0);
        const totalDeletions = sorted.reduce((sum, [, s]) => sum + s.deletions, 0);

        const summary = [
          `## Code Churn Analysis (last ${days} days)\n`,
          `Total: +${totalAdditions} / -${totalDeletions} across ${fileChurn.size} files. Showing top ${sorted.length}.\n`,
          formatTable(headers, rows, { alignRight: new Set([1, 2, 3, 4, 5]) }),
          `\n\n**Churn ratio** = deletions / additions. Values near 1.0 mean code is being rewritten as fast as it's written.`,
          `High-churn files may indicate: unstable requirements, wrong abstraction, or code that's hard to get right.`,
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
