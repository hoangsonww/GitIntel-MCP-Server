import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { textResult, errorResult, formatTable, formatBar } from '../util/formatting.js';
import { daysAgoString } from '../util/scoring.js';
import { getEffectiveRepo } from '../util/resolve-repo.js';

interface ContributorProfile {
  name: string;
  email: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: Set<string>;
  directories: Map<string, number>; // directory -> commit count
  firstCommit: number;
  lastCommit: number;
  commitHours: Map<number, number>; // hour -> count
  coAuthors: Map<string, number>; // author -> shared file count
}

export function registerContributorStats(server: McpServer, repoRoot: string | null) {
  server.registerTool(
    'contributor_stats',
    {
      title: 'Contributor Statistics',
      description:
        'Comprehensive contributor analytics: who is active, what areas they work in, their commit patterns, ' +
        'and collaboration graph. Useful for understanding team dynamics, identifying knowledge silos, ' +
        'onboarding planning, and workload distribution. ' +
        'NOTE: If the server was not started inside a git repo, you MUST provide repo_path.',
      inputSchema: z.object({
        repo_path: z
          .string()
          .optional()
          .describe(
            'Absolute path to the git repository to analyze. Required if Claude Code was not opened in a git repo.',
          ),
        days: z.number().int().positive().default(90).describe('Days to look back (default: 90)'),
        author: z.string().optional().describe('Filter to a specific author name (partial match)'),
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
        const nowSec = Math.floor(Date.now() / 1000);

        const logArgs = [
          'log',
          '--format=COMMIT:%aN|%aE|%at|%aI',
          '--numstat',
          '--no-merges',
          `--since=${since}`,
        ];
        if (author) {
          logArgs.push(`--author=${author}`);
        }
        logArgs.push('--');

        const { stdout } = await gitExec(logArgs, { cwd: effectiveRepo });
        if (!stdout.trim()) {
          return textResult(
            `No commits found in the last ${days} days${author ? ` for "${author}"` : ''}.`,
          );
        }

        const profiles = new Map<string, ContributorProfile>();
        const fileAuthors = new Map<string, Set<string>>(); // file -> set of authors
        let currentAuthor: { name: string; email: string; timestamp: number; hour: number } | null =
          null;

        for (const line of stdout.split('\n')) {
          if (line.startsWith('COMMIT:')) {
            const parts = line.slice(7).split('|');
            if (parts.length >= 4) {
              const dateStr = parts[3];
              const hour = parseInt(dateStr.slice(11, 13), 10);
              currentAuthor = {
                name: parts[0],
                email: parts[1],
                timestamp: parseInt(parts[2], 10),
                hour,
              };

              // Initialize profile
              if (!profiles.has(currentAuthor.name)) {
                profiles.set(currentAuthor.name, {
                  name: currentAuthor.name,
                  email: currentAuthor.email,
                  commits: 0,
                  linesAdded: 0,
                  linesDeleted: 0,
                  filesChanged: new Set(),
                  directories: new Map(),
                  firstCommit: currentAuthor.timestamp,
                  lastCommit: currentAuthor.timestamp,
                  commitHours: new Map(),
                  coAuthors: new Map(),
                });
              }

              const profile = profiles.get(currentAuthor.name)!;
              profile.commits++;
              profile.commitHours.set(hour, (profile.commitHours.get(hour) ?? 0) + 1);

              if (currentAuthor.timestamp < profile.firstCommit) {
                profile.firstCommit = currentAuthor.timestamp;
              }
              if (currentAuthor.timestamp > profile.lastCommit) {
                profile.lastCommit = currentAuthor.timestamp;
              }
            }
            continue;
          }

          if (!currentAuthor) continue;

          const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (!match) continue;

          const isBinary = match[1] === '-';
          const additions = isBinary ? 0 : parseInt(match[1], 10);
          const deletions = isBinary ? 0 : parseInt(match[2], 10);
          const file = match[3];

          const profile = profiles.get(currentAuthor.name)!;
          profile.linesAdded += additions;
          profile.linesDeleted += deletions;
          profile.filesChanged.add(file);

          // Track directory focus
          const dir = file.includes('/') ? file.split('/').slice(0, 2).join('/') : '(root)';
          profile.directories.set(dir, (profile.directories.get(dir) ?? 0) + 1);

          // Track file authorship for collaboration graph
          if (!fileAuthors.has(file)) {
            fileAuthors.set(file, new Set());
          }
          fileAuthors.get(file)!.add(currentAuthor.name);
        }

        // Build collaboration graph
        for (const [, authors] of fileAuthors) {
          const authorList = [...authors];
          for (let i = 0; i < authorList.length; i++) {
            for (let j = i + 1; j < authorList.length; j++) {
              const profileA = profiles.get(authorList[i]);
              const profileB = profiles.get(authorList[j]);
              if (profileA && profileB) {
                profileA.coAuthors.set(
                  authorList[j],
                  (profileA.coAuthors.get(authorList[j]) ?? 0) + 1,
                );
                profileB.coAuthors.set(
                  authorList[i],
                  (profileB.coAuthors.get(authorList[i]) ?? 0) + 1,
                );
              }
            }
          }
        }

        // Sort by commits
        const sorted = [...profiles.values()].sort((a, b) => b.commits - a.commits);

        if (sorted.length === 0) {
          return textResult('No contributor data found.');
        }

        // If single author, show detailed view
        if (sorted.length === 1 || author) {
          return textResult(buildDetailedProfile(sorted[0], nowSec, days));
        }

        // Overview table
        const maxCommits = sorted[0].commits;
        const headers = [
          'Author',
          'Commits',
          'Activity',
          '+Lines',
          '-Lines',
          'Files',
          'Last Active',
        ];
        const rows = sorted.map((p) => [
          p.name,
          p.commits.toString(),
          formatBar(Math.round((p.commits / maxCommits) * 100)),
          `+${p.linesAdded}`,
          `-${p.linesDeleted}`,
          p.filesChanged.size.toString(),
          daysAgoString(p.lastCommit, nowSec),
        ]);

        const parts = [
          `## Contributor Statistics (last ${days} days)\n`,
          `**${sorted.length} contributors**, ${sorted.reduce((s, p) => s + p.commits, 0)} total commits\n`,
          formatTable(headers, rows, { alignRight: new Set([1, 3, 4, 5]) }),
        ];

        // Top collaboration pairs
        const collabPairs = new Map<string, number>();
        for (const profile of sorted) {
          for (const [coAuthor, count] of profile.coAuthors) {
            const key = [profile.name, coAuthor].sort().join(' <-> ');
            collabPairs.set(key, Math.max(collabPairs.get(key) ?? 0, count));
          }
        }

        const topCollabs = [...collabPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

        if (topCollabs.length > 0) {
          parts.push(`\n\n### Top Collaborations (shared files)\n`);
          for (const [pair, count] of topCollabs) {
            parts.push(`- ${pair}: ${count} shared files`);
          }
        }

        // Knowledge silos
        const soloFiles = new Map<string, number>();
        for (const [file, authors] of fileAuthors) {
          if (authors.size === 1) {
            const soloAuthor = [...authors][0];
            soloFiles.set(soloAuthor, (soloFiles.get(soloAuthor) ?? 0) + 1);
          }
        }

        const siloAuthors = [...soloFiles.entries()]
          .filter(([, count]) => count >= 5)
          .sort((a, b) => b[1] - a[1]);

        if (siloAuthors.length > 0) {
          parts.push(`\n\n### ⚠️ Knowledge Silos\n`);
          parts.push(`These authors are the sole contributor to many files:\n`);
          for (const [authorName, count] of siloAuthors) {
            parts.push(`- **${authorName}**: ${count} files with no other contributors`);
          }
        }

        return textResult(parts.join('\n'));
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function buildDetailedProfile(profile: ContributorProfile, nowSec: number, days: number): string {
  const parts: string[] = [];

  parts.push(`## Contributor Profile: ${profile.name}`);
  parts.push(`**Email**: ${profile.email}`);
  parts.push(`**Period**: last ${days} days\n`);

  parts.push(`### Activity Summary\n`);
  parts.push(`- **Commits**: ${profile.commits}`);
  parts.push(`- **Lines added**: +${profile.linesAdded}`);
  parts.push(`- **Lines deleted**: -${profile.linesDeleted}`);
  parts.push(`- **Files touched**: ${profile.filesChanged.size}`);
  parts.push(`- **First commit**: ${daysAgoString(profile.firstCommit, nowSec)}`);
  parts.push(`- **Last commit**: ${daysAgoString(profile.lastCommit, nowSec)}`);

  // Focus areas
  const topDirs = [...profile.directories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  parts.push(`\n### Focus Areas\n`);
  for (const [dir, count] of topDirs) {
    const pct = Math.round((count / profile.commits) * 100);
    parts.push(`- ${dir}: ${count} commits (${pct}%)`);
  }

  // Active hours
  const hourCounts = [...profile.commitHours.entries()].sort((a, b) => a[0] - b[0]);
  if (hourCounts.length > 0) {
    const peakHour = hourCounts.reduce((max, [h, c]) => (c > max[1] ? [h, c] : max), [0, 0]);
    parts.push(`\n### Commit Time Pattern\n`);
    parts.push(`**Peak hour**: ${peakHour[0]}:00 (${peakHour[1]} commits)\n`);

    // Simple hour histogram
    const maxHourCount = Math.max(...hourCounts.map(([, c]) => c));
    for (const [hour, count] of hourCounts) {
      const bar = '█'.repeat(Math.round((count / maxHourCount) * 20));
      parts.push(`${hour.toString().padStart(2, '0')}:00  ${bar} ${count}`);
    }
  }

  // Collaborators
  const topCollabs = [...profile.coAuthors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (topCollabs.length > 0) {
    parts.push(`\n### Top Collaborators\n`);
    for (const [coAuthor, sharedFiles] of topCollabs) {
      parts.push(`- ${coAuthor}: ${sharedFiles} shared files`);
    }
  }

  return parts.join('\n');
}
