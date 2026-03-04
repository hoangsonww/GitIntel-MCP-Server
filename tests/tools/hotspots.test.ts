import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTestRepo, type TestRepo } from '../setup.js';
import { registerHotspots } from '../../src/tools/hotspots.js';

describe('hotspots tool', () => {
  let repo: TestRepo;

  beforeAll(() => {
    repo = createTestRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('should register without error', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    expect(() => registerHotspots(server, repo.path)).not.toThrow();
  });
});
