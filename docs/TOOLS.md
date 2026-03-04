# Tool Reference

Detailed documentation for all 8 tools and 2 resources provided by `mcp-git-intel`.

Every tool returns **formatted text** with tables, score bars `[████████░░] 80`, and interpretation guidance. Not raw git output.

---

## Table of Contents

- [hotspots](#hotspots) -- Change frequency analysis
- [churn](#churn) -- Code churn (write/rewrite ratio)
- [coupling](#coupling) -- Temporal coupling detection
- [knowledge_map](#knowledge_map) -- Who knows what code
- [complexity_trend](#complexity_trend) -- Complexity over time
- [risk_assessment](#risk_assessment) -- Change risk scoring
- [release_notes](#release_notes) -- Changelog generation
- [contributor_stats](#contributor_stats) -- Team dynamics
- [Resources](#resources) -- `git://repo/summary` and `git://repo/activity`

---

## hotspots

**Change Hotspots** -- Find files that change most frequently.

### Use Case

The top 4% of files by change frequency typically contain 50%+ of bugs. Use this to identify files that need refactoring, better test coverage, or architectural attention.

### Input Schema

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | integer (>0) | `90` | Number of days to look back |
| `limit` | integer (1-100) | `20` | Max results to return |
| `path_filter` | string (optional) | -- | Filter to files under this path (e.g. `"src/api"`) |

### Example Output

```
## Change Hotspots (last 90 days)

Analyzed 142 changed files. Showing top 5.

File                              Changes  Authors  Last Changed  Heat
--------------------------------  -------  -------  ------------  ---------------
src/api/routes/auth.ts                 23        4    2026-02-28  [██████████] 100
src/middleware/session.ts              18        3    2026-03-01  [████████░░] 78
src/db/migrations/latest.ts           15        2    2026-02-25  [██████░░░░] 65
src/services/payment.ts               12        3    2026-03-02  [█████░░░░░] 52
package.json                           9        5    2026-03-03  [████░░░░░░] 39


**Interpretation**: Files with high change frequency are likely candidates for refactoring,
better test coverage, or breaking into smaller modules. Files changed by many authors may
indicate unclear ownership or shared concerns that should be separated.
```

### Interpretation Guide

- **Changes**: Number of commits that touched this file in the period.
- **Authors**: Number of distinct contributors. High author count may indicate unclear ownership.
- **Heat**: Normalized score (0-100) relative to the most-changed file in the result set.
- Files at the top of this list are your highest-leverage targets for refactoring and testing.

---

## churn

**Code Churn Analysis** -- Analyze how much code is being written and then rewritten.

### Use Case

High churn indicates instability, unclear requirements, or code that is hard to get right. A file with 500 lines added and 400 deleted in a month is a red flag.

### Input Schema

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | integer (>0) | `90` | Number of days to look back |
| `limit` | integer (1-100) | `20` | Max results to return |
| `path_filter` | string (optional) | -- | Filter to files under this path |

### Example Output

```
## Code Churn Analysis (last 90 days)

Total: +8450 / -3200 across 95 files. Showing top 5.

File                                Added  Deleted     Net  Churn  Commits
----------------------------------  -----  -------  ------  -----  -------
src/components/Dashboard.tsx         +892     -847     +45   0.95        8
src/api/routes/auth.ts               +534     -489     +45   0.92       12
src/services/payment.ts              +312     -15    +297   0.05        4
src/db/schema.ts                     +245     -180     +65   0.73        6
package-lock.json                   +3200      -50  +3150   0.02        3


**Churn ratio** = deletions / additions. Values near 1.0 mean code is being rewritten as fast as it's written.
High-churn files may indicate: unstable requirements, wrong abstraction, or code that's hard to get right.
```

### Interpretation Guide

- **Churn ratio**: `deletions / additions`. Ranges from 0.0 (all new code) to 1.0 (every line added is also deleted).
- **Churn near 1.0**: Code is being rewritten as fast as it's written. Investigate why.
- **Churn near 0.0**: Mostly new code being added. Normal for new features.
- **High churn + many commits**: Likely unstable requirements or a wrong abstraction.
- **High churn + few commits**: Could be a healthy refactor (large rewrite in few passes).
- **Net negative**: File is shrinking. Could be good (cleanup) or bad (accidental deletion).

---

## coupling

**Temporal Coupling** -- Find files that always change together.

### Use Case

Temporal coupling reveals hidden dependencies not visible in imports or type signatures. If `auth.ts` and `middleware.ts` change together in 90% of commits, refactoring one without the other will likely break things.

### Input Schema

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | integer (>0) | `90` | Days to look back |
| `min_coupling` | float (0-1) | `0.5` | Minimum coupling score to report |
| `min_commits` | integer (>0) | `3` | Minimum shared commits to report |
| `limit` | integer (1-50) | `20` | Max pairs to return |
| `path_filter` | string (optional) | -- | Filter to files under this path |

### Example Output

```
## Temporal Coupling (last 90 days)

Found 3 coupled pairs (showing top 3, min coupling: 0.5).

File A                       File B                        Coupling  Shared  A total  B total
---------------------------  ----------------------------  --------  ------  -------  -------
src/api/routes/auth.ts       src/middleware/session.ts          0.89       8        9       12
src/db/schema.ts             src/db/migrations/latest.ts       0.75       6        8        6
src/components/Header.tsx    src/components/Navigation.tsx      0.60       3        5        4


### Top Coupled Pairs -- Sample Commits

**src/api/routes/auth.ts <-> src/middleware/session.ts** (coupling: 0.89)
  Sample commits: "fix: session expiry not checked on refresh", "feat: add OAuth2 login flow", "fix: token rotation race condition"

**src/db/schema.ts <-> src/db/migrations/latest.ts** (coupling: 0.75)
  Sample commits: "feat: add user preferences table", "fix: nullable column for legacy accounts"


**Interpretation**: High coupling means these files are logically connected. Consider:
- Should they be merged into one module?
- Is there a missing abstraction that would decouple them?
- At minimum, changes to one should trigger review of the other.
```

### Interpretation Guide

- **Coupling score**: `shared_commits / min(commits_A, commits_B)`. Ranges from 0 to 1.
- **1.0**: Every time the less-frequently-changed file changes, the other does too.
- **0.5-0.8**: Strong coupling. These files are logically related.
- **< 0.3**: Weak coupling. Likely coincidental co-changes.
- **Sample commits**: Help you understand *why* the files are coupled.
- Commits with > 50 files are excluded to avoid noise from bulk operations.

---

## knowledge_map

**Knowledge Map** -- Show who knows a file or directory best.

### Use Case

Find the right reviewer for a PR. Identify knowledge silos. Plan for team transitions. Scores are weighted by recency, volume, and frequency -- not just line count.

### Input Schema

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string (**required**) | -- | File or directory path to analyze (relative to repo root) |
| `days` | integer (>0) | `365` | Days to look back |

### Example Output

```
## Knowledge Map: src/api (last 365 days)

**Primary expert**: Alice (score: 92/100)
**Bus factor**: 2 (authors with score >= 30)

Author   Score            Commits  +Lines  -Lines  Last Active
-------  ---------------  -------  ------  ------  -----------
Alice    [█████████░] 92       45   +3200    -800  2 days ago
Bob      [████░░░░░░] 41       12    +450    -120  1 week ago
Charlie  [██░░░░░░░░] 18        3     +80     -20  2 months ago


**Score formula**: 30% volume (lines changed) + 30% frequency (commits) + 40% recency (exponential decay, 30-day half-life).

Warning: Knowledge silo detected: Only one author has significant knowledge of this area.
Consider pair programming or knowledge transfer sessions.
```

### Interpretation Guide

- **Score (0-100)**: Weighted combination of volume (30%), frequency (30%), and recency (40%).
- **Bus factor**: Number of authors with score >= 30. A bus factor of 1 means a single point of failure.
- **Recency weight**: Uses exponential decay with a 30-day half-life. An author's score halves every 30 days of inactivity.
- **Primary expert**: The highest-scoring author. This is your first-choice reviewer.
- Use this to assign reviewers: pick from the top 2-3 authors by score.

---

## complexity_trend

**Complexity Trend** -- Track how a file's complexity changes over time.

### Use Case

Identify files growing out of control, complexity spikes from specific commits, and files that need splitting. Samples the file at regular intervals in git history and measures lines, nesting depth, and function count.

### Input Schema

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string (**required**) | -- | File path to analyze (relative to repo root) |
| `samples` | integer (3-30) | `10` | Number of time samples |
| `days` | integer (>0) | `180` | Days to look back |

### Example Output

```
## Complexity Trend: src/services/payment.ts (last 180 days)

Sampled 6 points across 15 commits.

**Lines**: 120 -> 340 (up +220)
**Avg Depth**: 2.1 -> 4.8 (up +2.7)
**Functions**: 5 -> 14 (up +9)

Date        Commit    Lines  Max Depth  Avg Depth  Long Lines  Functions
----------  --------  -----  ---------  ---------  ----------  ---------
2025-09-15  a1b2c3d4    120          4        2.1           0          5
2025-10-20  e5f6a7b8    165          5        2.8           1          7
2025-11-30  c9d0e1f2    210          6        3.5           2          9
2026-01-10  a3b4c5d6    260          8        4.1           3         11
2026-02-15  e7f8a9b0    310          9        4.5           4         13
2026-03-01  c1d2e3f4    340         10        4.8           5         14

Warning: Large file (340 lines): Consider splitting into smaller modules.
Warning: Deep nesting (max depth 10): Consider extracting nested logic into helper functions.
Warning: Rapid growth (+220 lines): This file may be accumulating too many responsibilities.
Warning: Many functions (14): Consider splitting into separate modules by concern.
```

### Interpretation Guide

- **Lines**: Non-empty line count. Growth over 100 lines in the period is flagged.
- **Max Depth**: Deepest indentation level. Over 6 is flagged.
- **Avg Depth**: Average indentation across non-empty lines. Proxy for overall nesting complexity.
- **Long Lines**: Lines exceeding 120 characters. Often indicates complex expressions.
- **Functions**: Count of function-like patterns (language-agnostic heuristic). Over 15 is flagged.
- Trend direction matters more than absolute values. A file going from depth 2 to depth 8 is concerning even if 8 is "normal" for some codebases.

---

## risk_assessment

**Change Risk Assessment** -- Score the risk of uncommitted changes or a commit range.

### Use Case

Before merging a PR or committing changes, assess the risk profile. Combines four signals: historical hotspot frequency, change size, file type sensitivity, and number of files changed.

### Input Schema

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ref_range` | string (optional) | uncommitted changes | Git ref range to assess (e.g. `"main..feature-branch"`) |

### Example Output

```
## Risk Assessment: uncommitted changes

**Overall Risk**: MEDIUM (48/100)
**Files Changed**: 4
**Total Lines**: +320 / -45

File                         Risk             Hotspot  Size  Sensitive  Spread
---------------------------  ---------------  -------  ----  ---------  ------
src/api/routes/auth.ts       [██████░░░░] 62       80    12         90      20
src/middleware/session.ts     [█████░░░░░] 55       65     8         70      20
src/db/schema.ts             [████░░░░░░] 42       45    10         80      20
package.json                 [██░░░░░░░░] 15       10     1          0      20


### Recommendations

- **Security review recommended** -- sensitive files (auth, payments, secrets) are modified.
- **Extra testing needed** -- you're modifying historically buggy files.


**Factor weights**: Hotspot 30%, Size 25%, Sensitivity 30%, Spread 15%.
```

### Interpretation Guide

- **Overall Risk (0-100)**: Average of per-file risk scores. `>= 70` = HIGH, `>= 40` = MEDIUM, `< 40` = LOW.
- **Hotspot factor (0-100)**: How frequently this file has changed in the last 90 days relative to the most-changed file.
- **Size factor (0-100)**: `min(100, (lines_changed / 500) * 100)`. Larger changes = higher risk.
- **Sensitivity factor (0-100)**: Pattern-matched against file path:
  - 100: `.env`, `.pem`, `.key`, `.cert` files
  - 90-95: Auth, payment, credential, session files
  - 80: Database, migration, schema files
  - 70: Docker, CI/CD, Jenkinsfile
  - 60: Config files
  - 0: Everything else
- **Spread factor (0-100)**: `min(100, (file_count / 20) * 100)`. More files = more integration risk.

### Recommendations Triggers

The tool generates specific recommendations based on thresholds:

| Condition | Recommendation |
|-----------|---------------|
| Overall risk >= 70 | Request thorough code review |
| Any file sensitivity >= 80 | Security review recommended |
| 10+ files changed | Consider splitting the change |
| Any file hotspot >= 70 | Extra testing needed |
| 500+ total lines changed | Large change, review fatigue warning |

---

## release_notes

**Release Notes Generator** -- Generate structured changelogs from conventional commits.

### Use Case

Generate release notes between two git refs (tags, branches, commits). Groups by conventional commit type, extracts breaking changes, and links PR/issue references.

### Input Schema

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `from_ref` | string (**required**) | -- | Starting ref (tag, branch, or commit hash) |
| `to_ref` | string | `"HEAD"` | Ending ref |
| `group_by` | `"type"` \| `"scope"` \| `"author"` | `"type"` | How to group commits |

### Example Output

```
# Release Notes: v1.2.0 -> HEAD

**12 commits** by 3 contributors

## Breaking Changes

- **auth: require API key for all endpoints** (#45) -- Alice
  > All endpoints now require authentication. Anonymous access is no longer supported.

## Features

- **payments**: add Stripe webhook handler (#48) -- Bob
- **auth**: implement OAuth2 PKCE flow (#45) -- Alice
- add user preferences page (#42) (closes #38) -- Charlie

## Bug Fixes

- **session**: fix token rotation race condition (#47) -- Alice
- handle null email in user profile (#44) -- Bob

## Documentation

- update API reference for v2 endpoints (#46) -- Charlie

## Contributors

- Alice (5 commits)
- Bob (4 commits)
- Charlie (3 commits)
```

### Interpretation Guide

- **Breaking Changes**: Commits marked with `!` in the type (e.g. `feat!:`) or with `BREAKING CHANGE:` in the commit body. Always listed first.
- **Group by type**: Groups by conventional commit type (`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`). Non-conventional commits go under "Other Changes".
- **Group by scope**: Groups by the scope in `type(scope): description`.
- **Group by author**: Groups by commit author.
- **PR references**: Extracted from `#123` in the subject line.
- **Issue references**: Extracted from `closes #123`, `fixes #123`, `resolves #123` in the commit body.

---

## contributor_stats

**Contributor Statistics** -- Comprehensive contributor analytics.

### Use Case

Understand team dynamics, identify knowledge silos, plan onboarding, and assess workload distribution. Shows who is active, what areas they work in, collaboration patterns, and knowledge concentration.

### Input Schema

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | integer (>0) | `90` | Days to look back |
| `author` | string (optional) | -- | Filter to a specific author (partial match) |

### Example Output (team overview)

```
## Contributor Statistics (last 90 days)

**4 contributors**, 85 total commits

Author      Commits  Activity          +Lines  -Lines  Files  Last Active
----------  -------  ----------------  ------  ------  -----  -----------
Alice            35  [██████████] 100   +4200   -1800     42  today
Bob              28  [████████░░] 80    +2100    -900     35  1 day ago
Charlie          15  [████░░░░░░] 43     +800    -200     18  3 days ago
Diana             7  [██░░░░░░░░] 20     +300     -50      8  1 week ago


### Top Collaborations (shared files)

- Alice <-> Bob: 28 shared files
- Alice <-> Charlie: 12 shared files
- Bob <-> Charlie: 8 shared files


### Knowledge Silos

These authors are the sole contributor to many files:

- **Alice**: 15 files with no other contributors
- **Diana**: 8 files with no other contributors
```

### Example Output (single author detail)

When filtering to a single author (`author: "Alice"`), the output includes a detailed profile:

```
## Contributor Profile: Alice
**Email**: alice@example.com
**Period**: last 90 days

### Activity Summary

- **Commits**: 35
- **Lines added**: +4200
- **Lines deleted**: -1800
- **Files touched**: 42
- **First commit**: 3 months ago
- **Last commit**: today

### Focus Areas

- src/api: 18 commits (51%)
- src/services: 8 commits (23%)
- src/middleware: 5 commits (14%)
- src/db: 4 commits (11%)

### Commit Time Pattern

**Peak hour**: 14:00 (8 commits)

09:00  ████ 4
10:00  ██████ 6
11:00  ████████ 7
14:00  ████████████████████ 8
15:00  ██████████████ 6
16:00  ████████ 4

### Top Collaborators

- Bob: 28 shared files
- Charlie: 12 shared files
```

### Interpretation Guide

- **Activity bar**: Relative to the most active contributor (who gets 100).
- **Knowledge Silos**: Authors who are the sole contributor to 5+ files. These represent single points of failure.
- **Top Collaborations**: Based on shared file changes (files touched by both authors). Higher numbers indicate closer working relationship.
- **Focus Areas**: Top-level directories where the author commits most. Shows specialization patterns.
- **Commit Time Pattern**: When the author typically commits. Useful for understanding work patterns and timezone.

---

## Resources

### `git://repo/summary`

Repository snapshot providing high-level context.

**Output example:**

```
Branch: main
Last commit: e857acb2 by Alice on 2026-03-03
  "feat: add user preferences page"
Total commits: 342
Active contributors (90d): 4
Total contributors: 8
Repository age: 1 year (since 2025-02-15)
Top file types: ts (145), tsx (89), json (23), md (12), yml (8), css (6), sql (4), sh (3)
Total tracked files: 290
Remote: https://github.com/org/repo.git
```

### `git://repo/activity`

Recent 50-commit activity feed.

**Output example:**

```
Hash      When             Author                Subject
------------------------------------------------------------------------------------------
e857acb2  2 hours ago      Alice                 feat: add user preferences page [+120/-15]
983b7192  5 hours ago      Bob                   fix: session expiry check [+8/-3]
a1b2c3d4  1 day ago        Charlie               docs: update API reference [+45/-12]
```

Each entry includes the short hash, relative time, author, subject line, and (when available) line change stats in `[+added/-deleted]` format.
