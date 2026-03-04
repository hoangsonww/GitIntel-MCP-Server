import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFileCb);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 50 * 1024 * 1024; // 50MB

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

export interface GitExecOptions {
  cwd: string;
  timeout?: number;
  maxBuffer?: number;
}

/**
 * Execute a git command safely using execFile (no shell interpolation).
 * All arguments are passed as an array — never string-interpolated.
 */
export async function gitExec(
  args: readonly string[],
  options: GitExecOptions,
): Promise<GitExecResult> {
  const cwd = resolve(options.cwd);
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? MAX_BUFFER;

  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      timeout,
      maxBuffer,
      windowsHide: true,
      env: {
        ...process.env,
        // Prevent git from using a pager or prompting
        GIT_PAGER: '',
        GIT_TERMINAL_PROMPT: '0',
        // Consistent output regardless of user config
        LC_ALL: 'C',
      },
    });

    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (err: unknown) {
    if (isExecError(err)) {
      // Git returns non-zero for many non-fatal conditions (e.g., empty log).
      // Return stdout/stderr so callers can decide what to do.
      if (err.killed) {
        throw new GitTimeoutError(
          `Git command timed out after ${timeout}ms: git ${args.join(' ')}`,
        );
      }
      return {
        stdout: typeof err.stdout === 'string' ? err.stdout : '',
        stderr: typeof err.stderr === 'string' ? err.stderr : '',
      };
    }
    throw err;
  }
}

/**
 * Execute a git command and return stdout lines (trimmed, empty lines removed).
 */
export async function gitLines(
  args: readonly string[],
  options: GitExecOptions,
): Promise<string[]> {
  const { stdout } = await gitExec(args, options);
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

export class GitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitTimeoutError';
  }
}

function isExecError(
  err: unknown,
): err is Error & { stdout?: string; stderr?: string; killed?: boolean } {
  return err instanceof Error;
}
