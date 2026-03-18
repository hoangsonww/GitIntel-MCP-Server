import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';
import { validateRef } from '../git/repo.js';
import { parseConventionalCommit } from '../git/parser.js';
import { textResult, errorResult } from '../util/formatting.js';
import { getEffectiveRepo } from '../util/resolve-repo.js';

interface CommitEntry {
  hash: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  type: string;
  scope: string | null;
  description: string;
  breaking: boolean;
  prNumber: string | null;
  issueRefs: string[];
}

export function registerReleaseNotes(server: McpServer, repoRoot: string | null) {
  server.registerTool(
    'release_notes',
    {
      title: 'Release Notes Generator',
      description:
        'Generate structured release notes from commits between two git refs. Groups by conventional commit type, ' +
        'extracts breaking changes, and links PR/issue references. Supports grouping by type, scope, or author. ' +
        'NOTE: If the server was not started inside a git repo, you MUST provide repo_path.',
      inputSchema: z.object({
        repo_path: z
          .string()
          .optional()
          .describe(
            'Absolute path to the git repository to analyze. Required if Claude Code was not opened in a git repo.',
          ),
        from_ref: z.string().describe('Starting ref (tag, branch, or commit hash)'),
        to_ref: z.string().default('HEAD').describe('Ending ref (default: HEAD)'),
        group_by: z
          .enum(['type', 'scope', 'author'])
          .default('type')
          .describe('How to group commits (default: type)'),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { repo_path, from_ref, to_ref, group_by } = args;
        const effectiveRepo = await getEffectiveRepo(repo_path, repoRoot);
        const cleanFrom = validateRef(from_ref);
        const cleanTo = validateRef(to_ref);
        const range = `${cleanFrom}..${cleanTo}`;

        const { stdout } = await gitExec(
          ['log', '--format=%H|%aN|%aI|%s|%b%x00', '--no-merges', range],
          { cwd: effectiveRepo },
        );

        if (!stdout.trim()) {
          return textResult(`No commits found between ${from_ref} and ${to_ref}.`);
        }

        // Parse commits
        const entries: CommitEntry[] = [];
        const chunks = stdout.split('\x00').filter((c) => c.trim());

        for (const chunk of chunks) {
          const firstPipe = chunk.indexOf('|');
          const hash = chunk.slice(0, firstPipe).trim();
          const rest = chunk.slice(firstPipe + 1);

          const parts = rest.split('|');
          if (parts.length < 3) continue;

          const author = parts[0];
          const date = parts[1];
          const subjectAndBody = parts.slice(2).join('|');
          const [subject, ...bodyParts] = subjectAndBody.split('\n');
          const body = bodyParts.join('\n').trim();

          // Parse conventional commit
          const conventional = parseConventionalCommit(subject.trim());

          // Extract PR references (#123)
          const prMatch = subject.match(/#(\d+)/);
          const prNumber = prMatch ? prMatch[1] : null;

          // Extract issue references from body
          const issueRefs: string[] = [];
          const issuePattern = /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi;
          let issueMatch: RegExpMatchArray | null;
          const bodyStr = body;
          const allIssueMatches = bodyStr.matchAll(issuePattern);
          for (const m of allIssueMatches) {
            issueRefs.push(m[1]);
          }

          // Check for breaking changes in body
          const hasBreakingFooter = /^BREAKING[ -]CHANGE:/m.test(body);

          entries.push({
            hash: hash.slice(0, 8),
            subject: subject.trim(),
            body,
            author,
            date: date.slice(0, 10),
            type: conventional?.type ?? 'other',
            scope: conventional?.scope ?? null,
            description: conventional?.description ?? subject.trim(),
            breaking: conventional?.breaking ?? hasBreakingFooter,
            prNumber,
            issueRefs,
          });
        }

        if (entries.length === 0) {
          return textResult(`No parseable commits found between ${from_ref} and ${to_ref}.`);
        }

        // Type labels for conventional commits
        const typeLabels: Record<string, string> = {
          feat: 'Features',
          fix: 'Bug Fixes',
          perf: 'Performance',
          refactor: 'Refactoring',
          docs: 'Documentation',
          test: 'Tests',
          build: 'Build',
          ci: 'CI/CD',
          chore: 'Chores',
          style: 'Style',
          revert: 'Reverts',
          other: 'Other Changes',
        };

        // Group entries
        const groups = new Map<string, CommitEntry[]>();
        for (const entry of entries) {
          let key: string;
          switch (group_by) {
            case 'type':
              key = entry.type;
              break;
            case 'scope':
              key = entry.scope ?? '(no scope)';
              break;
            case 'author':
              key = entry.author;
              break;
          }
          const existing = groups.get(key) ?? [];
          existing.push(entry);
          groups.set(key, existing);
        }

        // Build output
        const outputParts: string[] = [];
        outputParts.push(`# Release Notes: ${from_ref} -> ${to_ref}\n`);
        outputParts.push(
          `**${entries.length} commits** by ${new Set(entries.map((e) => e.author)).size} contributors\n`,
        );

        // Breaking changes first
        const breaking = entries.filter((e) => e.breaking);
        if (breaking.length > 0) {
          outputParts.push(`## Breaking Changes\n`);
          for (const entry of breaking) {
            const pr = entry.prNumber ? ` (#${entry.prNumber})` : '';
            outputParts.push(
              `- **${entry.scope ? `${entry.scope}: ` : ''}${entry.description}**${pr} -- ${entry.author}`,
            );
            const breakingDetail = entry.body.match(/^BREAKING[ -]CHANGE:\s*(.+)/m);
            if (breakingDetail) {
              outputParts.push(`  > ${breakingDetail[1]}`);
            }
          }
          outputParts.push('');
        }

        // Grouped sections
        const sortOrder = [
          'feat',
          'fix',
          'perf',
          'refactor',
          'docs',
          'test',
          'build',
          'ci',
          'chore',
          'style',
          'revert',
          'other',
        ];

        const sortedKeys =
          group_by === 'type'
            ? [...groups.keys()].sort((a, b) => {
                const ia = sortOrder.indexOf(a);
                const ib = sortOrder.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
              })
            : [...groups.keys()].sort();

        for (const key of sortedKeys) {
          const groupEntries = groups.get(key)!;
          const nonBreaking = groupEntries.filter((e) => !e.breaking);
          if (nonBreaking.length === 0) continue;

          const label =
            group_by === 'type'
              ? (typeLabels[key] ?? key.charAt(0).toUpperCase() + key.slice(1))
              : key;

          outputParts.push(`## ${label}\n`);
          for (const entry of nonBreaking) {
            const pr = entry.prNumber ? ` (#${entry.prNumber})` : '';
            const scope = entry.scope && group_by !== 'scope' ? `**${entry.scope}**: ` : '';
            const authorLabel = group_by !== 'author' ? ` -- ${entry.author}` : '';
            const issues =
              entry.issueRefs.length > 0
                ? ` (closes ${entry.issueRefs.map((i) => `#${i}`).join(', ')})`
                : '';
            outputParts.push(`- ${scope}${entry.description}${pr}${issues}${authorLabel}`);
          }
          outputParts.push('');
        }

        // Contributors
        const authors = new Map<string, number>();
        for (const entry of entries) {
          authors.set(entry.author, (authors.get(entry.author) ?? 0) + 1);
        }
        const sortedAuthors = [...authors.entries()].sort((a, b) => b[1] - a[1]);

        outputParts.push(`## Contributors\n`);
        for (const [authorName, count] of sortedAuthors) {
          outputParts.push(`- ${authorName} (${count} commit${count > 1 ? 's' : ''})`);
        }

        return textResult(outputParts.join('\n'));
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
