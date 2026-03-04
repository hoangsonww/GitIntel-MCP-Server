# mcp-git-intel — Git Intelligence MCP Server

## What This Is

A production-ready MCP server that provides **deep git repository analytics** — the kind of insights that tools like CodeScene, GitPrime, or Code Climate charge for, but computed locally from your git history.

This is not a wrapper around `git log`. It's a set of analytical tools that extract *actionable intelligence* from commit history: where bugs hide, who knows what, which files are coupled, and what's risky about your next deploy.

---

## Why This Matters

Every git repository contains years of institutional knowledge encoded in its history. Engineers rarely tap into it because the queries are complex and the tooling is fragmented. This server surfaces that knowledge through simple tool calls:

- **Before a refactor**: Which files always change together? (temporal coupling = hidden dependencies)
- **Before a code review**: Who wrote this code and touched it most recently? (knowledge map = right reviewer)
- **Before a release**: What's the risk profile of these changes? (hotspots + churn + author spread = risk score)
- **After a bug**: When exactly did this behavior change? (smart bisect with context)
- **For tech debt**: Where is complexity growing fastest? (complexity trend analysis)

---

## Tools (8 total)

### 1. `hotspots`
Find files that change most frequently. High churn correlates strongly with defect density.

**Input**: `{ days?: number, limit?: number, path_filter?: string }`
**Output**: Ranked list of files with change count, unique authors, and last modified date.
**Why**: Research shows the top 4% of files by change frequency contain 50%+ of bugs.

### 2. `coupling`
Find files that always change together (temporal coupling). These represent hidden dependencies that aren't visible in imports or type signatures.

**Input**: `{ days?: number, min_coupling?: number, min_commits?: number, path_filter?: string }`
**Output**: Pairs of files with coupling score (0-1), shared commit count, and sample commit messages.
**Why**: If `auth.ts` and `middleware.ts` change together in 90% of commits, they're logically coupled even if there's no import between them. Refactoring one without the other will break things.

### 3. `knowledge_map`
For any file or directory, show who knows it best — weighted by recency, volume of changes, and whether they wrote vs. modified the code.

**Input**: `{ path: string, days?: number }`
**Output**: Per-author breakdown: lines added/removed, commit count, recency score, knowledge score (0-100).
**Why**: When you need a reviewer, you want the person who *recently* worked on the code, not someone who wrote it 3 years ago and left the team.

### 4. `churn`
Analyze code churn — how much code is being written and then rewritten. High churn indicates instability, unclear requirements, or code that's hard to get right.

**Input**: `{ days?: number, limit?: number, path_filter?: string }`
**Output**: Per-file churn metrics: lines added, lines deleted, churn ratio (deleted/added), net growth, commit count.
**Why**: A file with 500 lines added and 400 deleted in a month is a red flag. Either the requirements keep changing or the design is wrong.

### 5. `complexity_trend`
Track how a file's complexity has changed over time by sampling its state at regular intervals.

**Input**: `{ path: string, samples?: number, days?: number }`
**Output**: Time series of: date, commit, lines of code, indentation depth (proxy for cyclomatic complexity), function count (for supported languages).
**Why**: A file that's been growing linearly for 6 months needs to be split. A file that spiked in complexity last week probably introduced bugs.

### 6. `risk_assessment`
Assess the risk profile of uncommitted changes or a specific commit range. Combines multiple signals: file hotspot score, author familiarity, change size, time of day, coupling violations.

**Input**: `{ ref_range?: string }` (defaults to uncommitted changes)
**Output**: Overall risk score (0-100) with breakdown by factor. Per-file risk detail. Actionable recommendations.
**Why**: "This PR touches 3 hotspot files, was written by someone who hasn't modified this area before, and breaks a temporal coupling with `config.ts`" — that's a PR you review carefully.

### 7. `release_notes`
Generate structured release notes from commits between two refs. Groups by conventional commit type, extracts breaking changes, links PRs/issues.

**Input**: `{ from_ref: string, to_ref?: string, group_by?: 'type' | 'scope' | 'author' }`
**Output**: Structured release notes with sections for features, fixes, breaking changes, and other changes. Includes PR/issue references.
**Why**: No one likes writing release notes manually. This extracts them from commit history with proper categorization.

### 8. `contributor_stats`
Comprehensive contributor analytics: who's active, what areas they work in, their commit patterns, and collaboration graph.

**Input**: `{ days?: number, author?: string }`
**Output**: Per-author: commit count, files touched, areas of focus, active hours, collaboration score (how often they touch the same files as others).
**Why**: Useful for understanding team dynamics, identifying knowledge silos, and onboarding planning.

---

## Resources (2 total)

### `git://repo/summary`
Returns a snapshot of the repository: branch, last commit, total commits, active contributors, top languages, and age.

### `git://repo/activity`
Returns a recent activity feed: last 50 commits with stats, formatted as a readable timeline.

---

## Architecture

