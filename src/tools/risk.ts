import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gitExec, gitLines } from '../git/executor.js';
import { validateRef } from '../git/repo.js';
import { textResult, errorResult, formatTable, formatBar } from '../util/formatting.js';
import { riskScore, normalize } from '../util/scoring.js';

interface FileRisk {
  file: string;
  score: number;
  factors: Record<string, number>;
}

export function registerRiskAssessment(server: McpServer, repoRoot: string) {
  server.registerTool(
    'risk_assessment',
    {
      title: 'Change Risk Assessment',
      description:
        'Assess the risk profile of uncommitted changes or a specific commit range. Combines multiple signals: ' +
        'file hotspot history, change size, number of files, author familiarity, and file type sensitivity. ' +
        'Returns a score 0-100 with per-file breakdown and actionable recommendations.',
      inputSchema: z.object({
        ref_range: z
          .string()
          .optional()
          .describe(
            'Git ref range to assess (e.g., "main..feature-branch"). Defaults to uncommitted changes.',
          ),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { ref_range } = args;

        // Get changed files
        let diffArgs: string[];
        let rangeLabel: string;

        if (ref_range) {
          const cleanRef = validateRef(ref_range);
          diffArgs = ['diff', '--numstat', cleanRef];
          rangeLabel = cleanRef;
        } else {
          // Uncommitted changes (staged + unstaged)
          diffArgs = ['diff', '--numstat', 'HEAD'];
          rangeLabel = 'uncommitted changes';
        }

        const { stdout: diffOutput } = await gitExec(diffArgs, { cwd: repoRoot });

        if (!diffOutput.trim()) {
          return textResult(`No changes found for: ${rangeLabel}`);
        }

        // Parse changed files
        const changedFiles: Array<{ file: string; additions: number; deletions: number }> = [];
        for (const line of diffOutput.split('\n')) {
          const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (!match) continue;
          const isBinary = match[1] === '-';
          changedFiles.push({
            file: match[3],
            additions: isBinary ? 0 : parseInt(match[1], 10),
            deletions: isBinary ? 0 : parseInt(match[2], 10),
          });
        }

        if (changedFiles.length === 0) {
          return textResult(`No file changes found for: ${rangeLabel}`);
        }

        // Gather risk signals for each file

        // Signal 1: Historical change frequency (hotspot score)
        const hotspotCounts = new Map<string, number>();
        const { stdout: hotspotLog } = await gitExec(
          ['log', '--format=', '--name-only', '--no-merges', '--since=90 days ago', '--'],
          { cwd: repoRoot },
        );
        for (const line of hotspotLog.split('\n')) {
          const file = line.trim();
          if (file) hotspotCounts.set(file, (hotspotCounts.get(file) ?? 0) + 1);
        }
        const maxHotspot = Math.max(1, ...hotspotCounts.values());

        // Signal 2: Sensitive file patterns
        const sensitivePatterns = [
          { pattern: /\b(auth|login|session|token|credential|password|secret)/i, weight: 90 },
          { pattern: /\b(payment|billing|invoice|charge|stripe|paypal)/i, weight: 95 },
          { pattern: /\b(migration|schema|database|db)\b/i, weight: 80 },
          { pattern: /\.(env|pem|key|cert|crt)$/i, weight: 100 },
          { pattern: /config\.(ts|js|py|go|yaml|yml|json)$/i, weight: 60 },
          {
            pattern: /(Dockerfile|docker-compose|\.github\/workflows|Jenkinsfile|\.gitlab-ci)/i,
            weight: 70,
          },
        ];

        // Signal 3: Change size
        const totalLines = changedFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);

        // Calculate per-file risk
        const fileRisks: FileRisk[] = changedFiles.map((f) => {
          const fileLines = f.additions + f.deletions;

          // Hotspot factor (0-100)
          const hotspotFreq = hotspotCounts.get(f.file) ?? 0;
          const hotspotFactor = normalize(hotspotFreq, 0, maxHotspot);

          // Size factor (0-100): larger changes = more risk
          const sizeFactor = Math.min(100, Math.round((fileLines / 500) * 100));

          // Sensitivity factor (0-100)
          let sensitivityFactor = 0;
          for (const { pattern, weight } of sensitivePatterns) {
            if (pattern.test(f.file)) {
              sensitivityFactor = Math.max(sensitivityFactor, weight);
            }
          }

          // File count factor (0-100): more files = more integration risk
          const fileCountFactor = Math.min(100, Math.round((changedFiles.length / 20) * 100));

          const factors = {
            hotspot: hotspotFactor,
            size: sizeFactor,
            sensitivity: sensitivityFactor,
            spread: fileCountFactor,
          };

          const score = riskScore([
            { value: hotspotFactor, weight: 0.3 },
            { value: sizeFactor, weight: 0.25 },
            { value: sensitivityFactor, weight: 0.3 },
            { value: fileCountFactor, weight: 0.15 },
          ]);

          return { file: f.file, score, factors };
        });

        // Sort by risk descending
        fileRisks.sort((a, b) => b.score - a.score);

        // Overall risk score
        const overallRisk = Math.round(
          fileRisks.reduce((sum, f) => sum + f.score, 0) / fileRisks.length,
        );

        const riskLevel =
          overallRisk >= 70 ? '🔴 HIGH' : overallRisk >= 40 ? '🟡 MEDIUM' : '🟢 LOW';

        // Build output
        const headers = ['File', 'Risk', 'Hotspot', 'Size', 'Sensitive', 'Spread'];
        const rows = fileRisks.map((f) => [
          f.file,
          formatBar(f.score),
          f.factors.hotspot.toString(),
          f.factors.size.toString(),
          f.factors.sensitivity.toString(),
          f.factors.spread.toString(),
        ]);

        const recommendations: string[] = [];
        if (overallRisk >= 70) {
          recommendations.push(
            '- **Request thorough code review** — this change touches high-risk areas.',
          );
        }
        if (fileRisks.some((f) => f.factors.sensitivity >= 80)) {
          recommendations.push(
            '- **Security review recommended** — sensitive files (auth, payments, secrets) are modified.',
          );
        }
        if (changedFiles.length >= 10) {
          recommendations.push(
            '- **Consider splitting this change** — large PRs have higher defect rates.',
          );
        }
        if (fileRisks.some((f) => f.factors.hotspot >= 70)) {
          recommendations.push(
            "- **Extra testing needed** — you're modifying historically buggy files.",
          );
        }
        if (totalLines > 500) {
          recommendations.push(
            `- **Large change** (${totalLines} lines) — review fatigue increases defect escape rate.`,
          );
        }

        const summary = [
          `## Risk Assessment: ${rangeLabel}\n`,
          `**Overall Risk**: ${riskLevel} (${overallRisk}/100)`,
          `**Files Changed**: ${changedFiles.length}`,
          `**Total Lines**: +${changedFiles.reduce((s, f) => s + f.additions, 0)} / -${changedFiles.reduce((s, f) => s + f.deletions, 0)}\n`,
          formatTable(headers, rows, { alignRight: new Set([2, 3, 4, 5]) }),
          recommendations.length > 0
            ? `\n\n### Recommendations\n\n${recommendations.join('\n')}`
            : '\n\n✅ No specific concerns identified.',
          `\n\n**Factor weights**: Hotspot 30%, Size 25%, Sensitivity 30%, Spread 15%.`,
        ].join('\n');

        return textResult(summary);
      } catch (err: unknown) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
