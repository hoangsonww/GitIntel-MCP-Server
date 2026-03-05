import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { validatePathFilter } from '../git/repo.js';
import { getLogFormat, parseLog } from '../git/parser.js';
import { textResult, errorResult, formatTable, formatBar } from '../util/formatting.js';
import { normalize } from '../util/scoring.js';

export function registerHotspots(server: McpServer, repoRoot: string) {
  server.registerTool(
    'hotspots',
    {
      title: 'Change Hotspots',
      description:
        'Find files that change most frequently. High change frequency correlates with defect density — the top 4% of files by change frequency typically contain 50%+ of bugs. Use this to identify files that need refactoring, better test coverage, or architectural attention.',
      inputSchema: z.object({
        days: z
          .number()
          .int()
          .positive()
          .default(90)
          .describe('Number of days to look back (default: 90)'),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(20)
          .describe('Max results to return (default: 20, max: 100)'),
        path_filter: z
          .string()
          .optional()
          .describe('Filter to files under this path (e.g., "src/api")'),
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

        // Get log with file stats
        const logArgs = [
          'log',
          '--format=%H|%aN|%aI',
          '--name-only',
          '--no-merges',
          `--since=${since}`,
          '--',
        ];
        if (pathArg) logArgs.push(pathArg);

        const { stdout } = await gitExec(logArgs, { cwd: repoRoot });
        if (!stdout.trim()) {
          return textResult('No commits found in the specified time range.');
        }

        // Parse: group files by change frequency
        const fileStats = new Map<
          string,
          { changes: number; authors: Set<string>; lastDate: string }
        >();
        const commits = stdout.split('\n\n').filter((c) => c.trim());

        for (const commit of commits) {
          const lines = commit.split('\n').filter((l) => l.trim());
          if (lines.length === 0) continue;

          const headerMatch = lines[0].match(/^([a-f0-9]+)\|(.+)\|(.+)$/);
          if (!headerMatch) continue;

          const author = headerMatch[2];
          const date = headerMatch[3];

          for (let i = 1; i < lines.length; i++) {
            const file = lines[i].trim();
            if (!file) continue;

            const existing = fileStats.get(file);
            if (existing) {
              existing.changes++;
              existing.authors.add(author);
              if (date > existing.lastDate) existing.lastDate = date;
            } else {
              fileStats.set(file, {
                changes: 1,
                authors: new Set([author]),
                lastDate: date,
              });
            }
          }
        }

        // Sort by change count descending
        const sorted = [...fileStats.entries()]
          .sort((a, b) => b[1].changes - a[1].changes)
          .slice(0, limit);

        if (sorted.length === 0) {
          return textResult('No file changes found in the specified time range.');
        }

        const maxChanges = sorted[0][1].changes;
        const minChanges = sorted[sorted.length - 1][1].changes;

        const headers = ['File', 'Changes', 'Authors', 'Last Changed', 'Heat'];
        const rows = sorted.map(([file, stats]) => [
          file,
          stats.changes.toString(),
          stats.authors.size.toString(),
          stats.lastDate.slice(0, 10),
          formatBar(normalize(stats.changes, minChanges, maxChanges)),
        ]);

        const totalFiles = fileStats.size;
        const hotCount = sorted.length;
        const summary = [
          `## Change Hotspots (last ${days} days)\n`,
          `Analyzed ${totalFiles} changed files. Showing top ${hotCount}.\n`,
          formatTable(headers, rows, { alignRight: new Set([1, 2]) }),
          `\n\n**Interpretation**: Files with high change frequency are likely candidates for refactoring, ` +
            `better test coverage, or breaking into smaller modules. Files changed by many authors may ` +
            `indicate unclear ownership or shared concerns that should be separated.`,
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