```
mcp-server/
├── PLAN.md                    # This file
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Entry point: McpServer setup, transport, tool registration
│   ├── git/
│   │   ├── executor.ts        # Safe git command execution (execFile, no shell)
│   │   ├── parser.ts          # Git log/diff output parsers
│   │   └── repo.ts            # Repository detection and validation
│   ├── tools/
│   │   ├── hotspots.ts        # hotspots tool
│   │   ├── coupling.ts        # coupling tool
│   │   ├── knowledge-map.ts   # knowledge_map tool
│   │   ├── churn.ts           # churn tool
│   │   ├── complexity.ts      # complexity_trend tool
│   │   ├── risk.ts            # risk_assessment tool
│   │   ├── release-notes.ts   # release_notes tool
│   │   └── contributors.ts    # contributor_stats tool
│   ├── resources/
│   │   ├── summary.ts         # repo summary resource
│   │   └── activity.ts        # activity feed resource
│   └── util/
│       ├── scoring.ts         # Shared scoring/normalization functions
│       └── formatting.ts      # Output formatting helpers
├── tests/
│   ├── fixtures/              # Test git repos (created in setup)
│   ├── git/
│   │   ├── executor.test.ts
│   │   └── parser.test.ts
│   ├── tools/
│   │   ├── hotspots.test.ts
│   │   ├── coupling.test.ts
│   │   ├── knowledge-map.test.ts
│   │   ├── churn.test.ts
│   │   ├── complexity.test.ts
│   │   ├── risk.test.ts
│   │   ├── release-notes.test.ts
│   │   └── contributors.test.ts
│   └── setup.ts               # Creates test git repos with known history
└── README.md
```

---

## Technical Decisions

### Runtime & Build
- **TypeScript** with strict mode
- **Node.js** runtime — broadest MCP client compatibility
- **tsx** for development, `tsc` for production build
- **Vitest** for testing

### Git Interaction
- Shell out to `git` CLI via `child_process.execFile` (never `exec` — prevents shell injection)
- All user-supplied values passed as arguments array, never interpolated into command strings
- Repository path validated before any command execution
- Timeout on all git commands (30s default) to prevent hanging on large repos

### MCP SDK
- `@modelcontextprotocol/sdk` v2 (`registerTool` API with config objects)
- `zod/v4` for input/output schema validation
- `StdioServerTransport` for Claude Code integration (local process)
- Proper error handling: tool errors return `isError: true` content, not thrown exceptions

### Performance
- Parsing is streaming where possible (line-by-line git log processing)
- Results are capped with sensible defaults (`limit: 20`) to prevent huge outputs
- No caching in v1 — git commands are fast enough for interactive use on most repos
- `--no-pager` on all git commands

### Security
- No shell interpolation — all args passed as arrays to `execFile`
- Repository path is resolved and validated (must contain `.git`)
- Path traversal prevention: all path filters are validated relative to repo root
- No writes to the repository — strictly read-only
- Ref arguments validated against `^[a-zA-Z0-9_./-]+$` pattern

---

## Implementation Order

1. **`src/git/executor.ts`** — Foundation. Safe git command execution. Test first.
2. **`src/git/parser.ts`** — Git output parsers (log, diff, shortstat). Test with known fixtures.
3. **`src/git/repo.ts`** — Repo detection and validation.
4. **`src/util/scoring.ts`** — Shared scoring functions (normalization, weighting).
5. **`src/tools/hotspots.ts`** — Simplest analytical tool. Validates the full pipeline.
6. **`src/tools/churn.ts`** — Similar to hotspots, reuses parsers.
7. **`src/tools/coupling.ts`** — More complex: needs commit-file matrix analysis.
8. **`src/tools/knowledge-map.ts`** — Author analysis with recency weighting.
9. **`src/tools/complexity.ts`** — Needs git-show at historical commits.
10. **`src/tools/risk.ts`** — Aggregates signals from other tools.
11. **`src/tools/release-notes.ts`** — Conventional commit parsing.
12. **`src/tools/contributors.ts`** — Author-centric analytics.
13. **`src/resources/summary.ts`** + **`src/resources/activity.ts`** — Resources.
14. **`src/index.ts`** — Wire everything together, register tools/resources, start transport.
15. **Integration test** — Spin up server, call each tool against a test repo.
16. **README.md** — Installation, configuration, usage examples.

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Large repos (100k+ commits) slow down queries | Default time windows (90 days), `limit` params, streaming parsers |
| Git not installed or wrong version | Check `git --version` on startup, require >= 2.20 |
| Windows path handling | Use `path.resolve`, normalize separators, test on Windows |
| Shell injection via path/ref args | `execFile` (no shell), argument validation, no string interpolation |
| MCP SDK breaking changes | Pin to specific version, use `registerTool` (v2 stable API) |

---

## Success Criteria

- [ ] All 8 tools work correctly against a real git repository
- [ ] All tests pass
- [ ] Can be installed in Claude Code via `claude mcp add`
- [ ] Runs on Windows (current environment) and Unix
- [ ] No shell injection vectors
- [ ] Handles edge cases: empty repos, repos with no tags, single-author repos
- [ ] Output is concise and actionable (not raw git dumps)
