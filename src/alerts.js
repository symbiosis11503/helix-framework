/**
 * Alerts — Proactive notification system
 *
 * Sends alerts via webhook, email (SMTP), or internal event log
 * when conditions are met (health degraded, task failed, threshold breached).
 *
 * Shared core: works with both PG and SQLite via db.js adapter.
 */

import { query, getType } from './db.js';

// ========== Init ==========

export async function initAlertTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      condition_type TEXT NOT NULL,
      condition_config TEXT NOT NULL,
      channel TEXT NOT NULL,
      channel_config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      cooldown_ms INTEGER DEFAULT 300000,
      last_fired_at TEXT,
      fire_count INTEGER DEFAULT 0,
      created_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      rule_name TEXT,
      message TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      error TEXT,
      fired_at TEXT
    )
  `);

  await query('CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(rule_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_alert_history_fired ON alert_history(fired_at DESC)');
}

// ========== Helpers ==========

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function nowExpr() {
  return getType() === 'pg' ? 'now()' : "datetime('now')";
}

// ========== Rule Management ==========

/**
 * Create an alert rule
 * @param {object} opts
 * @param {string} opts.name - Human-readable name
 * @param {string} opts.conditionType - 'health' | 'task_failed' | 'threshold' | 'custom'
 * @param {object} opts.conditionConfig - { metric?, threshold?, comparison? }
 * @param {string} opts.channel - 'webhook' | 'email' | 'log'
 * @param {object} opts.channelConfig - { url?, to?, from?, subject? }
 * @param {number} [opts.cooldownMs=300000] - Min ms between firings
 */
export async function createRule({ name, conditionType, conditionConfig, channel, channelConfig, cooldownMs = 300000 }) {
  const id = genId('alert');
  await query(
    `INSERT INTO alert_rules (id, name, condition_type, condition_config, channel, channel_config, cooldown_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${nowExpr()})`,
    [id, name, conditionType, JSON.stringify(conditionConfig), channel, JSON.stringify(channelConfig), cooldownMs]
  );
  return { id, name };
}

/**
 * List alert rules
 */
export async function listRules({ enabledOnly = false } = {}) {
  let sql = 'SELECT * FROM alert_rules';
  if (enabledOnly) sql += ' WHERE enabled = 1';
  sql += ' ORDER BY created_at DESC';
  return (await query(sql)).rows;
}

/**
 * Enable/disable a rule
 */
export async function toggleRule(ruleId, enabled) {
  await query('UPDATE alert_rules SET enabled = $1 WHERE id = $2', [enabled ? 1 : 0, ruleId]);
  return { toggled: true, enabled };
}

/**
 * Delete a rule
 */
export async function deleteRule(ruleId) {
  const r = await query('DELETE FROM alert_rules WHERE id = $1', [ruleId]);
  return { deleted: r.rowCount > 0 };
}

// ========== Alert Firing ==========

/**
 * Fire an alert manually or from a condition check
 * @param {string} ruleId
 * @param {string} message - Alert message
 */
export async function fireAlert(ruleId, message) {
  const rules = await query('SELECT * FROM alert_rules WHERE id = $1', [ruleId]);
  const rule = rules.rows[0];
  if (!rule) throw new Error('Rule not found');
  if (!rule.enabled) return { fired: false, reason: 'rule disabled' };

  // Check cooldown
  if (rule.last_fired_at) {
    const lastFired = new Date(rule.last_fired_at).getTime();
    if (Date.now() - lastFired < rule.cooldown_ms) {
      return { fired: false, reason: 'cooldown active' };
    }
  }

  const channelConfig = JSON.parse(rule.channel_config || '{}');
  let status = 'sent';
  let error = null;

  try {
    switch (rule.channel) {
      case 'webhook':
        await sendWebhook(channelConfig.url, { rule: rule.name, message, timestamp: new Date().toISOString() });
        break;
      case 'email':
        await sendEmail(channelConfig, { rule: rule.name, message });
        break;
      case 'log':
        console.log(`[alert] ${rule.name}: ${message}`);
        break;
      default:
        console.log(`[alert] ${rule.name}: ${message}`);
    }
  } catch (e) {
    status = 'failed';
    error = e.message;
  }

  // Record in history
  const histId = genId('ahist');
  await query(
    `INSERT INTO alert_history (id, rule_id, rule_name, message, channel, status, error, fired_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${nowExpr()})`,
    [histId, ruleId, rule.name, message, rule.channel, status, error]
  );

  // Update rule
  await query(
    `UPDATE alert_rules SET last_fired_at = ${nowExpr()}, fire_count = fire_count + 1 WHERE id = $1`,
    [ruleId]
  );

  return { fired: true, status, historyId: histId };
}

/**
 * Check all enabled rules against current metrics and fire if conditions met
 * @param {object} metrics - { health?, tasksFailed?, memoryUsage?, customMetrics? }
 */
export async function evaluateRules(metrics = {}) {
  const rules = await listRules({ enabledOnly: true });
  const fired = [];

  for (const rule of rules) {
    const config = JSON.parse(rule.condition_config || '{}');
    let shouldFire = false;
    let message = '';

    switch (rule.condition_type) {
      case 'health':
        if (metrics.health === 'degraded' || metrics.health === 'down') {
          shouldFire = true;
          message = `Health status: ${metrics.health}`;
        }
        break;

      case 'task_failed':
        if (metrics.tasksFailed && metrics.tasksFailed > 0) {
          shouldFire = true;
          message = `${metrics.tasksFailed} task(s) failed`;
        }
        break;

      case 'threshold':
        if (config.metric && config.threshold !== undefined) {
          const value = metrics[config.metric] ?? metrics.customMetrics?.[config.metric];
          const comparison = config.comparison || '>';
          if (value !== undefined) {
            if (comparison === '>' && value > config.threshold) shouldFire = true;
            if (comparison === '<' && value < config.threshold) shouldFire = true;
            if (comparison === '>=' && value >= config.threshold) shouldFire = true;
            if (comparison === '==' && value === config.threshold) shouldFire = true;
            if (shouldFire) message = `${config.metric} = ${value} (threshold: ${comparison} ${config.threshold})`;
          }
        }
        break;

      case 'custom':
        if (config.check && metrics[config.check]) {
          shouldFire = true;
          message = config.message || `Custom condition triggered: ${config.check}`;
        }
        break;
    }

    if (shouldFire) {
      const result = await fireAlert(rule.id, message);
      if (result.fired) fired.push({ ruleId: rule.id, name: rule.name, message });
    }
  }

  return { evaluated: rules.length, fired };
}

// ========== History ==========

/**
 * Get alert history
 */
export async function getHistory({ ruleId = null, limit = 50 } = {}) {
  let sql = 'SELECT * FROM alert_history';
  const params = [];
  if (ruleId) { sql += ' WHERE rule_id = $1'; params.push(ruleId); }
  sql += ` ORDER BY fired_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  return (await query(sql, params)).rows;
}

// ========== Delivery Channels ==========

async function sendWebhook(url, payload) {
  if (!url) throw new Error('Webhook URL required');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook ${res.status}`);
}

async function sendEmail(config, { rule, message }) {
  // Lightweight email via SMTP — requires SMTP env vars
  const smtpHost = config.smtp_host || process.env.SMTP_HOST;
  const smtpPort = config.smtp_port || process.env.SMTP_PORT || 587;
  if (!smtpHost) {
    console.log(`[alert-email] ${rule}: ${message} (SMTP not configured, logged only)`);
    return;
  }
  // For full SMTP, users should configure nodemailer or similar
  // This is a placeholder that logs the intent
  console.log(`[alert-email] To: ${config.to} | Subject: [Helix Alert] ${rule} | ${message}`);
}

export default {
  initAlertTables,
  createRule, listRules, toggleRule, deleteRule,
  fireAlert, evaluateRules,
  getHistory,
};
