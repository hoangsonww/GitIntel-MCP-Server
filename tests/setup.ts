/**
 * Test setup: Creates temporary git repositories with known history
 * for deterministic testing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TestRepo {
  path: string;
  cleanup: () => void;
}

function git(args: string[], cwd: string) {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_PAGER: '',
    },
    windowsHide: true,
  });
}

function writeAndCommit(
  repoPath: string,
  files: Record<string, string>,
  message: string,
  opts?: {
    authorName?: string;
    authorEmail?: string;
    date?: string;
  },
) {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    GIT_AUTHOR_NAME: opts?.authorName ?? 'Test Author',
    GIT_AUTHOR_EMAIL: opts?.authorEmail ?? 'test@example.com',
    GIT_COMMITTER_NAME: opts?.authorName ?? 'Test Author',
    GIT_COMMITTER_EMAIL: opts?.authorEmail ?? 'test@example.com',
    GIT_PAGER: '',
  };

  if (opts?.date) {
    env.GIT_AUTHOR_DATE = opts.date;
    env.GIT_COMMITTER_DATE = opts.date;
  }

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(repoPath, filePath);
    const dir = join(fullPath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
  }

  execFileSync('git', ['add', '-A'], { cwd: repoPath, env, windowsHide: true });
  execFileSync('git', ['commit', '-m', message, '--allow-empty'], {
    cwd: repoPath,
    env,
    windowsHide: true,
  });
}

/**
 * Create a test repo with a realistic commit history.
 */
export function createTestRepo(): TestRepo {
  const repoPath = mkdtempSync(join(tmpdir(), 'git-intel-test-'));

  git(['init', '--initial-branch=main'], repoPath);
  git(['config', 'user.name', 'Test Author'], repoPath);
  git(['config', 'user.email', 'test@example.com'], repoPath);

  // Commit 1: Initial structure
  writeAndCommit(
    repoPath,
    {
      'src/index.ts': 'export function main() {\n  console.log("hello");\n}\n',
      'src/auth/login.ts': 'export function login(user: string, pass: string) {\n  return true;\n}\n',
      'src/auth/session.ts': 'export function createSession() {\n  return { id: "123" };\n}\n',
      'src/api/users.ts': 'export function getUsers() {\n  return [];\n}\n',
      'src/api/products.ts': 'export function getProducts() {\n  return [];\n}\n',
      'README.md': '# Test Project\n',
      'package.json': '{"name": "test", "version": "1.0.0"}\n',
    },
    'feat: initial project setup',
    { date: '2025-01-01T10:00:00+00:00' },
  );

  // Commit 2: Auth changes (by Alice)
  writeAndCommit(
    repoPath,
    {
      'src/auth/login.ts': 'export function login(user: string, pass: string) {\n  // validate\n  if (!user || !pass) throw new Error("invalid");\n  return true;\n}\n',
      'src/auth/session.ts': 'export function createSession(userId: string) {\n  return { id: userId, token: "abc" };\n}\n',
    },
    'fix: add input validation to auth',
    { authorName: 'Alice', authorEmail: 'alice@example.com', date: '2025-01-05T14:00:00+00:00' },
  );

  // Commit 3: API changes (by Bob) - coupled with auth
  writeAndCommit(
    repoPath,
    {
      'src/api/users.ts': 'export function getUsers() {\n  return [{ id: 1, name: "Alice" }];\n}\n\nexport function getUser(id: number) {\n  return { id, name: "Alice" };\n}\n',
      'src/auth/login.ts': 'export function login(user: string, pass: string) {\n  // validate inputs\n  if (!user || !pass) throw new Error("invalid credentials");\n  // check database\n  return true;\n}\n',
    },
    'feat(api): add getUser endpoint',
    { authorName: 'Bob', authorEmail: 'bob@example.com', date: '2025-01-10T09:00:00+00:00' },
  );

  // Commit 4: More changes to hotspot file
  writeAndCommit(
    repoPath,
    {
      'src/auth/login.ts': 'import { hash } from "./utils";\n\nexport function login(user: string, pass: string) {\n  if (!user || !pass) throw new Error("invalid credentials");\n  const hashed = hash(pass);\n  return hashed === "expected";\n}\n',
      'src/auth/utils.ts': 'export function hash(input: string) {\n  return input; // TODO: real hashing\n}\n',
    },
    'feat(auth): add password hashing',
    { authorName: 'Alice', authorEmail: 'alice@example.com', date: '2025-01-15T11:00:00+00:00' },
  );

  // Commit 5: Products update (by Charlie)
  writeAndCommit(
    repoPath,
    {
      'src/api/products.ts': 'export interface Product {\n  id: number;\n  name: string;\n  price: number;\n}\n\nexport function getProducts(): Product[] {\n  return [{ id: 1, name: "Widget", price: 9.99 }];\n}\n\nexport function getProduct(id: number): Product | null {\n  return { id, name: "Widget", price: 9.99 };\n}\n',
    },
    'feat(api): add product types and getProduct',
    { authorName: 'Charlie', authorEmail: 'charlie@example.com', date: '2025-01-20T16:00:00+00:00' },
  );

  // Commit 6: Another auth change (coupling reinforcement)
  writeAndCommit(
    repoPath,
    {
      'src/auth/login.ts': 'import { hash } from "./utils";\nimport { createSession } from "./session";\n\nexport function login(user: string, pass: string) {\n  if (!user || !pass) throw new Error("invalid credentials");\n  const hashed = hash(pass);\n  if (hashed !== "expected") throw new Error("wrong password");\n  return createSession(user);\n}\n',
      'src/auth/session.ts': 'export function createSession(userId: string) {\n  const token = generateToken();\n  return { id: userId, token, expiresAt: Date.now() + 3600000 };\n}\n\nfunction generateToken() {\n  return Math.random().toString(36);\n}\n',
    },
    'refactor(auth): integrate session creation into login flow',
    { authorName: 'Alice', authorEmail: 'alice@example.com', date: '2025-01-25T10:00:00+00:00' },
  );

  // Tag v1.0.0
  git(['tag', 'v1.0.0'], repoPath);

  // Commit 7: Breaking change
  writeAndCommit(
    repoPath,
    {
      'src/api/users.ts': 'export interface User {\n  id: number;\n  name: string;\n  email: string;\n}\n\nexport function getUsers(): User[] {\n  return [{ id: 1, name: "Alice", email: "alice@example.com" }];\n}\n\nexport function getUser(id: number): User | null {\n  return { id, name: "Alice", email: "alice@example.com" };\n}\n',
    },
    'feat(api)!: add email field to User type',
    { authorName: 'Bob', authorEmail: 'bob@example.com', date: '2025-02-01T10:00:00+00:00' },
  );

  // Tag v2.0.0
  git(['tag', 'v2.0.0'], repoPath);

  return {
    path: repoPath,
    cleanup: () => {
      try {
        rmSync(repoPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures on Windows
      }
    },
  };
}
