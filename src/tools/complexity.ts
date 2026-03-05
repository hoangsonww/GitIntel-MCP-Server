import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec, gitLines } from '../git/executor.js';
import { validatePathFilter } from '../git/repo.js';
import { textResult, errorResult, formatTable } from '../util/formatting.js';

interface ComplexitySnapshot {
  hash: string;
  date: string;
  lines: number;
  maxIndent: number;
  avgIndent: number;
  longLines: number; // lines > 120 chars
  functionCount: number;
}

export function registerComplexityTrend(server: McpServer, repoRoot: string) {
  server.registerTool(
    'complexity_trend',
    {
      title: 'Complexity Trend',
      description:
        "Track how a file's complexity has changed over time by sampling its state at regular intervals in git history. " +
        'Identifies files growing out of control, complexity spikes from specific commits, and files that need splitting.',
      inputSchema: z.object({
        path: z.string().describe('File path to analyze (relative to repo root)'),
        samples: z
          .number()
          .int()
          .min(3)
          .max(30)
          .default(10)
          .describe('Number of time samples (default: 10, max: 30)'),
        days: z.number().int().positive().default(180).describe('Days to look back (default: 180)'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { path, samples, days } = args;
        const cleanPath = validatePathFilter(path, repoRoot);
        const since = `${days} days ago`;

        // Get commits that touched this file
        const commitLines = await gitLines(
          ['log', '--format=%H|%aI', '--no-merges', `--since=${since}`, '--', cleanPath],
          { cwd: repoRoot },
        );

        if (commitLines.length === 0) {
          return textResult(`No commits found for "${path}" in the last ${days} days.`);
        }

        // Sample evenly across the commit history
        const commits = commitLines.map((line) => {
          const [hash, date] = line.split('|');
          return { hash, date };
        });

        const step = Math.max(1, Math.floor(commits.length / samples));
        const sampled: Array<{ hash: string; date: string }> = [];
        for (let i = 0; i < commits.length && sampled.length < samples; i += step) {
          sampled.push(commits[i]);
        }
        // Always include the oldest commit
        if (sampled[sampled.length - 1] !== commits[commits.length - 1]) {
          sampled.push(commits[commits.length - 1]);
        }
        sampled.reverse(); // chronological order

        // Analyze each snapshot
        const snapshots: ComplexitySnapshot[] = [];
        for (const { hash, date } of sampled) {
          const { stdout: fileContent } = await gitExec(['show', `${hash}:${cleanPath}`], {
            cwd: repoRoot,
          });

          if (!fileContent) continue;

          const lines = fileContent.split('\n');
          const nonEmpty = lines.filter((l) => l.trim().length > 0);

          // Calculate indentation metrics
          let totalIndent = 0;
          let maxIndent = 0;
          for (const line of nonEmpty) {
            const leadingSpaces = line.match(/^(\s*)/)?.[1].length ?? 0;
            // Normalize tabs to 4 spaces
            const indent = Math.floor(
              (line.match(/^\t*/)?.[0].length ?? 0) * 4 +
                (leadingSpaces - (line.match(/^\t*/)?.[0].length ?? 0)),
            );
            const indentLevel = Math.floor(indent / 2);
            totalIndent += indentLevel;
            if (indentLevel > maxIndent) maxIndent = indentLevel;
          }

          // Count function-like patterns (language-agnostic heuristic)
          const functionPatterns =
            /\b(function|def|fn|func|pub\s+fn|async\s+fn|async\s+function|export\s+function|export\s+async\s+function|const\s+\w+\s*=\s*(?:async\s*)?\(|(?:get|set)\s+\w+\s*\()\b/g;
          const functionCount = (fileContent.match(functionPatterns) || []).length;

          snapshots.push({
            hash: hash.slice(0, 8),
            date: date.slice(0, 10),
            lines: nonEmpty.length,
            maxIndent,
            avgIndent:
              nonEmpty.length > 0 ? Math.round((totalIndent / nonEmpty.length) * 10) / 10 : 0,
            longLines: lines.filter((l) => l.length > 120).length,
            functionCount,
          });
        }

        if (snapshots.length === 0) {
          return textResult(`Could not read file content from git history for "${path}".`);
        }

        // Build sparkline-like trend indicators
        const first = snapshots[0];
        const last = snapshots[snapshots.length - 1];
        const linesDelta = last.lines - first.lines;
        const complexityDelta = last.avgIndent - first.avgIndent;
        const funcDelta = last.functionCount - first.functionCount;

        const trend = (delta: number) =>
          delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : '→ 0';

        const headers = [
          'Date',
          'Commit',
          'Lines',
          'Max Depth',
          'Avg Depth',
          'Long Lines',
          'Functions',
        ];
        const rows = snapshots.map((s) => [
          s.date,
          s.hash,
          s.lines.toString(),
          s.maxIndent.toString(),
          s.avgIndent.toString(),
          s.longLines.toString(),
          s.functionCount.toString(),
        ]);

        const summary = [
          `## Complexity Trend: ${path} (last ${days} days)\n`,
          `Sampled ${snapshots.length} points across ${commits.length} commits.\n`,
          `**Lines**: ${first.lines} → ${last.lines} (${trend(linesDelta)})`,
          `**Avg Depth**: ${first.avgIndent} → ${last.avgIndent} (${trend(complexityDelta)})`,
          `**Functions**: ${first.functionCount} → ${last.functionCount} (${trend(funcDelta)})\n`,
          formatTable(headers, rows, { alignRight: new Set([2, 3, 4, 5, 6]) }),
        ];

        // Add warnings
        if (last.lines > 300) {
          summary.push(
            `\n⚠️ **Large file** (${last.lines} lines): Consider splitting into smaller modules.`,
          );
        }
        if (last.maxIndent > 6) {
          summary.push(
            `\n⚠️ **Deep nesting** (max depth ${last.maxIndent}): Consider extracting nested logic into helper functions.`,
          );
        }
        if (linesDelta > 100) {
          summary.push(
            `\n⚠️ **Rapid growth** (+${linesDelta} lines): This file may be accumulating too many responsibilities.`,
          );
        }
        if (last.functionCount > 15) {
          summary.push(
            `\n⚠️ **Many functions** (${last.functionCount}): Consider splitting into separate modules by concern.`,
          );
        }

        return textResult(summary.join('\n'));
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
