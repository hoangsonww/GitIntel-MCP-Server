import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTestRepo, type TestRepo } from '../setup.js';
import { registerKnowledgeMap } from '../../src/tools/knowledge-map.js';

describe('knowledge_map tool', () => {
  let repo: TestRepo;

  beforeAll(() => {
    repo = createTestRepo();
  });

  afterAll(() => {
    repo.cleanup();
  });

  it('should register without error', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    expect(() => registerKnowledgeMap(server, repo.path)).not.toThrow();
  });
});
