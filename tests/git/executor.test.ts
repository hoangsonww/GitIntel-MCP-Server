import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { gitExec, gitLines, GitTimeoutError } from '../../src/git/executor.js';
import { createTestRepo, type TestRepo } from '../setup.js';

describe('gitExec - safe command runner', () => {
  let repo: TestRepo;

  beforeAll(() => {
    repo = createTestRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('should run a basic git command', async () => {
    const result = await gitExec(['rev-parse', '--show-toplevel'], { cwd: repo.path });
    expect(result.stdout.trim()).toBeTruthy();
    expect(result.stderr).toBeDefined();
  });

  it('should return stdout and stderr', async () => {
    const result = await gitExec(['log', '--oneline', '-1'], { cwd: repo.path });
    expect(result.stdout).toContain('feat(api)!');
  });

  it('should handle non-existent path gracefully', async () => {
    const result = await gitExec(['status'], { cwd: '/nonexistent/path/xyz' });
    // should not crash - returns error info
    expect(result).toBeDefined();
  });

  it('should pass arguments safely without shell interpretation', async () => {
    // Arguments go directly to the process, never through a shell
    const result = await gitExec(['log', '--format=%s', '-1'], { cwd: repo.path });
    expect(result.stdout.trim()).toBeTruthy();
  });
});

describe('gitLines', () => {
  let repo: TestRepo;

  beforeAll(() => {
    repo = createTestRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('should return non-empty lines', async () => {
    const lines = await gitLines(['log', '--format=%s'], { cwd: repo.path });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.length > 0)).toBe(true);
  });

  it('should return empty array for no results', async () => {
    const lines = await gitLines(['log', '--format=%s', '--since=2099-01-01'], { cwd: repo.path });
    expect(lines).toEqual([]);
  });
});
