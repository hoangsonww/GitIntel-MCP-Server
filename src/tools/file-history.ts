import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { validatePathFilter } from '../git/repo.js';
import { textResult, errorResult, formatTable, shortDate } from '../util/formatting.js';
import { getEffectiveRepo } from '../util/resolve-repo.js';

export function registerFileHistory(server: McpServer, repoRoot: string | null) {
  server.registerTool(
    'file_history',
    {
      title: 'File History',
      description:
        'Show the full commit history of a specific file — who changed it, when, how much, and why. ' +
        'Useful for understanding why a file looks the way it does, finding when a bug was introduced, ' +
        'or tracing the evolution of a module. Uses --follow to track renames. ' +
        'NOTE: If the server was not started inside a git repo, you MUST provide repo_path.',
      inputSchema: z.object({
        repo_path: z
          .string()
          .optional()
          .describe(
            'Absolute path to the git repository to analyze. Required if Claude Code was not opened in a git repo.',
          ),
        path: z.string().describe('File path to analyze (e.g., "src/index.ts")'),
        days: z
          .number()
          .int()
          .positive()
          .default(365)
          .describe('Number of days to look back (default: 365)'),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(30)
          .describe('Max commits to return (default: 30, max: 100)'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { repo_path, path, days, limit } = args;
        const effectiveRepo = await getEffectiveRepo(repo_path, repoRoot);
        const safePath = validatePathFilter(path, effectiveRepo);
        const since = `${days} days ago`;

        const { stdout } = await gitExec(
          [
            'log',
            '--follow',
            '--format=COMMIT:%H|%aN|%aI|%s',
            '--numstat',
            '--no-merges',
            `--since=${since}`,
            `-n`,
            `${limit}`,
            '--',
            safePath,
          ],
          { cwd: effectiveRepo },
        );

        if (!stdout.trim()) {
          return textResult(`No commits found for "${path}" in the last ${days} days.`);
        }

        interface HistoryEntry {
          hash: string;
          author: string;
          date: string;
          subject: string;
          additions: number;
          deletions: number;
        }

        const entries: HistoryEntry[] = [];
        let current: HistoryEntry | null = null;

        for (const raw of stdout.split('\n')) {
          const line = raw.trim();
          if (!line) continue;

          if (line.startsWith('COMMIT:')) {
            if (current) entries.push(current);
            const parts = line.slice(7).split('|');
            current = {
              hash: parts[0].slice(0, 8),
              author: parts[1],
              date: parts[2],
              subject: parts.slice(3).join('|'),
              additions: 0,
              deletions: 0,
            };
            continue;
          }

          if (current) {
            const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
            if (match && match[1] !== '-') {
              current.additions += parseInt(match[1], 10);
              current.deletions += parseInt(match[2], 10);
            }
          }
        }
        if (current) entries.push(current);

        if (entries.length === 0) {
          return textResult(`No file changes found for "${path}" in the last ${days} days.`);
        }

        // Collect unique authors
        const authors = new Set(entries.map((e) => e.author));
        const totalAdded = entries.reduce((s, e) => s + e.additions, 0);
        const totalDeleted = entries.reduce((s, e) => s + e.deletions, 0);

        const headers = ['Date', 'Commit', 'Author', '+Lines', '-Lines', 'Subject'];
        const rows = entries.map((e) => [
          shortDate(e.date),
          e.hash,
          e.author,
          `+${e.additions}`,
          `-${e.deletions}`,
          e.subject.length > 60 ? e.subject.slice(0, 57) + '...' : e.subject,
        ]);

        const summary = [
          `## File History: ${path} (last ${days} days)\n`,
          `**${entries.length} commits** by ${authors.size} author${authors.size === 1 ? '' : 's'} | +${totalAdded} / -${totalDeleted} lines\n`,
          formatTable(headers, rows, { alignRight: new Set([3, 4]) }),
          entries.length >= limit
            ? `\n\n*Showing most recent ${limit} commits. Increase limit for more.*`
            : '',
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
