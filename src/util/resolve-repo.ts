import { resolveRepoRoot } from '../git/repo.js';

const NO_REPO_MSG =
  'No git repository available. Either:\n' +
  '1. Open Claude Code inside a git repository directory, OR\n' +
  '2. Pass the repo_path parameter with an absolute path to a git repo.\n\n' +
  'Example: { "repo_path": "C:/Users/you/your-project" }';

/**
 * Resolve the effective repository root for a tool call.
 * Prefers the explicit repo_path argument, falls back to the server default.
 */
export async function getEffectiveRepo(
  repoPath: string | undefined,
  defaultRepo: string | null,
): Promise<string> {
  if (repoPath) {
    return resolveRepoRoot(repoPath);
  }
  if (defaultRepo) {
    return defaultRepo;
  }
  throw new Error(NO_REPO_MSG);
}
