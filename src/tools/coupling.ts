import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { validatePathFilter } from '../git/repo.js';
import { textResult, errorResult, formatTable } from '../util/formatting.js';
import { couplingScore } from '../util/scoring.js';

interface CoupledPair {
  fileA: string;
  fileB: string;
  sharedCommits: number;
  commitsA: number;
  commitsB: number;
  coupling: number;
  sampleSubjects: string[];
}

export function registerCoupling(server: McpServer, repoRoot: string) {
  server.registerTool(
    'coupling',
    {
      title: 'Temporal Coupling',
      description:
        'Find files that always change together (temporal coupling). These represent hidden dependencies ' +
        'not visible in imports or type signatures. If auth.ts and middleware.ts change together in 90% ' +
        'of commits, refactoring one without the other will likely break things.',
      inputSchema: z.object({
        days: z.number().int().positive().default(90).describe('Days to look back (default: 90)'),
        min_coupling: z.number().min(0).max(1).default(0.5).describe('Minimum coupling score 0-1 (default: 0.5)'),
        min_commits: z.number().int().positive().default(3).describe('Minimum shared commits to report (default: 3)'),
        limit: z.number().int().positive().max(50).default(20).describe('Max pairs to return (default: 20)'),
        path_filter: z.string().optional().describe('Filter to files under this path'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { days, min_coupling, min_commits, limit, path_filter } = args;
        const since = `${days} days ago`;

        let pathArg: string | undefined;
        if (path_filter) {
          pathArg = validatePathFilter(path_filter, repoRoot);
        }

        // Get commits with their files
        const logArgs = [
          'log',
          '--format=COMMIT:%H|%s',
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

        // Build commit-to-files mapping
        const commitFiles: Array<{ hash: string; subject: string; files: string[] }> = [];
        const fileCommitCount = new Map<string, number>();

        let current: { hash: string; subject: string; files: string[] } | null = null;

        for (const line of stdout.split('\n')) {
          if (line.startsWith('COMMIT:')) {
            if (current && current.files.length > 0) {
              commitFiles.push(current);
            }
            const parts = line.slice(7).split('|');
            current = { hash: parts[0], subject: parts.slice(1).join('|'), files: [] };
            continue;
          }

          const file = line.trim();
          if (file && current) {
            current.files.push(file);
            fileCommitCount.set(file, (fileCommitCount.get(file) ?? 0) + 1);
          }
        }
        if (current && current.files.length > 0) {
          commitFiles.push(current);
        }

        // Build co-change matrix (only for files that appear in multi-file commits)
        const pairKey = (a: string, b: string) => a < b ? `${a}\0${b}` : `${b}\0${a}`;
        const pairStats = new Map<string, { count: number; subjects: string[] }>();

        for (const commit of commitFiles) {
          if (commit.files.length < 2 || commit.files.length > 50) continue;

          // Generate all pairs (cap at 50 files per commit to avoid combinatorial explosion)
          for (let i = 0; i < commit.files.length; i++) {
            for (let j = i + 1; j < commit.files.length; j++) {
              const key = pairKey(commit.files[i], commit.files[j]);
              const existing = pairStats.get(key);
              if (existing) {
                existing.count++;
                if (existing.subjects.length < 3) {
                  existing.subjects.push(commit.subject);
                }
              } else {
                pairStats.set(key, { count: 1, subjects: [commit.subject] });
              }
            }
          }
        }

        // Calculate coupling scores and filter
        const pairs: CoupledPair[] = [];
        for (const [key, stats] of pairStats) {
          if (stats.count < min_commits) continue;

          const [fileA, fileB] = key.split('\0');
          const commitsA = fileCommitCount.get(fileA) ?? 0;
          const commitsB = fileCommitCount.get(fileB) ?? 0;
          const score = couplingScore(stats.count, commitsA, commitsB);

          if (score < min_coupling) continue;

          pairs.push({
            fileA,
            fileB,
            sharedCommits: stats.count,
            commitsA,
            commitsB,
            coupling: score,
            sampleSubjects: stats.subjects,
          });
        }

        // Sort by coupling score descending
        pairs.sort((a, b) => b.coupling - a.coupling || b.sharedCommits - a.sharedCommits);
        const top = pairs.slice(0, limit);

        if (top.length === 0) {
          return textResult(
            `No file pairs found with coupling >= ${min_coupling} and >= ${min_commits} shared commits ` +
            `in the last ${days} days.`,
          );
        }

        const headers = ['File A', 'File B', 'Coupling', 'Shared', 'A total', 'B total'];
        const rows = top.map((p) => [
          p.fileA,
          p.fileB,
          p.coupling.toFixed(2),
          p.sharedCommits.toString(),
          p.commitsA.toString(),
          p.commitsB.toString(),
        ]);

        const details = top
          .slice(0, 5)
          .map(
            (p) =>
              `**${p.fileA} <-> ${p.fileB}** (coupling: ${p.coupling.toFixed(2)})\n` +
              `  Sample commits: ${p.sampleSubjects.map((s) => `"${s}"`).join(', ')}`,
          )
          .join('\n\n');

        const summary = [
          `## Temporal Coupling (last ${days} days)\n`,
          `Found ${pairs.length} coupled pairs (showing top ${top.length}, min coupling: ${min_coupling}).\n`,
          formatTable(headers, rows, { alignRight: new Set([2, 3, 4, 5]) }),
          `\n\n### Top Coupled Pairs — Sample Commits\n`,
          details,
          `\n\n**Interpretation**: High coupling means these files are logically connected. Consider:`,
          `- Should they be merged into one module?`,
          `- Is there a missing abstraction that would decouple them?`,
          `- At minimum, changes to one should trigger review of the other.`,
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
