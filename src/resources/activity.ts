import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec } from '../git/executor.js';

export function registerActivityResource(server: McpServer, repoRoot: string | null) {
  server.registerResource(
    'repo-activity',
    'git://repo/activity',
    {
      description:
        'Recent activity feed: last 50 commits with stats, formatted as a readable timeline. ' +
        'Returns an error message if Claude Code was not opened inside a git repository.',
      mimeType: 'text/plain',
    },
    async () => {
      if (!repoRoot) {
        return {
          contents: [
            {
              uri: 'git://repo/activity',
              text:
                '[git-intel] No git repository detected.\n\n' +
                'To use this resource, open Claude Code inside a git repository directory.\n' +
                'Alternatively, use the git-intel tools directly with the repo_path parameter.',
              mimeType: 'text/plain',
            },
          ],
        };
      }

      const { stdout } = await gitExec(
        ['log', '--max-count=50', '--format=%h|%aN|%ar|%s', '--shortstat'],
        { cwd: repoRoot },
      );

      if (!stdout.trim()) {
        return {
          contents: [
            {
              uri: 'git://repo/activity',
              text: 'No recent activity.',
              mimeType: 'text/plain',
            },
          ],
        };
      }

      // Parse the interleaved format: commit line, then optional stat line
      const lines = stdout.split('\n');
      const entries: string[] = [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) {
          i++;
          continue;
        }

        // Check if this is a commit line (hash|author|relative-date|subject)
        const commitMatch = line.match(/^([a-f0-9]+)\|(.+?)\|(.+?)\|(.+)$/);
        if (commitMatch) {
          const [, hash, author, relDate, subject] = commitMatch;

          // Check if next non-empty line is a stat line
          let stats = '';
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length) {
            const statLine = lines[j].trim();
            const statMatch = statLine.match(/(\d+) files? changed/);
            if (statMatch) {
              const insertMatch = statLine.match(/(\d+) insertions?\(\+\)/);
              const deleteMatch = statLine.match(/(\d+) deletions?\(-\)/);
              const ins = insertMatch ? `+${insertMatch[1]}` : '';
              const del = deleteMatch ? `-${deleteMatch[1]}` : '';
              stats = ` [${[ins, del].filter(Boolean).join('/')}]`;
              i = j + 1;
            } else {
              i++;
            }
          } else {
            i++;
          }

          entries.push(`${hash}  ${relDate.padEnd(15)}  ${author.padEnd(20)}  ${subject}${stats}`);
        } else {
          i++;
        }
      }

      const header = 'Hash      When             Author                Subject';
      const separator = '-'.repeat(90);

      return {
        contents: [
          {
            uri: 'git://repo/activity',
            text: [header, separator, ...entries].join('\n'),
            mimeType: 'text/plain',
          },
        ],
      };
    },
  );
}
