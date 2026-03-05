/**
 * Output formatting helpers for tool responses.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Create a successful tool result with text content.
 */
export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

/**
 * Create an error tool result.
 */
export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Format a number with commas for readability.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Format a table from rows of data.
 * Each row is an object with the same keys.
 */
export function formatTable(
  headers: string[],
  rows: string[][],
  options?: { alignRight?: Set<number> },
): string {
  if (rows.length === 0) return '(no data)';

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));

  const alignRight = options?.alignRight ?? new Set<number>();

  const pad = (s: string, i: number) => {
    const w = widths[i];
    return alignRight.has(i) ? s.padStart(w) : s.padEnd(w);
  };

  const headerLine = headers.map((h, i) => pad(h, i)).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  const dataLines = rows.map((r) => r.map((cell, i) => pad(cell, i)).join('  '));

  return [headerLine, separator, ...dataLines].join('\n');
}

/**
 * Format a score as a visual bar: [████████░░] 80
 */
export function formatBar(score: number, width: number = 10): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${score}`;
}

/**
 * Truncate a string to maxLen, adding "..." if truncated.
 */
export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

/**
 * Format an ISO date string to a short date: "2024-01-15"
 */
export function shortDate(isoDate: string): string {
  return isoDate.slice(0, 10);
}

/**
 * Produce a markdown-style section with a header.
 */
export function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}
