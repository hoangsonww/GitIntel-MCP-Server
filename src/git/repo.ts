import { resolve, normalize } from 'node:path';
import { access, stat } from 'node:fs/promises';
import { gitExec } from './executor.js';

/**
 * Validate that the given path is a git repository.
 * Returns the resolved absolute path to the repo root.
 */
export async function resolveRepoRoot(repoPath: string): Promise<string> {
  const resolved = resolve(repoPath);

  // Check directory exists
  try {
    const s = await stat(resolved);
    if (!s.isDirectory()) {
      throw new RepoError(`Not a directory: ${resolved}`);
    }
  } catch (err: unknown) {
    if (err instanceof RepoError) throw err;
    throw new RepoError(`Cannot access path: ${resolved}`);
  }

  // Use git to find the repo root (handles worktrees, subdirs, etc.)
  const { stdout, stderr } = await gitExec(['rev-parse', '--show-toplevel'], { cwd: resolved });

  const root = stdout.trim();
  if (!root) {
    throw new RepoError(`Not a git repository: ${resolved}. ${stderr.trim()}`);
  }

  return normalize(root);
}

/**
 * Check that git is installed and meets minimum version requirements.
 */
export async function checkGitVersion(
  cwd: string,
): Promise<{ version: string; major: number; minor: number }> {
  const { stdout } = await gitExec(['--version'], { cwd });
  const match = stdout.match(/git version (\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new RepoError(`Cannot determine git version from: ${stdout.trim()}`);
  }

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const version = `${match[1]}.${match[2]}.${match[3]}`;

  if (major < 2 || (major === 2 && minor < 20)) {
    throw new RepoError(`Git >= 2.20 required, found ${version}`);
  }

  return { version, major, minor };
}

/**
 * Validate a path filter to prevent path traversal.
 * Returns the cleaned path or throws.
 */
export function validatePathFilter(pathFilter: string, repoRoot: string): string {
  const cleaned = normalize(pathFilter).replace(/\\/g, '/');

  // Block obvious traversal attempts
  if (cleaned.includes('..') || cleaned.startsWith('/')) {
    throw new RepoError(`Invalid path filter (traversal attempt): ${pathFilter}`);
  }

  return cleaned;
}

/**
 * Validate a git ref (branch, tag, commit hash) to prevent injection.
 */
export function validateRef(ref: string): string {
  if (!/^[a-zA-Z0-9_./@^~{}\-]+$/.test(ref)) {
    throw new RepoError(`Invalid git ref: ${ref}`);
  }
  if (ref.includes('..') && !/^[a-zA-Z0-9_./@^~{}\-]+\.\.[a-zA-Z0-9_./@^~{}\-]+$/.test(ref)) {
    throw new RepoError(`Invalid ref range: ${ref}`);
  }
  return ref;
}

export class RepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoError';
  }
}
