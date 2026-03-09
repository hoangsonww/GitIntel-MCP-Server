import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { validatePathFilter } from '../git/repo.js';
import { textResult, errorResult, formatTable, formatBar } from '../util/formatting.js';
import { getEffectiveRepo } from '../util/resolve-repo.js';

export function registerCodeAge(server: McpServer, repoRoot: string | null) {
  server.registerTool(
    'code_age',
    {
      title: 'Code Age Analysis',
      description:
        'Show the age of code in each file — when it was last modified. Identifies stale files that ' +
        "haven't been touched in months or years (potential dead code or abandoned features) vs " +
        'actively maintained areas. Useful for cleanup planning, onboarding, and understanding which ' +
        'parts of the codebase are actively evolving. ' +
        'NOTE: If the server was not started inside a git repo, you MUST provide repo_path.',
      inputSchema: z.object({
        repo_path: z
          .string()
          .optional()
          .describe(
            'Absolute path to the git repository to analyze. Required if Claude Code was not opened in a git repo.',
          ),
        path_filter: z
          .string()
          .optional()
          .describe('Filter to files under this path (e.g., "src/")'),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(30)
          .describe('Max files to return (default: 30, max: 100)'),
        sort: z
          .enum(['oldest', 'newest'])
          .default('oldest')
          .describe(
            'Sort order: "oldest" shows stalest files first, "newest" shows most recent first',
          ),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { repo_path, path_filter, limit, sort } = args;
        const effectiveRepo = await getEffectiveRepo(repo_path, repoRoot);

        let pathArg: string | undefined;
        if (path_filter) {
          pathArg = validatePathFilter(path_filter, effectiveRepo);
        }

        // Get list of tracked files
        const lsArgs = ['ls-files', '--'];
        if (pathArg) lsArgs.push(pathArg);

        const { stdout: lsOut } = await gitExec(lsArgs, { cwd: effectiveRepo });
        const files = lsOut
          .split('\n')
          .map((f) => f.trim())
          .filter((f) => f.length > 0);

        if (files.length === 0) {
          return textResult(
            path_filter
              ? `No tracked files found under "${path_filter}".`
              : 'No tracked files found.',
          );
        }

        // Get last commit date for each file using a single git log call per file
        // For efficiency, batch with git log --format and --diff-filter
        const { stdout: logOut } = await gitExec(
          [
            'log',
            '--format=ENTRY:%H|%aN|%aI|%s',
            '--name-only',
            '--diff-filter=AMRC',
            '--no-merges',
            '--',
            ...(pathArg ? [pathArg] : ['.']),
          ],
          { cwd: effectiveRepo },
        );

        // Build map: file -> {lastDate, lastAuthor, lastSubject, lastHash}
        interface FileAge {
          lastDate: string;
          lastAuthor: string;
          lastSubject: string;
          lastHash: string;
        }

        const fileAgeMap = new Map<string, FileAge>();
        let currentEntry: { hash: string; author: string; date: string; subject: string } | null =
          null;

        for (const raw of logOut.split('\n')) {
          const line = raw.trim();
          if (!line) continue;

          if (line.startsWith('ENTRY:')) {
            const parts = line.slice(6).split('|');
            currentEntry = {
              hash: parts[0].slice(0, 8),
              author: parts[1],
              date: parts[2],
              subject: parts.slice(3).join('|'),
            };
            continue;
          }

          // It's a filename — only record the first (most recent) occurrence
          if (currentEntry && !fileAgeMap.has(line)) {
            fileAgeMap.set(line, {
              lastDate: currentEntry.date,
              lastAuthor: currentEntry.author,
              lastSubject: currentEntry.subject,
              lastHash: currentEntry.hash,
            });
          }
        }

        // Build results for tracked files that have history
        const now = Date.now();
        const results: Array<{ file: string; age: FileAge; daysAgo: number }> = [];

        for (const file of files) {
          const age = fileAgeMap.get(file);
          if (!age) continue;
          const fileDate = new Date(age.lastDate).getTime();
          const daysAgo = Math.floor((now - fileDate) / 86_400_000);
          results.push({ file, age, daysAgo });
        }

        if (results.length === 0) {
          return textResult('No file age data found.');
        }

        // Sort
        if (sort === 'oldest') {
          results.sort((a, b) => b.daysAgo - a.daysAgo);
        } else {
          results.sort((a, b) => a.daysAgo - b.daysAgo);
        }

        const top = results.slice(0, limit);

        // Age distribution summary
        const allDays = results.map((r) => r.daysAgo);
        const stale90 = allDays.filter((d) => d > 90).length;
        const stale180 = allDays.filter((d) => d > 180).length;
        const stale365 = allDays.filter((d) => d > 365).length;
        const maxDays = Math.max(...allDays);
        const minDays = Math.min(...allDays);

        const ageLabel = (days: number): string => {
          if (days === 0) return 'today';
          if (days === 1) return '1 day';
          if (days < 30) return `${days} days`;
          if (days < 365) return `${Math.floor(days / 30)} months`;
          return `${(days / 365).toFixed(1)} years`;
        };

        // Absolute staleness scale: 0 = today, 100 = 1 year+
        // This avoids misleading bars in young repos where relative min-max
        // would make 4-day-old files look "maximally stale".
        const absoluteStaleness = (days: number): number =>
          Math.round(Math.min(100, (days / 365) * 100));

        const headers = ['File', 'Last Modified', 'Age', 'Author', 'Staleness'];
        const rows = top.map((r) => [
          r.file,
          r.age.lastDate.slice(0, 10),
          ageLabel(r.daysAgo),
          r.age.lastAuthor,
          formatBar(absoluteStaleness(r.daysAgo)),
        ]);

        const summary = [
          `## Code Age Analysis${path_filter ? `: ${path_filter}` : ''}\n`,
          `**${results.length} files** analyzed | Showing ${sort === 'oldest' ? 'stalest' : 'most recent'} ${top.length}\n`,
          `### Age Distribution\n`,
          `- Not touched in **>90 days**: ${stale90} files (${Math.round((stale90 / results.length) * 100)}%)`,
          `- Not touched in **>180 days**: ${stale180} files (${Math.round((stale180 / results.length) * 100)}%)`,
          `- Not touched in **>1 year**: ${stale365} files (${Math.round((stale365 / results.length) * 100)}%)\n`,
          formatTable(headers, rows, { alignRight: new Set([]) }),
          `\n\n**Interpretation**: High-staleness files may be stable infrastructure that rarely needs changes, ` +
            `or abandoned code that should be reviewed for removal. Cross-reference with hotspots to distinguish the two.`,
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
