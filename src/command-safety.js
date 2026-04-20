/**
 * Command Safety Engine — Execution Safety OS Layer
 *
 * Shell-level dangerous command inspection:
 * - 30+ regex patterns for dangerous operations
 * - Unicode normalization + ANSI strip (anti-obfuscation)
 * - Command classification: safe / warn / block
 *
 * Shared core: used by gateway.js when tool = shell_exec
 *
 * Inspired by Hermes approval.py patterns + Claude Code bash security checks.
 */

// ========== Dangerous Command Patterns ==========

const DANGEROUS_PATTERNS = [
  // Destructive file operations
  { pattern: /\brm\s+(-[rRf]+\s+|--recursive|--force)/i, category: 'destructive', severity: 'block', description: 'Recursive/force file deletion' },
  { pattern: /\brm\s+-[^-]*r/i, category: 'destructive', severity: 'block', description: 'Recursive file deletion' },
  { pattern: /\bfind\b.*\s-delete\b/i, category: 'destructive', severity: 'block', description: 'Find with delete' },
  { pattern: /\bfind\b.*-exec\s+rm\b/i, category: 'destructive', severity: 'block', description: 'Find with exec rm' },
  { pattern: />\s*\/dev\/sd[a-z]/i, category: 'destructive', severity: 'block', description: 'Write to block device' },
  { pattern: /\bdd\s+.*of=\/dev\//i, category: 'destructive', severity: 'block', description: 'dd to device' },
  { pattern: /\bmkfs\b/i, category: 'destructive', severity: 'block', description: 'Format filesystem' },
  { pattern: /\bshred\b/i, category: 'destructive', severity: 'block', description: 'Secure file erasure' },

  // Permission changes
  { pattern: /\bchmod\s+777\b/i, category: 'permission', severity: 'block', description: 'World-writable permissions' },
  { pattern: /\bchmod\s+-R\b/i, category: 'permission', severity: 'warn', description: 'Recursive permission change' },
  { pattern: /\bchown\s+-R\b/i, category: 'permission', severity: 'warn', description: 'Recursive ownership change' },

  // Database destruction
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, category: 'database', severity: 'block', description: 'Drop database object' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, category: 'database', severity: 'block', description: 'Truncate table' },
  { pattern: /\bDELETE\s+FROM\s+\S+\s*;/i, category: 'database', severity: 'block', description: 'DELETE without WHERE (ends with ;)' },
  { pattern: /\bDELETE\s+FROM\s+\S+\s*$/i, category: 'database', severity: 'block', description: 'DELETE without WHERE (end of command)' },

  // Git destructive operations
  { pattern: /\bgit\s+reset\s+--hard\b/i, category: 'git', severity: 'block', description: 'Hard reset (destroys uncommitted work)' },
  { pattern: /\bgit\s+push\s+.*--force\b/i, category: 'git', severity: 'block', description: 'Force push (can overwrite remote)' },
  { pattern: /\bgit\s+push\s+-f\b/i, category: 'git', severity: 'block', description: 'Force push (short flag)' },
  { pattern: /\bgit\s+clean\s+-[dfx]/i, category: 'git', severity: 'warn', description: 'Git clean (removes untracked files)' },
  { pattern: /\bgit\s+checkout\s+--\s+\./i, category: 'git', severity: 'warn', description: 'Discard all local changes' },
  { pattern: /\bgit\s+branch\s+-D\b/i, category: 'git', severity: 'warn', description: 'Force delete branch' },

  // Remote code execution
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/i, category: 'rce', severity: 'block', description: 'Pipe curl to shell' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/i, category: 'rce', severity: 'block', description: 'Pipe wget to shell' },
  { pattern: /\beval\b.*\$\(/i, category: 'rce', severity: 'warn', description: 'Eval with command substitution' },

  // System-level
  { pattern: /\bsystemctl\s+(stop|disable|mask)\b/i, category: 'system', severity: 'warn', description: 'Stop/disable system service' },
  { pattern: /\bkill\s+-9\b/i, category: 'system', severity: 'warn', description: 'Force kill process' },
  { pattern: /\bkillall\b/i, category: 'system', severity: 'warn', description: 'Kill all processes by name' },
  { pattern: /\bshutdown\b|\breboot\b/i, category: 'system', severity: 'block', description: 'System shutdown/reboot' },
  { pattern: /\buseradd\b|\buserdel\b/i, category: 'system', severity: 'block', description: 'User account modification' },

  // Network exposure
  { pattern: /\bnc\s+-l\b/i, category: 'network', severity: 'warn', description: 'Netcat listener (opens port)' },
  { pattern: /\bssh-keygen\b.*-f.*authorized/i, category: 'network', severity: 'block', description: 'Modify SSH authorized keys' },

  // Heredoc/script injection
  { pattern: /<<[-~]?\s*['"]?EOF['"]?\b/i, category: 'injection', severity: 'warn', description: 'Heredoc script execution' },
  { pattern: /\bpython[23]?\s+-c\s+['"]/i, category: 'injection', severity: 'warn', description: 'Inline Python execution' },
  { pattern: /\bnode\s+-e\s+['"]/i, category: 'injection', severity: 'warn', description: 'Inline Node.js execution' },

  // Self-termination
  { pattern: /\bkill\s+.*\$\$/i, category: 'self', severity: 'block', description: 'Kill own process' },
  { pattern: /\bexit\s+1\b/i, category: 'self', severity: 'warn', description: 'Exit with error' },

  // Credential exposure
  { pattern: /\benv\b|\bprintenv\b|\bset\b.*\bx\b/i, category: 'secrets', severity: 'warn', description: 'Environment variable dump' },
  { pattern: /\bcat\s+.*\.(env|pem|key|secret|credentials)/i, category: 'secrets', severity: 'block', description: 'Read credential file' },
  { pattern: /\becho\s+.*\$(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY)/i, category: 'secrets', severity: 'block', description: 'Echo secret variable' },
];

// ========== Normalization ==========

/**
 * Normalize command string — strip ANSI escapes + Unicode confusables
 */
function normalizeCommand(cmd) {
  if (!cmd) return '';

  // Strip ANSI escape sequences
  let normalized = cmd.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  // Strip other escape sequences
  normalized = normalized.replace(/\x1b[^[]/g, '');

  // Normalize Unicode confusables (common attack vectors)
  // Replace fullwidth characters with ASCII equivalents
  normalized = normalized.replace(/[\uff01-\uff5e]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );

  // Replace zero-width characters
  normalized = normalized.replace(/[\u200b-\u200f\u2028-\u202f\u2060\ufeff]/g, '');

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

// ========== Command Classification ==========

/**
 * Inspect a shell command for dangerous patterns
 * @param {string} command - the shell command to inspect
 * @returns {{ safe: boolean, level: 'safe'|'warn'|'block', matches: Array }}
 */
export function inspectCommand(command) {
  const normalized = normalizeCommand(command);
  const matches = [];

  for (const rule of DANGEROUS_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      matches.push({
        category: rule.category,
        severity: rule.severity,
        description: rule.description,
        matched: normalized.match(rule.pattern)?.[0] || '',
      });
    }
  }

  if (matches.length === 0) {
    return { safe: true, level: 'safe', matches: [] };
  }

  const hasBlock = matches.some(m => m.severity === 'block');
  return {
    safe: false,
    level: hasBlock ? 'block' : 'warn',
    matches,
  };
}

/**
 * Quick check — returns true if command is safe to execute
 */
export function isSafe(command) {
  return inspectCommand(command).safe;
}

/**
 * Get human-readable risk summary
 */
export function riskSummary(command) {
  const result = inspectCommand(command);
  if (result.safe) return '安全';

  const descriptions = result.matches.map(m =>
    `[${m.severity.toUpperCase()}] ${m.description} (${m.category})`
  );

  return descriptions.join('; ');
}

/**
 * Get all registered patterns (for admin inspection)
 */
export function getPatterns() {
  return DANGEROUS_PATTERNS.map(p => ({
    pattern: p.pattern.source,
    category: p.category,
    severity: p.severity,
    description: p.description,
  }));
}

export default { inspectCommand, isSafe, riskSummary, getPatterns };
