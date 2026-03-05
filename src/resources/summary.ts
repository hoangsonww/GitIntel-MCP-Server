import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec, gitLines } from '../git/executor.js';

export function registerSummaryResource(server: McpServer, repoRoot: string) {
  server.registerResource(
    'repo-summary',
    'git://repo/summary',
    {
      description:
        'Repository snapshot: branch, last commit, total commits, active contributors, top languages, and age.',
      mimeType: 'text/plain',
    },
    async () => {
      const parts: string[] = [];

      // Current branch
      const { stdout: branch } = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoRoot,
      });
      parts.push(`Branch: ${branch.trim()}`);

      // Last commit
      const { stdout: lastCommit } = await gitExec(['log', '-1', '--format=%H|%aN|%aI|%s'], {
        cwd: repoRoot,
      });
      if (lastCommit.trim()) {
        const [hash, author, date, subject] = lastCommit.trim().split('|');
        parts.push(`Last commit: ${hash.slice(0, 8)} by ${author} on ${date.slice(0, 10)}`);
        parts.push(`  "${subject}"`);
      }

      // Total commits
      const { stdout: totalCommits } = await gitExec(['rev-list', '--count', 'HEAD'], {
        cwd: repoRoot,
      });
      parts.push(`Total commits: ${totalCommits.trim()}`);

      // Active contributors (last 90 days)
      const contributors = await gitLines(['log', '--format=%aN', '--since=90 days ago'], {
        cwd: repoRoot,
      });
      const uniqueContributors = new Set(contributors);
      parts.push(`Active contributors (90d): ${uniqueContributors.size}`);

      // All-time contributors
      const allContributors = await gitLines(['log', '--format=%aN'], { cwd: repoRoot });
      const allUniqueContributors = new Set(allContributors);
      parts.push(`Total contributors: ${allUniqueContributors.size}`);

      // Repository age
      const { stdout: firstCommit } = await gitExec(
        ['log', '--reverse', '--format=%aI', '--max-count=1'],
        { cwd: repoRoot },
      );
      if (firstCommit.trim()) {
        const firstDate = firstCommit.trim().slice(0, 10);
        const ageMs = Date.now() - new Date(firstDate).getTime();
        const ageDays = Math.floor(ageMs / 86400000);
        const ageMonths = Math.floor(ageDays / 30);
        const ageYears = Math.floor(ageDays / 365);
        const ageStr =
          ageYears > 0
            ? `${ageYears} year${ageYears > 1 ? 's' : ''}`
            : `${ageMonths} month${ageMonths > 1 ? 's' : ''}`;
        parts.push(`Repository age: ${ageStr} (since ${firstDate})`);
      }

      // Top file extensions (proxy for languages)
      const fileLines = await gitLines(['ls-files'], { cwd: repoRoot });
      const extCounts = new Map<string, number>();
      for (const file of fileLines) {
        const extMatch = file.match(/\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
          const ext = extMatch[1].toLowerCase();
          extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
        }
      }
      const topExts = [...extCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([ext, count]) => `${ext} (${count})`)
        .join(', ');
      parts.push(`Top file types: ${topExts}`);
      parts.push(`Total tracked files: ${fileLines.length}`);

      // Remote
      const { stdout: remote } = await gitExec(['remote', 'get-url', 'origin'], { cwd: repoRoot });
      if (remote.trim()) {
        parts.push(`Remote: ${remote.trim()}`);
      }

      return {
        contents: [
          {
            uri: 'git://repo/summary',
            text: parts.join('\n'),
            mimeType: 'text/plain',
          },
        ],
      };
    },
  );
}
