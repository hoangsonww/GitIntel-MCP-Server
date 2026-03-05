/**
 * Shared scoring and normalization functions used across tools.
 */

/**
 * Normalize a value to 0-100 range given min and max bounds.
 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.round(Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)));
}

/**
 * Calculate recency score (0-1) based on how recent a timestamp is.
 * Uses exponential decay: score = e^(-lambda * daysAgo)
 * Half-life of 30 days by default.
 */
export function recencyScore(
  timestampSec: number,
  nowSec: number,
  halfLifeDays: number = 30,
): number {
  const daysAgo = (nowSec - timestampSec) / 86400;
  if (daysAgo < 0) return 1;
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * daysAgo);
}

/**
 * Calculate the coupling score between two files based on
 * how often they appear in the same commits.
 *
 * coupling = shared_commits / min(commits_a, commits_b)
 *
 * Using min() rather than max() means: if file A changed 100 times
 * and file B changed 5 times, and they co-changed 5 times,
 * the coupling is 1.0 (B always changes with A).
 */
export function couplingScore(sharedCommits: number, commitsA: number, commitsB: number): number {
  const denominator = Math.min(commitsA, commitsB);
  if (denominator === 0) return 0;
  return Math.round((sharedCommits / denominator) * 100) / 100;
}

/**
 * Calculate a weighted knowledge score for an author on a file.
 * Factors: volume (lines changed), frequency (commit count), recency.
 */
export function knowledgeScore(params: {
  linesChanged: number;
  commitCount: number;
  mostRecentTimestamp: number;
  nowSec: number;
  maxLinesChanged: number;
  maxCommitCount: number;
}): number {
  const volumeWeight = 0.3;
  const frequencyWeight = 0.3;
  const recencyWeight = 0.4;

  const volumeNorm = params.maxLinesChanged > 0 ? params.linesChanged / params.maxLinesChanged : 0;
  const frequencyNorm = params.maxCommitCount > 0 ? params.commitCount / params.maxCommitCount : 0;
  const recency = recencyScore(params.mostRecentTimestamp, params.nowSec);

  const raw = volumeNorm * volumeWeight + frequencyNorm * frequencyWeight + recency * recencyWeight;

  return Math.round(raw * 100);
}

/**
 * Calculate risk score (0-100) from multiple weighted factors.
 */
export function riskScore(factors: Array<{ value: number; weight: number }>): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const f of factors) {
    weightedSum += f.value * f.weight;
    totalWeight += f.weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round(Math.min(100, weightedSum / totalWeight));
}

/**
 * Calculate churn ratio: deletions / additions.
 * Returns 0 if no additions. Higher = more rewriting.
 */
export function churnRatio(additions: number, deletions: number): number {
  if (additions === 0) return deletions > 0 ? 1 : 0;
  return Math.round((deletions / additions) * 100) / 100;
}

/**
 * Build a "days ago" string for display.
 */
export function daysAgoString(timestampSec: number, nowSec: number): string {
  const days = Math.floor((nowSec - timestampSec) / 86400);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  if (years === 1) return '1 year ago';
  return `${years} years ago`;
}
