# GitIntel - A Git Intelligence MCP Server for AI Agents

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)
![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.27-blueviolet)
![Zod](https://img.shields.io/badge/Zod-3.24-3E67B1?logo=zod&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-3.0-6E9F18?logo=vitest&logoColor=white)
![Prettier](https://img.shields.io/badge/Prettier-3.8-F7B93E?logo=prettier&logoColor=black)
![tsx](https://img.shields.io/badge/tsx-4.19-3178C6?logo=tsx&logoColor=white)
![Git](https://img.shields.io/badge/Git-%3E%3D2.20-F05032?logo=git&logoColor=white)
![ESM](https://img.shields.io/badge/ESM-ES2022-F7DF1E?logo=javascript&logoColor=black)
![JSON--RPC](https://img.shields.io/badge/JSON--RPC-2.0-orange)
![stdio](https://img.shields.io/badge/Transport-stdio-lightgrey)
![Docker](https://img.shields.io/badge/Docker-Multi--stage-2496ED?logo=docker&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-Kustomize-326CE5?logo=kubernetes&logoColor=white)
![Terraform](https://img.shields.io/badge/Terraform-Multi--cloud-844FBA?logo=terraform&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-CloudFormation-FF9900?logo=amazonwebservices&logoColor=white)
![Azure](https://img.shields.io/badge/Azure-ARM_Templates-0078D4?logo=microsoftazure&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

Git Intelligence MCP Server - deep repository analytics computed locally from your commit history.

Surfaces the same insights that tools like CodeScene and GitPrime charge for: hotspots, temporal coupling, knowledge maps, churn analysis, complexity trends, risk scoring, and more. Everything runs locally. No external APIs, no data leaves your machine.

This is a **locally-built MCP server**. It is not published to npm. You clone, build, and register it with your MCP client & AI agents (Claude Code, Codex, etc.).

```
You:    "Analyze this repo -- show me hotspots, risk, and who knows the auth module best."
Claude: [calls hotspots, risk_assessment, knowledge_map in parallel, returns formatted analysis]
```

---

## Architecture

```mermaid
graph LR
    A[MCP Client<br/>Claude Code / Codex] <-->|stdio<br/>JSON-RPC| B[mcp-git-intel<br/>MCP Server]
    B -->|execFile| C[Git CLI]
    C --> D[Repository<br/>.git]
    B --> E[Analysis Engine<br/>scoring, formatting]
```

All communication happens over **stdio** using the Model Context Protocol. The server calls Git via `execFile` (never `exec`) to prevent shell injection. All operations are **strictly read-only**.

---

## Tools

8 analysis tools, each returning formatted tables, score bars, and actionable recommendations -- not raw git output.

```mermaid
graph TD
    subgraph "Change Analysis"
        H[hotspots<br/>Change frequency]
        CH[churn<br/>Write/rewrite ratio]
        CT[complexity_trend<br/>Complexity over time]
    end
    subgraph "Dependency Analysis"
        CO[coupling<br/>Temporal coupling]
    end
    subgraph "Team Analysis"
        KM[knowledge_map<br/>Who knows what]
        CS[contributor_stats<br/>Team dynamics]
    end
    subgraph "Risk & Release"
        RA[risk_assessment<br/>Change risk scoring]
        RN[release_notes<br/>Changelog generation]
    end
```

| Tool | What it does | Key insight |
|------|-------------|-------------|
| `hotspots` | Files that change most frequently | Top 4% of files by change frequency contain 50%+ of bugs |
| `churn` | Code written then rewritten (additions vs deletions) | Churn ratio near 1.0 = code rewritten as fast as it's written |
| `coupling` | Files that always change together | Hidden dependencies not visible in imports |
| `knowledge_map` | Who knows a file/directory best, weighted by recency | Find the right reviewer, spot knowledge silos |
| `complexity_trend` | How a file's complexity evolves over time | Catch files growing out of control |
| `risk_assessment` | Risk score (0-100) for uncommitted or committed changes | Combines hotspot history, size, sensitivity, spread |
| `release_notes` | Structured changelog from conventional commits | Groups by type, extracts breaking changes and PR refs |
| `contributor_stats` | Team dynamics, collaboration graph, knowledge silos | Workload distribution, onboarding planning |

## Data Pipeline

Each tool transforms raw git output through a multi-stage pipeline:

```mermaid
graph LR
    A["Git CLI<br/>raw output"] -->|parse| B["Structured Data<br/>LogEntry[], stats"]
    B -->|score| C["Scored Results<br/>normalized 0-100"]
    C -->|format| D["Formatted Output<br/>tables, bars, text"]
    D -->|wrap| E["MCP Response<br/>CallToolResult"]

    style A fill:#f0f0f0,stroke:#999
    style B fill:#e3f2fd,stroke:#1976d2
    style C fill:#fff3e0,stroke:#f57c00
    style D fill:#e8f5e9,stroke:#388e3c
    style E fill:#f3e5f5,stroke:#7b1fa2
```

## Resources

| Resource URI | Description |
|-------------|-------------|
| `git://repo/summary` | Repository snapshot: branch, last commit, total commits, active contributors, top languages, age, remote |
| `git://repo/activity` | Recent 50-commit activity feed with stats |

---

## Installation

This server is **not published to npm**. You must clone, build, and register it locally.

### Prerequisites

- **Node.js** >= 18
- **Git** >= 2.20

### Build from source

```bash
git clone <this-repo-url>
cd mcp-server
npm install
npm run build
```

### Register with Claude Code

> [!IMPORTANT]
> **Important**: For best results, always open Claude Code inside a git repository directory. The server auto-detects the repo from your working directory. If you open Claude Code from a non-repo folder (e.g. your home directory), you will need to pass `repo_path` to every tool call manually.

**Quick registration (analyzes cwd by default):**

```bash
claude mcp add git-intel -- node /absolute/path/to/mcp-server/dist/index.js
```

**With a specific repository:**

```bash
claude mcp add git-intel -- node /absolute/path/to/mcp-server/dist/index.js /path/to/your/repo
```

### Register with any MCP client (manual JSON)

Add to your MCP client's configuration file (e.g. `~/.claude.json` for Claude Code global config):

```json
{
  "mcpServers": {
    "git-intel": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

**With a pinned default repository** (optional — useful if you always analyze the same repo):

```json
{
  "mcpServers": {
    "git-intel": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "GIT_INTEL_REPO": "/path/to/your/repo"
      }
    }
  }
}
```

> **Tip**: The `~` home directory expansion works in the repo path argument (e.g. `~/projects/my-repo`).
>
> **Tip**: When registered globally (in `~/.claude.json`), the server auto-detects the git repo in your current working directory. No `GIT_INTEL_REPO` needed — just open Claude Code inside any git repo.

---

## Configuration

### Default Repository Resolution

The server determines which git repository to use as the **default** using this priority order:

| Priority | Method | Example |
|----------|--------|---------|
| 1 | CLI argument | `node dist/index.js /path/to/repo` |
| 2 | Environment variable | `GIT_INTEL_REPO=/path/to/repo` |
| 3 | Current working directory | Falls back to `process.cwd()` |

The `~` prefix is expanded to the user's home directory in all path inputs.

### Per-Tool `repo_path` Override

Every tool accepts an optional **`repo_path`** parameter that overrides the default repository for that specific call. This allows analyzing any repository on disk without reconfiguring the server:

```json
{ "repo_path": "C:/Users/you/other-project", "days": 90 }
```

### Resilient Startup (No-Crash Mode)

The server **never crashes** on startup, even when launched from a non-git directory. Instead:

1. If a git repository is found, it becomes the default for all tools.
2. If **no git repository** is found, the server starts anyway with no default repo. Tools require the `repo_path` parameter to specify which repo to analyze.
3. Resources (`git://repo/summary`, `git://repo/activity`) return informative messages directing the user to open Claude Code inside a git repo or use `repo_path`.

```mermaid
flowchart TD
    Start["Server starts"] --> CheckRepo{"Is cwd a\ngit repo?"}
    CheckRepo -->|Yes| Default["Set as default repo\nAll tools work immediately"]
    CheckRepo -->|No| NoDefault["Start with no default\nTools require repo_path"]
    Default --> Ready["Server ready\n8 tools, 2 resources"]
    NoDefault --> Ready
    Ready --> Call{"Tool called"}
    Call --> HasArg{"repo_path\nprovided?"}
    HasArg -->|Yes| UseArg["Use repo_path"]
    HasArg -->|No| HasDefault{"Default repo\navailable?"}
    HasDefault -->|Yes| UseDefault["Use default repo"]
    HasDefault -->|No| Error["Return helpful error:\n'Open Claude Code in a git repo\nor pass repo_path'"]
    UseArg --> Execute["Execute git analysis"]
    UseDefault --> Execute
```

This design means the server works as a **global MCP server** in Claude Code — it connects successfully regardless of which project directory you open.

---

## Usage Examples

Once registered, the tools are available through natural language. You do not call them directly -- the AI client decides which tools to invoke based on your prompt.

**Find bug-prone files:**
> "Show me the change hotspots in the last 60 days"

**Analyze code stability:**
> "What's the churn analysis for the src/api directory over the last quarter?"

**Find hidden dependencies:**
> "Which files are temporally coupled with src/auth/login.ts?"

**Find the right reviewer:**
> "Who knows the src/api directory best?"

**Track complexity growth:**
> "Show me the complexity trend for src/services/payment.ts"

**Assess change risk before merging:**
> "What's the risk assessment for the uncommitted changes?"
> "Assess the risk of changes between main and feature-branch"

**Generate release notes:**
> "Generate release notes from v1.0.0 to HEAD"

**Understand team dynamics:**
> "Show me contributor statistics for the last 6 months"
> "Who are the top collaborators and where are the knowledge silos?"

**Full repo analysis:**
> "Using git-intel, give me a comprehensive analysis of this repository"

See [`docs/EXAMPLES.md`](docs/EXAMPLES.md) for a complete real-world transcript of a full repo analysis session.

---

## Development

```mermaid
graph LR
    subgraph "Development"
        Dev["npm run dev<br/>tsx auto-reload"]
        CLI["npm run cli<br/>Interactive REPL"]
    end
    subgraph "Testing"
        Unit["npm test<br/>Vitest unit tests"]
        Smoke["npm run smoke<br/>Full integration"]
    end
    subgraph "Quality"
        Lint["npm run lint<br/>tsc --noEmit"]
        Fmt["npm run format<br/>Prettier"]
    end
    subgraph "Ship"
        Build["npm run build<br/>TypeScript → dist/"]
    end

    Dev --> Unit --> Lint --> Build
    CLI --> Smoke
```

```bash
npm run dev          # Run server with tsx (auto-reload, uses cwd as repo)
npm run cli          # Interactive REPL for testing tools and resources
npm run smoke        # Automated smoke test -- runs every tool and resource
npm test             # Run unit tests (vitest)
npm run test:watch   # Watch mode
npm run lint         # Type check (tsc --noEmit)
npm run build        # Compile TypeScript to dist/
```

### CLI REPL

The interactive CLI (`npm run cli`) spawns the MCP server as a child process, connects as a real MCP client over stdio, and provides a REPL for calling tools and reading resources.

```mermaid
sequenceDiagram
    participant User as Developer
    participant CLI as cli.ts (MCP Client)
    participant Server as index.ts (MCP Server)
    participant Git as Git CLI

    User->>CLI: npm run cli [repo_path]
    CLI->>Server: Spawn via StdioClientTransport
    Server-->>CLI: Connected (JSON-RPC over stdio)
    CLI->>User: git-intel> prompt

    User->>CLI: call hotspots {"days": 60}
    CLI->>Server: callTool("hotspots", {days: 60})
    Server->>Git: git log --since=...
    Git-->>Server: raw output
    Server-->>CLI: formatted analysis
    CLI->>User: Display result + elapsed time

    User->>CLI: read git://repo/summary
    CLI->>Server: readResource("git://repo/summary")
    Server-->>CLI: repo snapshot
    CLI->>User: Display result

    User->>CLI: exit
    CLI->>Server: close()
```

**Start the CLI:**

```bash
npm run cli                    # Uses current directory as repo
npm run cli ~/projects/myapp   # Analyze a specific repo
```

**Available commands:**

| Command | Description |
|---------|-------------|
| `tools` | List all registered tools with parameters |
| `resources` | List all registered resources |
| `call <tool> [json]` | Call a tool with optional JSON arguments |
| `read <uri>` | Read a resource by URI |
| `help` | Show help |
| `exit` / `quit` / `q` | Quit the CLI |

**Example session:**

```
git-intel> tools
  Available tools (8):
  hotspots               Identify files that change most frequently...
                         params: repo_path, days, limit, path_filter
  churn                  Analyze code churn...
                         params: repo_path, days, limit, path_filter
  ...

git-intel> call hotspots {"days": 60, "limit": 5}
  Calling hotspots...
  (42ms)

## Change Hotspots (last 60 days)
File                  Changes  Authors  Last Changed  Heat
--------------------  -------  -------  ------------  ---------------
src/index.ts               12        2    2026-03-08  [██████████] 100
src/tools/risk.ts           8        1    2026-03-07  [██████░░░░] 67
...

git-intel> call knowledge_map {"path": "src/auth"}
  Calling knowledge_map...
  (38ms)

## Knowledge Map: src/auth (last 365 days)
...

git-intel> call risk_assessment
  Calling risk_assessment...
  (125ms)

## Risk Assessment: uncommitted changes
...

git-intel> read git://repo/summary
  Reading git://repo/summary...
  (15ms)

Branch: master
Last commit: c4934239 by dav nguyxn on 2026-03-09
...

git-intel> exit
Bye.
```

See [`docs/CLI.md`](docs/CLI.md) for the full CLI reference.

### Smoke Test

`npm run smoke` connects to the server and calls every tool and every resource against the current repo, printing all results. Useful for verifying nothing is broken after changes.

---

## Security Model

```mermaid
graph LR
    Input["User / AI Input"] --> V1["validatePathFilter()<br/>Blocks .. and abs paths"]
    Input --> V2["validateRef()<br/>Strict char whitelist"]
    V1 --> Safe["Sanitized Args<br/>(string array)"]
    V2 --> Safe
    Safe --> ExecFile["execFile()<br/>No shell involved"]
    ExecFile --> Git["Git CLI<br/>read-only commands only"]
    Git --> Repo[".git<br/>No writes ever"]

    subgraph "Environment Hardening"
        E1["GIT_TERMINAL_PROMPT=0"]
        E2["GIT_PAGER=''"]
        E3["LC_ALL=C"]
        E4["30s timeout"]
        E5["50MB buffer limit"]
    end

    ExecFile -.-> E1 & E2 & E3 & E4 & E5
```

| Concern | Mitigation |
|---------|------------|
| Shell injection | All git commands use `execFile` (array args, no shell interpolation) |
| Path traversal | `validatePathFilter()` blocks `..` and absolute paths |
| Ref injection | `validateRef()` validates git refs against a strict character whitelist |
| Write operations | Strictly read-only. No tool modifies the repository in any way |
| Network access | No external network calls. All data is local |
| Git safety | `GIT_TERMINAL_PROMPT=0` prevents interactive prompts; `GIT_PAGER=''` disables pagers |
| Timeouts | 30-second default timeout on all git commands |
| Buffer limits | 50MB max buffer to prevent memory exhaustion |

---

## Project Structure

```
src/
  index.ts              Entry point, server setup, tool/resource registration (resilient startup)
  cli.ts                Interactive REPL for testing
  smoke-test.ts         Automated smoke test
  git/
    executor.ts         Safe git command runner (execFile, timeouts, env)
    parser.ts           Git output parsers (log, numstat, conventional commits)
    repo.ts             Repo validation, path/ref sanitization
  tools/
    hotspots.ts         Change frequency analysis
    churn.ts            Code churn (additions vs deletions)
    coupling.ts         Temporal coupling detection
    knowledge-map.ts    Knowledge scoring per author
    complexity.ts       Complexity trend over time
    risk.ts             Multi-factor risk assessment
    release-notes.ts    Changelog from conventional commits
    contributors.ts     Contributor analytics and collaboration
  resources/
    summary.ts          Repository snapshot resource (graceful degradation)
    activity.ts         Recent commit activity feed (graceful degradation)
  util/
    scoring.ts          Normalization, recency decay, coupling, risk scoring
    formatting.ts       Tables, score bars, text output helpers
    resolve-repo.ts     Per-call repo resolution with fallback chain and error messages
```

---

## Further Documentation

- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** -- Deep technical architecture, design decisions, module dependencies
- **[`docs/TOOLS.md`](docs/TOOLS.md)** -- Detailed reference for every tool (schemas, examples, interpretation)
- **[`docs/CLI.md`](docs/CLI.md)** -- Full CLI reference with all commands, parameters, and examples
- **[`docs/EXAMPLES.md`](docs/EXAMPLES.md)** -- Real-world usage transcript showing a full repo analysis session

## License

MIT. See [LICENSE](LICENSE) for details.
