/**
 * Parsers for git command output.
 * All parsers work on raw string output — no shell involved.
 */

export interface LogEntry {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string; // ISO 8601
  timestamp: number; // Unix seconds
  subject: string;
  body: string;
  files: FileChange[];
}

export interface FileChange {
  additions: number;
  deletions: number;
  file: string;
  isBinary: boolean;
}

const LOG_SEPARATOR = '---GIT-INTEL-SEP---';
const FIELD_SEPARATOR = '---GIT-INTEL-FIELD---';

/**
 * Git log format string that produces parseable output.
 * Fields: hash, author name, author email, ISO date, unix timestamp, subject, body
 */
export function getLogFormat(): string {
  return [
    `${LOG_SEPARATOR}`,
    `%H${FIELD_SEPARATOR}%aN${FIELD_SEPARATOR}%aE${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%at${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b`,
  ].join('');
}

/**
 * Build git log args with numstat for file-level stats.
 */
export function buildLogArgs(options: {
  format: string;
  since?: string;
  until?: string;
  path?: string;
  maxCount?: number;
  author?: string;
  noMerges?: boolean;
}): string[] {
  const args = ['log', `--format=${options.format}`, '--numstat'];

  if (options.noMerges !== false) {
    args.push('--no-merges');
  }
  if (options.since) {
    args.push(`--since=${options.since}`);
  }
  if (options.until) {
    args.push(`--until=${options.until}`);
  }
  if (options.maxCount) {
    args.push(`--max-count=${options.maxCount}`);
  }
  if (options.author) {
    args.push(`--author=${options.author}`);
  }
  args.push('--');
  if (options.path) {
    args.push(options.path);
  }

  return args;
}

/**
 * Parse git log output produced by getLogFormat() + --numstat.
 */
export function parseLog(output: string): LogEntry[] {
  if (!output.trim()) return [];

  const entries: LogEntry[] = [];
  const chunks = output.split(LOG_SEPARATOR).filter((c) => c.trim());

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const headerLine = lines[0];

    const fields = headerLine.split(FIELD_SEPARATOR);
    if (fields.length < 6) continue;

    const [hash, authorName, authorEmail, date, timestampStr, subject, ...bodyParts] = fields;

    const files: FileChange[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const numstatMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (numstatMatch) {
        const isBinary = numstatMatch[1] === '-';
        files.push({
          additions: isBinary ? 0 : parseInt(numstatMatch[1], 10),
          deletions: isBinary ? 0 : parseInt(numstatMatch[2], 10),
          file: numstatMatch[3],
          isBinary,
        });
      }
    }

    entries.push({
      hash: hash.trim(),
      authorName: authorName.trim(),
      authorEmail: authorEmail.trim(),
      date: date.trim(),
      timestamp: parseInt(timestampStr.trim(), 10),
      subject: subject.trim(),
      body: bodyParts.join(FIELD_SEPARATOR).trim(),
      files,
    });
  }

  return entries;
}

/**
 * Parse git shortstat output: " 3 files changed, 10 insertions(+), 5 deletions(-)"
 */
export function parseShortstat(line: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  const filesMatch = line.match(/(\d+) files? changed/);
  const insertMatch = line.match(/(\d+) insertions?\(\+\)/);
  const deleteMatch = line.match(/(\d+) deletions?\(-\)/);

  return {
    filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
    insertions: insertMatch ? parseInt(insertMatch[1], 10) : 0,
    deletions: deleteMatch ? parseInt(deleteMatch[1], 10) : 0,
  };
}

/**
 * Parse conventional commit subject lines.
 * Format: type(scope): description  OR  type: description
 */
export function parseConventionalCommit(subject: string): {
  type: string;
  scope: string | null;
  description: string;
  breaking: boolean;
} | null {
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)$/);
  if (!match) return null;

  return {
    type: match[1].toLowerCase(),
    scope: match[2] ?? null,
    description: match[4].trim(),
    breaking: match[3] === '!',
  };
}
