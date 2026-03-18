/**
 * Zero-dependency ANSI color utilities for CLI output.
 * Only used in human-facing code (cli.ts, smoke-test.ts).
 * Never used in MCP tool responses (those go to AI clients).
 */

const enabled = process.stdout.isTTY !== false;

function wrap(code: string, text: string): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

// Styles
export const bold = (t: string) => wrap('1', t);
export const dim = (t: string) => wrap('2', t);
export const italic = (t: string) => wrap('3', t);
export const underline = (t: string) => wrap('4', t);

// Colors
export const red = (t: string) => wrap('31', t);
export const green = (t: string) => wrap('32', t);
export const yellow = (t: string) => wrap('33', t);
export const blue = (t: string) => wrap('34', t);
export const magenta = (t: string) => wrap('35', t);
export const cyan = (t: string) => wrap('36', t);
export const white = (t: string) => wrap('37', t);
export const gray = (t: string) => wrap('90', t);

// Bright variants
export const brightRed = (t: string) => wrap('91', t);
export const brightGreen = (t: string) => wrap('92', t);
export const brightYellow = (t: string) => wrap('93', t);
export const brightBlue = (t: string) => wrap('94', t);
export const brightMagenta = (t: string) => wrap('95', t);
export const brightCyan = (t: string) => wrap('96', t);

// Backgrounds
export const bgBlue = (t: string) => wrap('44', t);
export const bgMagenta = (t: string) => wrap('45', t);
export const bgCyan = (t: string) => wrap('46', t);

// Composites
export const success = (t: string) => bold(green(t));
export const error = (t: string) => bold(red(t));
export const warn = (t: string) => bold(yellow(t));
export const info = (t: string) => bold(cyan(t));
export const muted = (t: string) => dim(gray(t));
export const accent = (t: string) => bold(magenta(t));
export const highlight = (t: string) => bold(brightCyan(t));

// Utility
export const RESET = enabled ? '\x1b[0m' : '';

/** Box-drawing characters for borders */
export const box = {
  tl: '╭',
  tr: '╮',
  bl: '╰',
  br: '╯',
  h: '─',
  v: '│',
  ltee: '├',
  rtee: '┤',
  cross: '┼',
  top: '┬',
  bot: '┴',
} as const;

/** Draw a framed box around lines of text */
export function boxed(lines: string[], width: number, color: (s: string) => string = cyan): string {
  const top = color(`${box.tl}${box.h.repeat(width + 2)}${box.tr}`);
  const bot = color(`${box.bl}${box.h.repeat(width + 2)}${box.br}`);
  const mid = lines.map((l) => {
    // Strip ANSI for length calculation
    const plain = l.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - plain.length);
    return `${color(box.v)} ${l}${' '.repeat(pad)} ${color(box.v)}`;
  });
  return [top, ...mid, bot].join('\n');
}

/** Horizontal rule */
export function hr(width: number = 60, color: (s: string) => string = gray): string {
  return color(box.h.repeat(width));
}

/**
 * Colorize plain-text tool output for terminal display.
 * Transforms markdown-style headers, tables, bars, and inline markers
 * into ANSI-colored output. Only used in CLI/smoke-test, never in MCP responses.
 */
export function colorizeOutput(text: string): string {
  if (!enabled) return text;

  return text
    .split('\n')
    .map((line) => {
      // ## Section headers → bold cyan
      if (line.startsWith('## ')) {
        return bold(cyan(line));
      }
      // ### Sub-headers → bold
      if (line.startsWith('### ')) {
        return bold(line);
      }
      // #### Sub-sub-headers → bold dim
      if (line.startsWith('#### ')) {
        return bold(dim(line));
      }

      // Table separator lines (all dashes and spaces) → dim
      if (/^[-\s]+$/.test(line) && line.includes('--')) {
        return dim(line);
      }

      // Score bars: [████████░░] 80 → colored by score value
      line = line.replace(
        /\[(█*)(░*)\]\s*(\d+)/g,
        (_match, filled: string, empty: string, score: string) => {
          const n = parseInt(score, 10);
          const barColor = n >= 70 ? red : n >= 40 ? yellow : n > 0 ? green : dim;
          return `${barColor(`[${filled}${empty}]`)} ${barColor(score)}`;
        },
      );

      // Inline **bold** → actual bold
      line = line.replace(/\*\*([^*]+)\*\*/g, (_m, content: string) => bold(content));

      // Lines with ⚠️ → yellow
      if (line.includes('⚠️') || line.includes('⚠')) {
        return yellow(line);
      }

      // +N / -N numbers in table rows (additions/deletions)
      line = line.replace(/(?<=\s)\+(\d+)/g, (_m, n: string) => green(`+${n}`));
      line = line.replace(/(?<=\s)-(\d+)/g, (_m, n: string) => red(`-${n}`));

      // Risk level labels
      line = line.replace(/\bHIGH\b/g, bold(red('HIGH')));
      line = line.replace(/\bMEDIUM\b/g, bold(yellow('MEDIUM')));
      line = line.replace(/\bLOW\b/g, bold(green('LOW')));

      // Churn ratio highlighting (values near 1.0 are bad)
      line = line.replace(/(?<=\s)(0\.\d{2})(?=\s)/g, (_m, ratio: string) => {
        const v = parseFloat(ratio);
        if (v >= 0.8) return bold(red(ratio));
        if (v >= 0.5) return yellow(ratio);
        return dim(ratio);
      });

      // Coupling score highlighting (1.00 is concerning)
      line = line.replace(/(?<=\s)(1\.00)(?=\s)/g, bold(yellow('1.00')));

      // Distribution bars (█ blocks in commit_patterns) → cyan
      line = line.replace(/(█{2,})/g, cyan('$1'));

      return line;
    })
    .join('\n');
}
