import { describe, it, expect } from 'vitest';
import { parseShortstat, parseConventionalCommit, getLogFormat, parseLog } from '../../src/git/parser.js';

describe('parseShortstat', () => {
  it('should parse a full shortstat line', () => {
    const result = parseShortstat(' 3 files changed, 10 insertions(+), 5 deletions(-)');
    expect(result).toEqual({ filesChanged: 3, insertions: 10, deletions: 5 });
  });

  it('should handle insertions only', () => {
    const result = parseShortstat(' 1 file changed, 15 insertions(+)');
    expect(result).toEqual({ filesChanged: 1, insertions: 15, deletions: 0 });
  });

  it('should handle deletions only', () => {
    const result = parseShortstat(' 2 files changed, 7 deletions(-)');
    expect(result).toEqual({ filesChanged: 2, insertions: 0, deletions: 7 });
  });

  it('should handle empty/invalid input', () => {
    const result = parseShortstat('');
    expect(result).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });
});

describe('parseConventionalCommit', () => {
  it('should parse type and description', () => {
    const result = parseConventionalCommit('feat: add login page');
    expect(result).toEqual({
      type: 'feat',
      scope: null,
      description: 'add login page',
      breaking: false,
    });
  });

  it('should parse type with scope', () => {
    const result = parseConventionalCommit('fix(auth): validate token');
    expect(result).toEqual({
      type: 'fix',
      scope: 'auth',
      description: 'validate token',
      breaking: false,
    });
  });

  it('should detect breaking changes with !', () => {
    const result = parseConventionalCommit('feat(api)!: remove v1 endpoints');
    expect(result).toEqual({
      type: 'feat',
      scope: 'api',
      description: 'remove v1 endpoints',
      breaking: true,
    });
  });

  it('should return null for non-conventional commits', () => {
    expect(parseConventionalCommit('Updated the readme')).toBeNull();
    expect(parseConventionalCommit('WIP')).toBeNull();
    expect(parseConventionalCommit('')).toBeNull();
  });

  it('should handle colons in description', () => {
    const result = parseConventionalCommit('docs: update API: add auth section');
    expect(result?.description).toBe('update API: add auth section');
  });
});

describe('parseLog', () => {
  it('should return empty array for empty input', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('  \n  ')).toEqual([]);
  });
});
