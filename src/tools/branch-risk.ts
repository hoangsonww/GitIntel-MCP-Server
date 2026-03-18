import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec, gitLines } from '../git/executor.js';
import { textResult, errorResult, formatTable, formatBar } from '../util/formatting.js';
import { getEffectiveRepo } from '../util/resolve-repo.js';

export function registerBranchRisk(server: McpServer, repoRoot: string | null) {
  server.registerTool(
    'branch_risk',
    {
      title: 'Branch Risk Analysis',
      description:
        'Analyze all branches for staleness, divergence from the main branch, and merge risk. ' +
        'Identifies stale branches that should be cleaned up, branches that have diverged significantly ' +
        'and may cause merge conflicts, and branches with no recent activity. ' +
        'NOTE: If the server was not started inside a git repo, you MUST provide repo_path.',
      inputSchema: z.object({
        repo_path: z
          .string()
          .optional()
          .describe(
            'Absolute path to the git repository to analyze. Required if Claude Code was not opened in a git repo.',
          ),
        base_branch: z
          .string()
          .default('HEAD')
          .describe('Branch to compare against (default: HEAD). Typically "main" or "master".'),
        include_remote: z
          .boolean()
          .default(false)
          .describe('Include remote tracking branches (default: false)'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { repo_path, base_branch, include_remote } = args;
        const effectiveRepo = await getEffectiveRepo(repo_path, repoRoot);

        // Get branch list
        const branchArgs = include_remote
          ? ['branch', '-a', '--format=%(refname:short)|%(committerdate:iso-strict)|%(authorname)']
          : ['branch', '--format=%(refname:short)|%(committerdate:iso-strict)|%(authorname)'];

        const branchLines = await gitLines(branchArgs, { cwd: effectiveRepo });

        if (branchLines.length === 0) {
          return textResult('No branches found.');
        }

        // Get current branch
        const { stdout: currentBranchOut } = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: effectiveRepo,
        });
        const currentBranch = currentBranchOut.trim();

        interface BranchInfo {
          name: string;
          lastDate: string;
          author: string;
          daysAgo: number;
          ahead: number;
          behind: number;
          isCurrent: boolean;
        }

        const now = Date.now();
        const branches: BranchInfo[] = [];

        for (const line of branchLines) {
          const parts = line.split('|');
          if (parts.length < 3) continue;

          const name = parts[0].trim();
          const dateStr = parts[1].trim();
          const author = parts[2].trim();

          // Skip HEAD pointer for remote branches
          if (name === 'HEAD' || name.includes('->')) continue;

          const branchDate = new Date(dateStr).getTime();
          const daysAgo = Math.max(0, Math.floor((now - branchDate) / 86_400_000));
          const isCurrent = name === currentBranch;

          // Get ahead/behind count relative to base
          let ahead = 0;
          let behind = 0;
          try {
            const { stdout: revOut } = await gitExec(
              ['rev-list', '--left-right', '--count', `${base_branch}...${name}`],
              { cwd: effectiveRepo },
            );
            const counts = revOut.trim().split(/\s+/);
            if (counts.length === 2) {
              behind = parseInt(counts[0], 10) || 0;
              ahead = parseInt(counts[1], 10) || 0;
            }
          } catch {
            // Can't compute ahead/behind (e.g., unrelated histories)
          }

          branches.push({ name, lastDate: dateStr, author, daysAgo, ahead, behind, isCurrent });
        }

        if (branches.length === 0) {
          return textResult('No branch data could be parsed.');
        }

        // Sort by staleness (most stale first)
        branches.sort((a, b) => b.daysAgo - a.daysAgo);

        // Categorize
        const stale = branches.filter((b) => b.daysAgo > 90 && !b.isCurrent);
        const diverged = branches.filter((b) => b.ahead > 20 || b.behind > 20);

        // Absolute staleness scale: 0 = today, 100 = 6 months+
        // Branches go stale faster than files, so use 180d reference.
        const absoluteStaleness = (days: number): number =>
          Math.round(Math.min(100, (days / 180) * 100));

        const ageLabel = (days: number): string => {
          if (days === 0) return 'today';
          if (days === 1) return '1 day';
          if (days < 30) return `${days}d`;
          if (days < 365) return `${Math.floor(days / 30)}mo`;
          return `${(days / 365).toFixed(1)}y`;
        };

        const headers = [
          'Branch',
          'Last Activity',
          'Age',
          'Ahead',
          'Behind',
          'Author',
          'Staleness',
        ];
        const rows = branches.map((b) => [
          b.isCurrent ? `* ${b.name}` : b.name,
          b.lastDate.slice(0, 10),
          ageLabel(b.daysAgo),
          b.ahead > 0 ? `+${b.ahead}` : '0',
          b.behind > 0 ? `-${b.behind}` : '0',
          b.author,
          formatBar(absoluteStaleness(b.daysAgo)),
        ]);

        const insights: string[] = [];
        if (stale.length > 0) {
          insights.push(
            `- **${stale.length} stale branch${stale.length === 1 ? '' : 'es'}** (>90 days): ${stale
              .slice(0, 5)
              .map((b) => `\`${b.name}\``)
              .join(', ')}${stale.length > 5 ? ` +${stale.length - 5} more` : ''}`,
          );
        }
        if (diverged.length > 0) {
          insights.push(
            `- **${diverged.length} highly diverged branch${diverged.length === 1 ? '' : 'es'}** (>20 commits ahead or behind): ${diverged
              .slice(0, 5)
              .map((b) => `\`${b.name}\` (+${b.ahead}/-${b.behind})`)
              .join(', ')}`,
          );
        }
        const totalBranches = branches.length;
        if (totalBranches > 20) {
          insights.push(
            `- **${totalBranches} total branches** — consider cleaning up merged or abandoned branches.`,
          );
        }

        const summary = [
          `## Branch Risk Analysis (vs ${base_branch})\n`,
          `**${branches.length} branches** | Current: \`${currentBranch}\`\n`,
          formatTable(headers, rows, { alignRight: new Set([3, 4]) }),
          insights.length > 0 ? `\n\n### Recommendations\n\n${insights.join('\n')}` : '',
          `\n\n**Staleness bar**: Higher = more stale. Stale branches accumulate merge risk and clutter.`,
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
