# Architecture Documentation for `mcp-git-intel`

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)
![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27-blueviolet)
![Zod](https://img.shields.io/badge/Zod-3.24-3E67B1?logo=zod&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-3.0-6E9F18?logo=vitest&logoColor=white)
![Git](https://img.shields.io/badge/Git-%3E%3D2.20-F05032?logo=git&logoColor=white)
![ESM](https://img.shields.io/badge/ESM-ES2022-F7DF1E?logo=javascript&logoColor=black)

Technical architecture documentation for `mcp-git-intel` - a git analytics MCP server for AI coding assistants. This document covers the system overview, data flow, module dependencies, layer breakdowns, security architecture, performance considerations, design decisions, entry point flow, and testing infrastructure.

---

## System Overview

`mcp-git-intel` is a Model Context Protocol (MCP) server that provides git repository analytics to AI coding assistants. It communicates over stdio using JSON-RPC, executes read-only git commands against a local repository, and returns formatted analysis results.

```mermaid
graph TD
    Client["MCP Client<br/>(Claude Code, Codex, etc.)"]
    Server["mcp-git-intel<br/>Node.js process"]
    Git["Git CLI<br/>(execFile, no shell)"]
    Repo[".git directory<br/>(read-only)"]

    Client <-->|"stdio (JSON-RPC 2.0)<br/>MCP protocol"| Server
    Server -->|"execFile with args array<br/>30s timeout, 50MB buffer"| Git
    Git -->|"stdout/stderr"| Server
    Git -->|"read-only operations"| Repo

    subgraph Server
        direction TB
        Transport["StdioServerTransport"]
        McpServer["McpServer (SDK)"]
        Tools["12 Tool Handlers"]
        Resources["2 Resource Handlers"]
        GitLayer["Git Layer<br/>executor, parser, repo"]
        UtilLayer["Util Layer<br/>scoring, formatting"]

        Transport --> McpServer
        McpServer --> Tools
        McpServer --> Resources
        Tools --> GitLayer
        Tools --> UtilLayer
        Resources --> GitLayer
    end
```

---

## Data Flow

Every tool invocation follows the same pattern:

```mermaid
sequenceDiagram
    participant C as MCP Client
    participant S as Tool Handler
    participant R as Repo Resolver
    participant V as Validation Layer
    participant G as Git Executor
    participant P as Parser
    participant Sc as Scoring Engine
    participant F as Formatter

    C->>S: callTool(name, {repo_path?, ...args})
    S->>R: getEffectiveRepo(repo_path, defaultRepo)
    alt repo_path provided
        R->>R: resolveRepoRoot(repo_path)
    else default repo available
        R-->>S: defaultRepo
    else no repo at all
        R-->>S: Error: "Open Claude Code in a git repo or pass repo_path"
    end
    S->>V: Validate inputs (Zod schema)
    V->>V: validatePathFilter() / validateRef()
    S->>G: gitExec(args, {cwd: effectiveRepo, timeout})
    G->>G: execFile('git', [...args])
    G-->>S: {stdout, stderr}
    S->>P: Parse git output
    P-->>S: Structured data
    S->>Sc: Calculate scores/metrics
    Sc-->>S: Scored results
    S->>F: Format tables, bars, text
    F-->>S: Formatted string
    S-->>C: {content: [{type: 'text', text}]}
```

---

## Module Dependency Graph

```mermaid
graph TD
    index["src/index.ts<br/>Entry point"]

    subgraph "Tools Layer"
        hotspots["tools/hotspots.ts"]
        churn["tools/churn.ts"]
        coupling["tools/coupling.ts"]
        knowledge["tools/knowledge-map.ts"]
        complexity["tools/complexity.ts"]
        risk["tools/risk.ts"]
        release["tools/release-notes.ts"]
        contributors["tools/contributors.ts"]
        fileHistory["tools/file-history.ts"]
        codeAge["tools/code-age.ts"]
        commitPatterns["tools/commit-patterns.ts"]
        branchRisk["tools/branch-risk.ts"]
    end

    subgraph "Resources Layer"
        summary["resources/summary.ts"]
        activity["resources/activity.ts"]
    end

    subgraph "Git Layer"
        executor["git/executor.ts<br/>execFile wrapper"]
        parser["git/parser.ts<br/>Output parsers"]
        repo["git/repo.ts<br/>Validation"]
    end

    subgraph "Util Layer"
        scoring["util/scoring.ts<br/>Score algorithms"]
        formatting["util/formatting.ts<br/>Output formatting"]
        resolveRepo["util/resolve-repo.ts<br/>Per-call repo resolution"]
    end

    index --> hotspots & churn & coupling & knowledge & complexity & risk & release & contributors
    index --> fileHistory & codeAge & commitPatterns & branchRisk
    index --> summary & activity

    hotspots --> executor & repo & parser & formatting & scoring & resolveRepo
    churn --> executor & repo & formatting & scoring & resolveRepo
    coupling --> executor & repo & formatting & scoring & resolveRepo
    knowledge --> executor & repo & formatting & scoring & resolveRepo
    complexity --> executor & repo & formatting & resolveRepo
    risk --> executor & repo & formatting & scoring & resolveRepo
    release --> executor & repo & parser & formatting & resolveRepo
    contributors --> executor & formatting & scoring & resolveRepo
    fileHistory --> executor & repo & formatting & resolveRepo
    codeAge --> executor & repo & formatting & scoring & resolveRepo
    commitPatterns --> executor & formatting & resolveRepo
    branchRisk --> executor & formatting & scoring & resolveRepo

    summary --> executor
    activity --> executor

    repo --> executor
```

---

## Layer Breakdown

### Git Layer (`src/git/`)

The foundation. All interaction with Git passes through this layer.

#### `executor.ts` -- Safe Command Runner

The single point of contact with the operating system for git operations.

- **`gitExec(args, options)`**: Runs `git` with `execFile` (not `exec`). Arguments are passed as an array, never string-interpolated. Returns `{stdout, stderr}`.
- **`gitLines(args, options)`**: Convenience wrapper that splits stdout into trimmed, non-empty lines.
- **`GitTimeoutError`**: Thrown when a command exceeds the timeout (default 30s).

Key safety measures:
- `execFile` prevents shell injection by design -- arguments cannot be interpreted as shell metacharacters.
- `GIT_TERMINAL_PROMPT=0` prevents git from blocking on interactive prompts.
- `GIT_PAGER=''` prevents git from spawning a pager.
- `LC_ALL=C` ensures consistent output format regardless of user locale.
- `windowsHide: true` prevents console windows from flashing on Windows.
- 50MB max buffer prevents memory exhaustion from unexpectedly large output.

#### `parser.ts` -- Output Parsers

Parses raw git output into structured TypeScript objects.

- **`parseLog()`**: Parses custom-formatted `git log` output with numstat into `LogEntry[]` objects. Uses unique separator strings (`---GIT-INTEL-SEP---`) to avoid ambiguity with commit content.
- **`parseShortstat()`**: Parses `--shortstat` output into `{filesChanged, insertions, deletions}`.
- **`parseConventionalCommit()`**: Parses conventional commit subjects (`type(scope): description`) including breaking change markers.
- **`getLogFormat()` / `buildLogArgs()`**: Builders for git log command arguments.

#### `repo.ts` -- Repository Validation

Input validation and repository resolution.

- **`resolveRepoRoot(path)`**: Validates a directory exists and is a git repository. Uses `git rev-parse --show-toplevel` to find the actual root (handles subdirectories and worktrees).
- **`checkGitVersion(cwd)`**: Verifies git >= 2.20 is installed.
- **`validatePathFilter(path, repoRoot)`**: Sanitizes path arguments. Blocks `..` traversal and absolute paths.
- **`validateRef(ref)`**: Validates git refs against a character whitelist. Allows typical ref patterns (branches, tags, ranges) while blocking injection attempts.

### Tools Layer (`src/tools/`)

Each file exports a single `register*` function that registers one tool with the MCP server. All tools accept `repoRoot: string | null` — enabling resilient startup when no git repo is detected.

All tools follow the same pattern:

1. Define Zod input schema with defaults and descriptions (including optional `repo_path`)
2. **Resolve effective repo** via `getEffectiveRepo(repo_path, repoRoot)` — uses explicit arg, falls back to default, or returns a helpful error
3. Validate and sanitize inputs
4. Execute git commands via the git layer
5. Parse output into structured data
6. Calculate derived metrics (scoring layer)
7. Format results with tables, bars, and interpretation text
8. Return via `textResult()` or `errorResult()`

All tools are annotated with `readOnlyHint: true` and `openWorldHint: false`.

#### The `repo_path` Parameter

Every tool includes an optional `repo_path` parameter in its input schema:

```typescript
repo_path: z.string().optional().describe(
  'Absolute path to the git repository to analyze. Required if Claude Code was not opened in a git repo.',
)
```

This enables three usage modes:

| Mode | `repo_path` | Default repo | Behavior |
|------|-------------|-------------|----------|
| Default | omitted | available | Uses default repo from startup |
| Override | provided | any | Uses the explicit `repo_path`, ignoring default |
| Required | omitted | null | Returns error with guidance message |

Tool descriptions include a `NOTE` prompting the AI agent to provide `repo_path` when needed.

#### Tool-specific git strategies:

| Tool | Git commands used | Analysis approach |
|------|------------------|-------------------|
| `hotspots` | `log --name-only` | Count file appearances across commits |
| `churn` | `log --numstat` | Sum additions/deletions per file |
| `coupling` | `log --name-only` | Build co-change matrix from multi-file commits |
| `knowledge_map` | `log --numstat` | Per-author stats weighted by recency |
| `complexity_trend` | `log` + `show <hash>:<path>` | Sample file content at intervals, measure indentation/functions |
| `risk_assessment` | `diff --numstat` + `log --name-only` | Combine hotspot history, size, sensitivity, spread |
| `release_notes` | `log` with range | Parse conventional commits, group by type/scope/author |
| `contributor_stats` | `log --numstat` | Per-author profiles with collaboration graph |
| `file_history` | `log --follow --numstat` | Single file evolution with rename tracking |
| `code_age` | `ls-files` + `log --name-only --diff-filter` | Last-modified date per file, age distribution |
| `commit_patterns` | `log --shortstat` | Timestamp and size distribution analysis |
| `branch_risk` | `branch` + `rev-list --left-right --count` | Per-branch staleness and divergence from base |

### Util Layer (`src/util/`)

#### `scoring.ts` -- Scoring Algorithms

Pure functions for calculating normalized scores.

```mermaid
graph TD
    subgraph "Normalization"
        Norm["normalize(value, min, max)<br/>Maps to 0-100"]
    end

    subgraph "Time-Weighted Scoring"
        Recency["recencyScore(ts, now, halfLife)<br/>Exponential decay, 30-day half-life"]
        Knowledge["knowledgeScore(params)<br/>30% volume + 30% freq + 40% recency"]
    end

    subgraph "Relationship Scoring"
        Coupling["couplingScore(shared, A, B)<br/>shared / min(A, B)"]
        Churn["churnRatio(add, del)<br/>deletions / additions"]
    end

    subgraph "Composite Scoring"
        Risk["riskScore(factors)<br/>Weighted average:<br/>30% hotspot + 25% size<br/>+ 30% sensitivity + 15% spread"]
    end

    Norm --> Knowledge
    Recency --> Knowledge
    Knowledge --> Risk
    Coupling --> Risk
    Churn --> Risk
```

- **`normalize(value, min, max)`**: Maps a value to 0-100 range.
- **`recencyScore(timestamp, now, halfLife)`**: Exponential decay function. Half-life of 30 days by default. Used to weight recent activity higher.
- **`couplingScore(shared, commitsA, commitsB)`**: `shared / min(commitsA, commitsB)`. Uses `min` (not `max`) so that if B always changes with A, coupling is 1.0 even if A changes independently.
- **`knowledgeScore(params)`**: Weighted formula: 30% volume + 30% frequency + 40% recency.
- **`riskScore(factors)`**: Weighted average of multiple risk factors.
- **`churnRatio(additions, deletions)`**: `deletions / additions`. Higher values mean more rewriting.
- **`daysAgoString(timestamp, now)`**: Human-readable relative time string.

#### `formatting.ts` -- Output Formatting

All output goes through this layer to produce consistent, readable results.

- **`textResult(text)`**: Wraps text in MCP `CallToolResult` format.
- **`errorResult(message)`**: Wraps error in MCP format with `isError: true`.
- **`formatTable(headers, rows, options)`**: ASCII table with configurable column alignment. Right-aligns numeric columns.
- **`formatBar(score, width)`**: Visual score bar: `[████████░░] 80`.
- **`truncate()`, `shortDate()`, `section()`**: Minor formatting helpers.

#### `resolve-repo.ts` -- Per-Call Repository Resolution

Resolves which repository a tool call should operate on. Implements a fallback chain:

```mermaid
flowchart LR
    A["repo_path arg"] -->|provided| B["resolveRepoRoot(repo_path)"]
    A -->|omitted| C{"defaultRepo\nnot null?"}
    C -->|yes| D["Use defaultRepo"]
    C -->|no| E["Throw Error:\n'No repository available.\nOpen Claude Code in a git repo\nor pass repo_path.'"]
```

- **`getEffectiveRepo(repoPath?, defaultRepo)`**: Returns the resolved absolute path to a git repository root. Prefers explicit `repoPath` argument, falls back to `defaultRepo`, or throws with a user-friendly error message that guides the user to either open Claude Code in a git directory or provide the `repo_path` parameter.

### Resources Layer (`src/resources/`)

MCP resources provide static-ish data that clients can read at any time (not invoked as tools). Resources accept `repoRoot: string | null` and **degrade gracefully** when no default repo is available.

- **`summary.ts`** (`git://repo/summary`): Aggregates branch, last commit, total commits, active contributors, all-time contributors, repo age, top file extensions, total files, and remote URL. When no repo is available, returns a guidance message directing the user to open Claude Code in a git repo.
- **`activity.ts`** (`git://repo/activity`): Last 50 commits formatted as a timeline with hash, relative date, author, subject, and change stats. When no repo is available, returns a guidance message.

Resources cannot accept per-call parameters (MCP resource URIs are fixed), so they rely entirely on the startup default repo. If the server starts outside a git repo, resources return:

```
[git-intel] No git repository detected.

To use this resource, open Claude Code inside a git repository directory.
Alternatively, use the git-intel tools directly with the repo_path parameter.
```

---

## Security Architecture

### Threat Model

The server runs locally and accepts input from an AI client. The primary threats are:

1. **Shell injection via crafted arguments**: Mitigated by `execFile` (no shell involvement).
2. **Path traversal to read files outside the repo**: Mitigated by `validatePathFilter` blocking `..` and absolute paths.
3. **Git ref injection**: Mitigated by `validateRef` with strict character whitelist.
4. **Denial of service via large repos**: Mitigated by timeouts (30s) and buffer limits (50MB).
5. **Git interactive prompts blocking the server**: Mitigated by `GIT_TERMINAL_PROMPT=0`.

```mermaid
graph TD
    T1["Shell Injection"] -->|blocked by| M1["execFile()\nNo shell layer"]
    T2["Path Traversal"] -->|blocked by| M2["validatePathFilter()\nRejects .. and abs paths"]
    T3["Ref Injection"] -->|blocked by| M3["validateRef()\nStrict char whitelist"]
    T4["DoS / Large Output"] -->|blocked by| M4["30s timeout\n50MB buffer limit"]
    T5["Interactive Prompt<br/>Hang"] -->|blocked by| M5["GIT_TERMINAL_PROMPT=0\nGIT_PAGER=''"]

    M1 --> Safe["Safe Execution Layer"]
    M2 --> Safe
    M3 --> Safe
    M4 --> Safe
    M5 --> Safe
    Safe --> RO["Read-Only Git Commands<br/>log, diff, show, rev-parse,<br/>rev-list, ls-files, remote"]
```

### Why `execFile` and not `exec`

`child_process.exec()` runs commands through a shell (`/bin/sh` or `cmd.exe`), which means special characters in arguments can be interpreted as shell operators. For example, a path containing shell metacharacters could cause unintended command execution.

`child_process.execFile()` bypasses the shell entirely. Arguments are passed directly to the process as an argv array. There is no shell interpretation, so injection is not possible regardless of argument content.

### Read-Only Guarantee

No tool runs any git command that modifies the repository. The commands used are: `log`, `diff`, `rev-parse`, `rev-list`, `ls-files`, `show`, `remote get-url`, and `--version`. None of these write to the working tree, index, or .git directory.

---

## Performance Considerations

### Git Command Efficiency

- Tools use targeted git log formats (custom `--format` strings) to minimize output parsing.
- `--no-merges` is used by default to skip merge commits that inflate change counts without representing real work.
- `--since` filters are pushed to git (server-side filtering) rather than fetching all history and filtering in JS.
- Coupling analysis caps at 50 files per commit to avoid O(n^2) pair generation on large commits.
- Complexity trend samples evenly across history (configurable, default 10 points) rather than analyzing every commit.

### Output Limits

- All tools accept a `limit` parameter (default 20, max 50-100 depending on tool).
- Results are sorted by relevance before truncation so the most important data is always shown.

### Concurrency

- The MCP protocol handles one request at a time over stdio (serial).
- Tools do not spawn parallel git processes. Each tool makes 1-3 sequential git calls.
- The smoke test and CLI run tools sequentially.

### Git Command Strategy Per Tool

```mermaid
graph TD
    subgraph "Single Command Tools"
        H["hotspots<br/>git log --name-only"]
        CH["churn<br/>git log --numstat"]
        KM["knowledge_map<br/>git log --numstat"]
        CS["contributor_stats<br/>git log --numstat"]
        CO["coupling<br/>git log --name-only"]
        RN["release_notes<br/>git log (range)"]
        FH["file_history<br/>git log --follow --numstat"]
        CP["commit_patterns<br/>git log --shortstat"]
    end

    subgraph "Multi-Command Tools"
        CT["complexity_trend<br/>1. git log (history)<br/>2. git show hash:path × N"]
        RA["risk_assessment<br/>1. git diff --numstat<br/>2. git log --name-only"]
        CA["code_age<br/>1. git ls-files<br/>2. git log --name-only --diff-filter"]
        BR["branch_risk<br/>1. git branch<br/>2. git rev-list --count × N"]
    end

    H & CH & KM & CS & CO & RN & FH & CP -->|"1 git call"| Fast["Fast path<br/>< 1s typical"]
    CT -->|"1 + N git calls"| Slower["Sampled path<br/>N = sample points (default 10)"]
    RA & CA -->|"2 git calls"| Medium["Two-pass path<br/>diff/ls + history lookup"]
    BR -->|"1 + N git calls"| BranchPath["Per-branch path<br/>N = number of branches"]
```

---

## Design Decisions

### Formatted text output (not JSON)

Tools return pre-formatted text with markdown tables, score bars, and interpretation sections. This was a deliberate choice:

- AI clients can present the output directly to users without additional formatting logic.
- The interpretation text (e.g., "High coupling means these files are logically connected") helps the AI provide better analysis.
- JSON output would require the AI to format it, adding latency and potential formatting errors.

### Per-tool git commands (not a shared cache)

Each tool makes its own git calls rather than sharing a centralized data cache. Reasons:

- Tools need different git output formats (`--name-only` vs `--numstat` vs custom `--format`).
- Caching would add complexity and memory pressure for repos with long histories.
- Git itself has an efficient pack file format; re-reading is fast.

### Zod for input validation

The MCP SDK uses Zod for schema definition, which provides both runtime validation and TypeScript type inference. Every tool parameter has a default value and description, so tools work with zero arguments.

### Coupling uses `min()` not `max()` denominator

`coupling = shared / min(commitsA, commitsB)` means: if file B changed 5 times and always changed with file A, the coupling is 1.0 -- even if A changed 100 times independently. This captures the "B depends on A" relationship that `max()` would dilute.

### Resilient startup over fail-fast

The server deliberately does **not** crash when started outside a git repository. Previous versions called `process.exit(1)` if the working directory wasn't a git repo, which caused the MCP connection to fail before it even started. This was problematic for global MCP registration, where the client may spawn the server from any working directory (home directory, temp folder, etc.).

The new approach:
- The server always starts and registers all tools/resources.
- Tools resolve the repository per-call via `getEffectiveRepo()`, using the optional `repo_path` parameter or the startup default.
- When no repo is available, tools return clear error messages that guide the user to provide a repo path — this is more useful than a cryptic "MCP server failed to connect" message.
- Resources return guidance text instead of crashing.

This follows the principle: **prefer degraded functionality over total failure**.

### Knowledge score weights recency at 40%

The knowledge score formula (30% volume, 30% frequency, 40% recency) deliberately over-weights recency because code understanding decays. An author who wrote 10,000 lines two years ago knows less about the current state than someone who made 50 commits last month.

---

## Entry Point Flow

The server uses **resilient startup** — it never crashes, even when launched from a non-git directory. This is critical for global MCP registration where the server may be spawned from any working directory.

```mermaid
graph TD
    Start["main()"] --> ExpandHome["Expand ~ in repo path"]
    ExpandHome --> CheckGit["checkGitVersion()"]
    CheckGit -->|"< 2.20 or fails"| WarnGit["Log warning\n(non-fatal)"]
    CheckGit -->|">= 2.20"| GotVersion["Git version OK"]
    WarnGit --> ResolveRoot
    GotVersion --> ResolveRoot["resolveRepoRoot()"]
    ResolveRoot -->|"not a repo"| NoRepo["repoRoot = null\nLog: 'No git repo detected'\n+ guidance message"]
    ResolveRoot -->|"valid"| HasRepo["repoRoot = resolved path"]
    NoRepo --> CreateServer["Create McpServer"]
    HasRepo --> CreateServer
    CreateServer --> RegisterTools["Register 12 tools\n(repoRoot may be null)"]
    RegisterTools --> RegisterResources["Register 2 resources\n(graceful degradation)"]
    RegisterResources --> Connect["Connect StdioServerTransport"]
    Connect --> Running["Server running\nwaiting for JSON-RPC"]
    Running -->|"SIGINT/SIGTERM"| Shutdown["Graceful shutdown"]
```

### Tool Registration Sequence

```mermaid
sequenceDiagram
    participant Main as main()
    participant SDK as McpServer
    participant T as Tool Handlers
    participant R as Resources
    participant IO as StdioTransport

    Main->>Main: Resolve repoRoot (may be null)
    Main->>SDK: new McpServer("git-intel")

    loop 12 tools
        Main->>T: register*(server, repoRoot)
        T->>SDK: server.tool(name, schema, handler)
        Note over T,SDK: repoRoot captured in closure<br/>(null = require repo_path per call)
    end

    loop 2 resources
        Main->>R: register*(server, repoRoot)
        R->>SDK: server.resource(uri, handler)
    end

    Main->>IO: new StdioServerTransport()
    Main->>SDK: server.connect(transport)
    SDK->>IO: Listening on stdin/stdout
    Note over IO: Ready for JSON-RPC requests
```

### Startup Behavior Matrix

| Condition | Behavior | Tools | Resources |
|-----------|----------|-------|-----------|
| Started in a git repo | `repoRoot` set, all tools work with defaults | Work immediately | Return repo data |
| Started outside a git repo | `repoRoot = null`, server still connects | Require `repo_path` parameter | Return guidance message |
| Git not installed | Warning logged, server still starts | Fail individually with clear errors | Return guidance message |

---

## Testing Infrastructure

```mermaid
graph LR
    subgraph "Unit Tests (Vitest)"
        UT1["scoring.test.ts<br/>normalize, recency,<br/>coupling, risk"]
        UT2["parser.test.ts<br/>log parsing,<br/>conventional commits"]
        UT3["formatting.test.ts<br/>tables, bars,<br/>text helpers"]
    end

    subgraph "Integration Tests"
        Smoke["smoke-test.ts<br/>Spawns real server<br/>Calls all 12 tools<br/>Reads both resources"]
    end

    subgraph "Manual Testing"
        CLI["cli.ts<br/>Interactive REPL<br/>Ad-hoc tool calls"]
    end

    UT1 & UT2 & UT3 -->|"npm test"| Pass["All Pass"]
    Smoke -->|"npm run smoke"| Pass
    CLI -->|"npm run cli"| Dev["Developer Feedback"]
```

- **Unit tests** (`npm test`): Vitest-based tests for scoring, parsing, and formatting functions.
- **Smoke test** (`npm run smoke`): Connects a real MCP client to the server, calls every tool and reads every resource against a live repo, and prints all results. Catches integration issues that unit tests miss.
- **CLI REPL** (`npm run cli`): Interactive testing tool for ad-hoc tool invocation and resource reading during development.
