import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTestRepo, type TestRepo } from '../setup.js';
import { registerContributorStats } from '../../src/tools/contributors.js';

describe('contributor_stats tool', () => {
  let repo: TestRepo;

  beforeAll(() => {
    repo = createTestRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('should register without error', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    expect(() => registerContributorStats(server, repo.path)).not.toThrow();
  });
});
