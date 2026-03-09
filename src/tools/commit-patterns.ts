import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { textResult, errorResult, formatTable } from '../util/formatting.js';
import { getEffectiveRepo } from '../util/resolve-repo.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function registerCommitPatterns(server: McpServer, repoRoot: string | null) {
  server.registerTool(
    'commit_patterns',
    {
      title: 'Commit Patterns',
      description:
        'Analyze when and how the team commits — day-of-week distribution, hour-of-day heatmap, ' +
        'commit size breakdown, and weekly velocity trends. Reveals work patterns like weekend ' +
        'deployments, late-night hotfixes, or declining commit velocity. ' +
        'NOTE: If the server was not started inside a git repo, you MUST provide repo_path.',
      inputSchema: z.object({
        repo_path: z
          .string()
          .optional()
          .describe(
            'Absolute path to the git repository to analyze. Required if Claude Code was not opened in a git repo.',
          ),
        days: z
          .number()
          .int()
          .positive()
          .default(90)
          .describe('Number of days to look back (default: 90)'),
        author: z.string().optional().describe('Filter to a specific author (exact match on name)'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { repo_path, days, author } = args;
        const effectiveRepo = await getEffectiveRepo(repo_path, repoRoot);
        const since = `${days} days ago`;

        const logArgs = [
          'log',
          '--format=COMMIT:%aI|%aN',
          '--shortstat',
          '--no-merges',
          `--since=${since}`,
        ];
        if (author) {
          logArgs.push(`--author=${author}`);
        }

        const { stdout } = await gitExec(logArgs, { cwd: effectiveRepo });
        if (!stdout.trim()) {
          return textResult(
            author
              ? `No commits found for author "${author}" in the last ${days} days.`
              : `No commits found in the last ${days} days.`,
          );
        }

        interface CommitInfo {
          date: Date;
          author: string;
          filesChanged: number;
          insertions: number;
          deletions: number;
        }

        const commits: CommitInfo[] = [];
        let currentDate: Date | null = null;
        let currentAuthor = '';

        for (const raw of stdout.split('\n')) {
          const line = raw.trim();
          if (!line) continue;

          if (line.startsWith('COMMIT:')) {
            const parts = line.slice(7).split('|');
            currentDate = new Date(parts[0]);
            currentAuthor = parts.slice(1).join('|');
            continue;
          }

          // Parse shortstat line: " 3 files changed, 10 insertions(+), 5 deletions(-)"
          if (currentDate && line.includes('changed')) {
            const filesMatch = line.match(/(\d+)\s+file/);
            const insMatch = line.match(/(\d+)\s+insertion/);
            const delMatch = line.match(/(\d+)\s+deletion/);

            commits.push({
              date: currentDate,
              author: currentAuthor,
              filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
              insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
              deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
            });
            currentDate = null;
          }
        }

        // Handle commits with no stat line (empty commits)
        if (currentDate) {
          commits.push({
            date: currentDate,
            author: currentAuthor,
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
          });
        }

        if (commits.length === 0) {
          return textResult('No commit data found.');
        }

        // Day-of-week distribution
        const dayBuckets = new Array(7).fill(0);
        for (const c of commits) {
          dayBuckets[c.date.getDay()]++;
        }
        const maxDay = Math.max(...dayBuckets);

        const dayHeaders = ['Day', 'Commits', 'Distribution'];
        const dayRows = DAY_NAMES.map((name, i) => {
          const count = dayBuckets[i];
          const barLen = maxDay > 0 ? Math.round((count / maxDay) * 20) : 0;
          return [name, count.toString(), '█'.repeat(barLen)];
        });

        // Hour-of-day distribution
        const hourBuckets = new Array(24).fill(0);
        for (const c of commits) {
          hourBuckets[c.date.getHours()]++;
        }
        const maxHour = Math.max(...hourBuckets);

        // Compress hours into 4-hour blocks for readability
        const hourBlocks = [
          { label: '00-03 (night)', count: 0 },
          { label: '04-07 (early)', count: 0 },
          { label: '08-11 (morning)', count: 0 },
          { label: '12-15 (afternoon)', count: 0 },
          { label: '16-19 (evening)', count: 0 },
          { label: '20-23 (late)', count: 0 },
        ];
        for (let h = 0; h < 24; h++) {
          hourBlocks[Math.floor(h / 4)].count += hourBuckets[h];
        }
        const maxBlock = Math.max(...hourBlocks.map((b) => b.count));

        const hourHeaders = ['Time Block', 'Commits', 'Distribution'];
        const hourRows = hourBlocks.map((b) => {
          const barLen = maxBlock > 0 ? Math.round((b.count / maxBlock) * 20) : 0;
          return [b.label, b.count.toString(), '█'.repeat(barLen)];
        });

        // Commit size distribution
        const sizes = commits.map((c) => c.insertions + c.deletions);
        const small = sizes.filter((s) => s <= 20).length;
        const medium = sizes.filter((s) => s > 20 && s <= 100).length;
        const large = sizes.filter((s) => s > 100 && s <= 500).length;
        const huge = sizes.filter((s) => s > 500).length;

        const sizeHeaders = ['Size', 'Lines Changed', 'Count', 'Pct'];
        const sizeRows = [
          ['Small', '≤20', small.toString(), `${Math.round((small / commits.length) * 100)}%`],
          [
            'Medium',
            '21-100',
            medium.toString(),
            `${Math.round((medium / commits.length) * 100)}%`,
          ],
          ['Large', '101-500', large.toString(), `${Math.round((large / commits.length) * 100)}%`],
          ['Huge', '>500', huge.toString(), `${Math.round((huge / commits.length) * 100)}%`],
        ];

        // Weekly velocity (commits per week)
        const weekMap = new Map<string, number>();
        for (const c of commits) {
          const weekStart = new Date(c.date);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          const key = weekStart.toISOString().slice(0, 10);
          weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
        }
        const weeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const avgPerWeek = weeks.length > 0 ? (commits.length / weeks.length).toFixed(1) : '0';

        // Insights
        const insights: string[] = [];
        const weekendCommits = dayBuckets[0] + dayBuckets[6];
        const weekendPct = Math.round((weekendCommits / commits.length) * 100);
        if (weekendPct > 20) {
          insights.push(
            `- ⚠️ **${weekendPct}% of commits are on weekends** — potential burnout risk or release pressure.`,
          );
        }
        const lateNight = hourBlocks[0].count + hourBlocks[5].count;
        const lateNightPct = Math.round((lateNight / commits.length) * 100);
        if (lateNightPct > 25) {
          insights.push(
            `- ⚠️ **${lateNightPct}% of commits are late-night/early-morning** — review for quality and sustainability.`,
          );
        }
        if (huge > commits.length * 0.3) {
          insights.push(
            `- ⚠️ **${Math.round((huge / commits.length) * 100)}% of commits are huge (>500 lines)** — consider smaller, more reviewable changes.`,
          );
        }

        const summary = [
          `## Commit Patterns (last ${days} days)${author ? ` — ${author}` : ''}\n`,
          `**${commits.length} commits** across ${weeks.length} weeks | Avg: ${avgPerWeek} commits/week\n`,
          `### Day of Week\n`,
          formatTable(dayHeaders, dayRows, { alignRight: new Set([1]) }),
          `\n\n### Time of Day\n`,
          formatTable(hourHeaders, hourRows, { alignRight: new Set([1]) }),
          `\n\n### Commit Size Distribution\n`,
          formatTable(sizeHeaders, sizeRows, { alignRight: new Set([2, 3]) }),
          insights.length > 0 ? `\n\n### Insights\n\n${insights.join('\n')}` : '',
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
