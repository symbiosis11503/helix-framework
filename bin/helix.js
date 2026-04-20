#!/usr/bin/env node
/**
 * Helix CLI — AI Agent Framework
 * Usage:
 *   helix init          — 初始化專案骨架
 *   helix start         — 啟動本地 agent runtime
 *   helix login         — 設定 API key
 *   helix doctor        — 檢查環境
 *   helix status        — 查看 agent 狀態
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import { createInterface } from 'readline';

const VERSION = '0.8.0';
const HOME_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', '.helix');
const CONFIG_PATH = join(HOME_DIR, 'config.json');
const AUTH_PATH = join(HOME_DIR, 'auth.json');

function ensureHomeDir() {
  if (!existsSync(HOME_DIR)) mkdirSync(HOME_DIR, { recursive: true });
}

function loadConfig() {
  ensureHomeDir();
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function saveConfig(config) {
  ensureHomeDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadAuth() {
  ensureHomeDir();
  if (!existsSync(AUTH_PATH)) return {};
  try { return JSON.parse(readFileSync(AUTH_PATH, 'utf8')); } catch { return {}; }
}

function saveAuth(auth) {
  ensureHomeDir();
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

// ========== Commands ==========

async function cmdInit() {
  console.log(`\n🚀 Helix Agent Framework v${VERSION}`);
  console.log('=' .repeat(40));

  const cwd = process.cwd();

  // Check if already initialized
  if (existsSync(join(cwd, 'helix.config.js'))) {
    console.log('⚠️  此目錄已有 helix.config.js，跳過初始化。');
    return;
  }

  // Create helix.config.js
  writeFileSync(join(cwd, 'helix.config.js'), `/** @type {import('helix-agent-framework').HelixConfig} */
export default {
  // Agent 使用的 LLM 模型
  model: 'gemini-2.5-flash',

  // API key 來源（環境變數名）
  apiKeyEnv: 'GEMINI_API_KEY',

  // 本地資料庫（SQLite 或 PG）
  database: {
    type: 'sqlite',  // 'sqlite' | 'pg'
    path: '.helix/helix.db',  // SQLite 路徑
    // pg: { host: 'localhost', port: 5432, user: 'helix', database: 'helix' }
  },

  // Agent 角色定義
  agents: [
    { id: 'assistant', name: '助理', systemPrompt: '你是一個有幫助的 AI 助理。' },
  ],

  // 伺服器設定
  server: {
    port: 18860,
    host: '127.0.0.1',
  },
};
`);

  // Create local data directory
  mkdirSync(join(cwd, '.helix'), { recursive: true });

  // Ensure package.json has "type": "module" for ESM config (helix.config.js uses export default)
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({ name: 'helix-project', type: 'module', private: true }, null, 2) + '\n');
  } else {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.type !== 'module') {
        pkg.type = 'module';
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        console.log('  ℹ️  package.json type 已設為 "module" (helix.config.js 需要 ESM)');
      }
    } catch {}
  }

  // Create project scaffold
  const scaffoldFiles = {
    'CLAUDE.md': `# AI 協作指南\n\n## 工作流\n1. 先讀 AI_CONTEXT.md\n2. 檢查 .agents/memory.md\n3. 有 SOP 就用 .agents/skills/\n4. 完成後更新 memory.md\n`,
    'AI_CONTEXT.md': `# 專案背景\n\n## 專案名稱\n(填入)\n\n## 技術棧\n(填入)\n`,
    '.agents/memory.md': `# Agent 記憶\n\n## 最近完成\n\n## 待辦\n\n## 教訓\n`,
  };

  mkdirSync(join(cwd, '.agents', 'skills'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'knowledge'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'raw'), { recursive: true });

  for (const [file, content] of Object.entries(scaffoldFiles)) {
    const path = join(cwd, file);
    if (!existsSync(path)) {
      const dir = join(cwd, file.split('/').slice(0, -1).join('/'));
      if (dir !== cwd) mkdirSync(dir, { recursive: true });
      writeFileSync(path, content);
    }
  }

  // Add .helix/ to .gitignore
  const gitignorePath = join(cwd, '.gitignore');
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  if (!gitignore.includes('.helix/')) {
    writeFileSync(gitignorePath, gitignore + '\n# Helix local data\n.helix/\n');
  }

  console.log('\n✅ Helix 已初始化：');
  console.log('  helix.config.js    — 設定檔');
  console.log('  .helix/            — 本地資料');
  console.log('  CLAUDE.md          — AI 工作流');
  console.log('  AI_CONTEXT.md      — 專案背景');
  console.log('  .agents/memory.md  — 跨 session 記憶');
  console.log('\n下一步：');
  console.log('  1. 編輯 helix.config.js 設定模型和 API key');
  console.log('  2. 執行 helix login 設定 API key');
  console.log('  3. 執行 helix start 啟動 runtime');
}

async function cmdLogin() {
  console.log(`\n🔑 Helix Login — 設定 API Key`);

  // Support non-interactive flags: helix login --provider gemini --api-key xxx
  const flagProvider = getFlag('--provider');
  const flagKey = getFlag('--api-key');

  const provider = flagProvider || await prompt('選擇 LLM provider (gemini/claude/openai) [gemini]: ') || 'gemini';
  const envMap = { gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };
  const envKey = envMap[provider] || `${provider.toUpperCase()}_API_KEY`;

  const key = flagKey || await prompt(`輸入 ${envKey}: `);
  if (!key) { console.log('取消。'); return; }

  const auth = loadAuth();
  auth[envKey] = key;
  auth.provider = provider;
  auth.updated_at = new Date().toISOString();
  saveAuth(auth);

  console.log(`\n✅ ${envKey} 已儲存到 ~/.helix/auth.json`);
  console.log('  提示：也可以設定環境變數 ' + envKey + ' 來覆蓋');
}

function getFlag(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

async function cmdDoctor() {
  console.log(`\n🩺 Helix Doctor — 環境檢查`);
  const checks = [];

  // Node version
  const nodeVer = process.version;
  checks.push({ name: 'Node.js', ok: parseInt(nodeVer.slice(1)) >= 18, value: nodeVer });

  // Config
  const hasConfig = existsSync(join(process.cwd(), 'helix.config.js'));
  checks.push({ name: 'helix.config.js', ok: hasConfig, value: hasConfig ? '存在' : '不存在 (執行 helix init)' });

  // Auth
  const auth = loadAuth();
  const hasKey = Object.keys(auth).some(k => k.endsWith('_API_KEY') && auth[k]);
  checks.push({ name: 'API Key', ok: hasKey, value: hasKey ? `${auth.provider || 'configured'}` : '未設定 (執行 helix login)' });

  // .helix dir
  const hasDir = existsSync(join(process.cwd(), '.helix'));
  checks.push({ name: '.helix/', ok: hasDir, value: hasDir ? '存在' : '不存在' });

  // SQLite dependency
  let hasSqlite = false;
  try { await import('better-sqlite3'); hasSqlite = true; } catch {}
  checks.push({ name: 'better-sqlite3', ok: hasSqlite, value: hasSqlite ? '可用' : '未安裝 (npm install better-sqlite3)' });

  // Port availability
  const configPort = existsSync(join(process.cwd(), 'helix.config.js'))
    ? (await import(join(process.cwd(), 'helix.config.js'))).default?.server?.port || 18860
    : 18860;
  let portFree = true;
  try {
    const net = await import('net');
    await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', () => { portFree = false; resolve(); });
      srv.once('listening', () => { srv.close(); resolve(); });
      srv.listen(configPort, '127.0.0.1');
    });
  } catch { portFree = false; }
  checks.push({ name: `Port ${configPort}`, ok: portFree, value: portFree ? '可用' : `已被佔用 (用 helix start --port 換一個)` });

  // Git
  let hasGit = false;
  try { execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' }); hasGit = true; } catch {}
  checks.push({ name: 'Git', ok: hasGit, value: hasGit ? 'repo' : '不是 git repo (建議 git init)' });

  // Shared core modules
  const coreModules = ['session-store.js', 'command-safety.js', 'hooks.js', 'delegation.js', 'edit-tool.js', 'mcp-client.js', 'llm-provider.js', 'tool-registry.js', 'gateway-adapter.js', 'memory-manager.js', 'agent-autonomy.js', 'skills.js', 'agent-reasoning.js', 'trace-lite.js', 'auth.js', 'oauth.js', 'workflow.js', 'knowledge.js', 'two-factor.js', 'alerts.js', 'eval-lite.js'];
  const corePath = join(resolve(import.meta.dirname || '.', '..'), 'src');
  let coreCount = 0;
  for (const mod of coreModules) {
    if (existsSync(join(corePath, mod))) coreCount++;
  }
  checks.push({ name: 'Shared Core', ok: coreCount === coreModules.length, value: `${coreCount}/${coreModules.length} 模組` });

  console.log('');
  for (const c of checks) {
    console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}: ${c.value}`);
  }
  const allOk = checks.every(c => c.ok);
  console.log(`\n${allOk ? '✅ 環境正常，可以執行 helix start' : '⚠️ 有項目需要修正'}`);
}

async function cmdStatus() {
  console.log(`\n📊 Helix Status`);
  try {
    const config = (await import(join(process.cwd(), 'helix.config.js'))).default;
    const port = config?.server?.port || 18860;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const data = await res.json();
    console.log(`  Server: ${data.status} (uptime ${Math.round(data.uptime)}s)`);
    const ready = await fetch(`http://127.0.0.1:${port}/api/readiness`);
    const readyData = await ready.json();
    console.log(`  Readiness: ${readyData.ok ? 'ALL OK' : 'DEGRADED'}`);
  } catch {
    console.log('  Server: 未運行 (執行 helix start)');
  }
}

async function probeStartDeps(config) {
  const result = { critical: [], warnings: [] };

  // Critical: Node version
  if (parseInt(process.version.slice(1)) < 18) {
    result.critical.push(`Node.js ${process.version} 太舊，需要 >=18`);
  }

  // Critical: DB driver
  const dbType = config?.database?.type || 'sqlite';
  if (dbType === 'sqlite') {
    try { await import('better-sqlite3'); }
    catch { result.critical.push('better-sqlite3 未安裝 — npm install better-sqlite3'); }
  } else if (dbType === 'postgres' || dbType === 'pg') {
    try { await import('pg'); }
    catch { result.critical.push('pg 未安裝 — npm install pg'); }
  }

  // Critical: express
  try { await import('express'); }
  catch { result.critical.push('express 未安裝 — npm install express'); }

  // Warning: API key
  const auth = loadAuth();
  const hasKey = Object.keys(auth).some(k => k.endsWith('_API_KEY') && auth[k]);
  if (!hasKey) result.warnings.push('未設定任何 API_KEY — chat / reasoning 會失敗（執行 helix login）');

  // Warning: model 設定
  if (!config?.models?.default && !config?.model) {
    result.warnings.push('helix.config.js 未設 default model — 部分 agent 跑不起來');
  }

  // Warning: port 佔用
  const port = config?.server?.port || 18860;
  let portFree = true;
  try {
    const net = await import('net');
    await new Promise((res) => {
      const srv = net.createServer();
      srv.once('error', () => { portFree = false; res(); });
      srv.once('listening', () => { srv.close(); res(); });
      srv.listen(port, '127.0.0.1');
    });
  } catch { portFree = false; }
  if (!portFree) result.warnings.push(`Port ${port} 已被佔用 — 用 helix start --port 換一個`);

  return result;
}

async function cmdStart() {
  console.log(`\n🚀 Helix Agent Runtime v${VERSION}`);
  const configPath = join(process.cwd(), 'helix.config.js');
  if (!existsSync(configPath)) {
    console.log('❌ 找不到 helix.config.js，請先執行 helix init');
    process.exit(1);
  }

  // Load config
  const config = (await import(configPath)).default;

  // Load auth and set env
  const auth = loadAuth();
  for (const [k, v] of Object.entries(auth)) {
    if (k.endsWith('_API_KEY') && v) process.env[k] = v;
  }

  const dbType = config?.database?.type || 'sqlite';
  const portFlag = getFlag('--port');
  const port = portFlag ? parseInt(portFlag) : (config?.server?.port || 18860);
  if (portFlag) config.server = { ...config.server, port };

  // Dependency probe — fail-fast on critical, safe-mode on warnings
  const probe = await probeStartDeps(config);
  const safeMode = process.argv.includes('--safe-mode');
  if (probe.critical.length > 0 && !safeMode) {
    console.log('\n❌ Critical dependencies missing:');
    for (const m of probe.critical) console.log(`   - ${m}`);
    console.log('\n  → 安裝 critical deps 後重試');
    console.log('  → 或 helix start --safe-mode 強制啟動（部分功能跑不了）');
    process.exit(1);
  }
  if (probe.warnings.length > 0) {
    console.log('\n⚠️  Warnings (safe-mode degradation):');
    for (const m of probe.warnings) console.log(`   - ${m}`);
    console.log('  繼續啟動，但部分功能可能不可用');
  }
  if (probe.critical.length > 0 && safeMode) {
    console.log('\n⚠️  --safe-mode 啟用，跳過 critical check（debug 用，正式環境別用）');
  }

  console.log(`\n  模式: ${dbType === 'sqlite' ? 'SQLite (本地)' : 'PostgreSQL'}`);
  console.log('  啟動中... (Ctrl+C 停止)');

  try {
    if (dbType === 'sqlite') {
      // Lite mode — standalone server with SQLite
      const { startLiteServer } = await import('../src/server-lite.js');
      await startLiteServer(config);
    } else {
      // Full mode — requires PG
      await import('../src/index.js');
    }
  } catch (e) {
    console.error('啟動失敗:', e.message);
    if (!safeMode) console.error('  提示：嘗試 helix start --safe-mode 看詳細啟動進度');
    process.exit(1);
  }
}

// ========== Agent Commands ==========

async function cmdAgentList() {
  console.log(`\n📋 Agent 列表`);
  try {
    const config = (await import(join(process.cwd(), 'helix.config.js'))).default;
    const port = config?.server?.port || 18860;
    const res = await fetch(`http://127.0.0.1:${port}/api/agents/instances`);
    const data = await res.json();
    if (!data.agents?.length) { console.log('  (無 agent)'); return; }
    for (const a of data.agents) {
      console.log(`  ${a.status === 'active' ? '🟢' : '⚪'} ${a.id} — ${a.name || a.role_id} (${a.model || 'default'})`);
    }
  } catch { console.log('  ❌ runtime 未啟動 (先執行 helix start)'); }
}

async function cmdAgentChat() {
  const isReplAlias = process.argv[2] === 'repl';
  const agentId = (isReplAlias ? process.argv[3] : process.argv[4]) || 'assistant';
  console.log(`\n💬 Helix Chat — Agent: ${agentId}`);
  console.log('  輸入訊息，按 Enter 送出。輸入 /quit 離開。\n');

  try {
    const config = (await import(join(process.cwd(), 'helix.config.js'))).default;
    const port = config?.server?.port || 18860;

    // Check server is running
    await fetch(`http://127.0.0.1:${port}/api/health`);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    let sessionId = null;
    let currentAgent = agentId;
    const history = []; // [{role, content}]
    const SLASH_HELP = [
      '  /help                 — 顯示這份說明',
      '  /clear                — 清螢幕（不重置 session）',
      '  /reset                — 重置 session（清空對話記憶）',
      '  /agents               — 列出所有 agent',
      '  /switch <id>          — 切換到別的 agent',
      '  /memory [limit]       — 顯示 agent 長期記憶 stats / 最近 N 筆',
      '  /history              — 顯示本次 session 已交換訊息',
      '  /save <path>          — 匯出本次對話到 JSON',
      '  /session              — 顯示當前 session_id',
      '  /quit | /exit         — 離開',
    ].join('\n');
    console.log('輸入 /help 看可用命令\n');

    while (true) {
      const msg = await ask(`你> `);
      const trimmed = msg.trim();
      if (!trimmed) continue;

      // ===== Slash commands =====
      if (trimmed.startsWith('/')) {
        const [cmd, ...rest] = trimmed.split(/\s+/);
        const arg = rest.join(' ');
        if (cmd === '/quit' || cmd === '/exit') { rl.close(); break; }
        if (cmd === '/help') { console.log(SLASH_HELP + '\n'); continue; }
        if (cmd === '/clear') { process.stdout.write('\x1Bc'); continue; }
        if (cmd === '/session') { console.log(`  session_id: ${sessionId || '(none)'}\n`); continue; }
        if (cmd === '/history') {
          if (history.length === 0) { console.log('  (空)\n'); continue; }
          for (const h of history) console.log(`  ${h.role}> ${h.content}`);
          console.log('');
          continue;
        }
        if (cmd === '/reset') {
          await fetch(`http://127.0.0.1:${port}/api/agent/reset-session`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent: currentAgent }),
          });
          sessionId = null;
          history.length = 0;
          console.log('  (session 已重置)\n');
          continue;
        }
        if (cmd === '/agents') {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/api/agents/instances`);
            const d = await r.json();
            if (!d.agents?.length) { console.log('  (無 agent)\n'); continue; }
            for (const a of d.agents) console.log(`  ${a.id === currentAgent ? '→' : ' '} ${a.id}  ${a.name || a.role_id || ''}`);
            console.log('');
          } catch (e) { console.log(`  ❌ ${e.message}\n`); }
          continue;
        }
        if (cmd === '/switch') {
          if (!arg) { console.log('  Usage: /switch <agentId>\n'); continue; }
          currentAgent = arg;
          sessionId = null;
          history.length = 0;
          console.log(`  → 切換到 ${currentAgent}（session 已清）\n`);
          continue;
        }
        if (cmd === '/memory') {
          const limit = parseInt(arg) || 10;
          try {
            const r = await fetch(`http://127.0.0.1:${port}/api/memory/v2/stats/${currentAgent}`);
            const stats = await r.json();
            console.log(`  總筆數: ${stats.total ?? '?'}  平均重要度: ${stats.avg_importance ?? '?'}`);
            const recall = await fetch(`http://127.0.0.1:${port}/api/memory/v2/recall`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agent_id: currentAgent, query: '', limit }),
            });
            const recallData = await recall.json();
            for (const m of (recallData.memories || []).slice(0, limit)) {
              console.log(`    [${m.type}/${(m.importance ?? 0).toFixed(2)}] ${(m.summary || m.content || '').slice(0, 80)}`);
            }
            console.log('');
          } catch (e) { console.log(`  ❌ ${e.message}\n`); }
          continue;
        }
        if (cmd === '/save') {
          const path = arg || `chat-${Date.now()}.json`;
          try {
            writeFileSync(path, JSON.stringify({ agent: currentAgent, session_id: sessionId, history }, null, 2));
            console.log(`  ✅ 已寫入 ${path}\n`);
          } catch (e) { console.log(`  ❌ ${e.message}\n`); }
          continue;
        }
        console.log(`  未知命令 ${cmd}（輸入 /help 看清單）\n`);
        continue;
      }

      // ===== Normal chat =====
      history.push({ role: 'user', content: trimmed });
      try {
        const body = { agent: currentAgent, message: trimmed };
        if (sessionId) body.session_id = sessionId;
        const res = await fetch(`http://127.0.0.1:${port}/api/agent/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.reply) {
          console.log(`\n${currentAgent}> ${data.reply}\n`);
          history.push({ role: currentAgent, content: data.reply });
          if (data.session_id) sessionId = data.session_id;
        } else {
          console.log(`  ❌ ${data.error || 'no reply'}\n`);
        }
      } catch (e) {
        console.log(`  ❌ ${e.message}\n`);
      }
    }
  } catch { console.log('  ❌ runtime 未啟動 (先執行 helix start)'); }
}

// ========== Export / Import ==========

async function cmdExport() {
  console.log(`\n📦 Helix Export`);
  const cwd = process.cwd();
  const dbPath = join(cwd, '.helix', 'helix.db');
  if (!existsSync(dbPath)) {
    console.log('  ❌ 找不到 .helix/helix.db');
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join(cwd, '.helix', 'exports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportPath = join(outDir, `helix-export-${ts}.json`);

  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const data = {
      version: VERSION,
      exported_at: new Date().toISOString(),
      tables: {},
    };

    const tables = ['tasks', 'agent_instances', 'personal_memory', 'sessions', 'messages', 'workflows', 'cron_jobs'];
    for (const table of tables) {
      try {
        const rows = db.prepare(`SELECT * FROM ${table}`).all();
        data.tables[table] = rows;
        console.log(`  ✅ ${table}: ${rows.length} 筆`);
      } catch {
        console.log(`  ⚠️  ${table}: 不存在或無法讀取`);
      }
    }

    db.close();
    writeFileSync(exportPath, JSON.stringify(data, null, 2));
    console.log(`\n📦 匯出完成: ${exportPath}`);
    console.log(`  大小: ${(readFileSync(exportPath).length / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.error('匯出失敗:', e.message);
  }
}

async function cmdImport() {
  const importPath = process.argv[3];
  if (!importPath) {
    console.log('Usage: helix import <path-to-export.json>');
    return;
  }
  console.log(`\n📥 Helix Import: ${importPath}`);

  if (!existsSync(importPath)) {
    console.log('  ❌ 檔案不存在');
    return;
  }

  try {
    const data = JSON.parse(readFileSync(importPath, 'utf8'));
    console.log(`  版本: ${data.version}`);
    console.log(`  匯出時間: ${data.exported_at}`);
    console.log(`  包含 tables: ${Object.keys(data.tables || {}).join(', ')}`);

    const cwd = process.cwd();
    const dbPath = join(cwd, '.helix', 'helix.db');

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);

    let total = 0;
    for (const [table, rows] of Object.entries(data.tables || {})) {
      if (!Array.isArray(rows) || !rows.length) continue;
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(',');
      const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);

      const tx = db.transaction((items) => {
        let count = 0;
        for (const row of items) {
          try {
            insert.run(...cols.map(c => row[c] ?? null));
            count++;
          } catch {}
        }
        return count;
      });

      const imported = tx(rows);
      console.log(`  ✅ ${table}: ${imported} / ${rows.length} 筆匯入`);
      total += imported;
    }

    db.close();
    console.log(`\n📥 匯入完成: 共 ${total} 筆`);
  } catch (e) {
    console.error('匯入失敗:', e.message);
  }
}

// ========== Memory Commands ==========

async function cmdMemoryStats() {
  const port = await getRunningPort();
  if (!port) { console.log('❌ Runtime not running. Use: helix start'); return; }
  const agentId = process.argv[4] || 'default';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/v2/stats/${agentId}`);
    const data = await res.json();
    if (!data.ok) { console.log('❌', data.error); return; }
    console.log(`\n🧠 Memory Stats — ${agentId}`);
    console.log(`  Total memories: ${data.total}`);
    if (data.byType) {
      for (const [type, count] of Object.entries(data.byType)) {
        console.log(`  ${type}: ${count}`);
      }
    }
    console.log(`  Avg importance: ${(data.avgImportance || 0).toFixed(2)}`);
    console.log(`  Avg decay: ${(data.avgDecay || 0).toFixed(2)}`);
  } catch (e) { console.error('Error:', e.message); }
}

async function cmdMemoryRecall() {
  const port = await getRunningPort();
  if (!port) { console.log('❌ Runtime not running. Use: helix start'); return; }
  const agentId = process.argv[4] || 'default';
  const queryText = process.argv.slice(5).join(' ');
  if (!queryText) { console.log('Usage: helix memory recall <agent_id> <query>'); return; }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/v2/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, query: queryText, limit: 10 }),
    });
    const data = await res.json();
    if (!data.ok) { console.log('❌', data.error); return; }
    console.log(`\n🔍 Recall "${queryText}" — ${data.memories.length} results`);
    for (const m of data.memories) {
      const imp = (m.effective_importance || m.importance || 0).toFixed(2);
      console.log(`\n  [${m.type}] (importance: ${imp}) ${m.summary || ''}`);
      console.log(`  ${(m.content || '').slice(0, 120)}`);
    }
  } catch (e) { console.error('Error:', e.message); }
}

// ========== Gateway Commands ==========

async function cmdGatewayStatus() {
  const port = await getRunningPort();
  if (!port) { console.log('❌ Runtime not running. Use: helix start'); return; }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/gateway/messaging/adapters`);
    const data = await res.json();
    if (!data.ok) { console.log('❌', data.error); return; }
    console.log(`\n📡 Gateway Adapters`);
    console.log(`  Registered: ${data.adapters.length > 0 ? data.adapters.join(', ') : '(none)'}`);
    console.log(`  Supported: ${data.supported.join(', ')}`);

    // Check env vars
    const envChecks = [
      ['TELEGRAM_BOT_TOKEN', 'Telegram'],
      ['DISCORD_BOT_TOKEN', 'Discord'],
      ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE'],
      ['SLACK_BOT_TOKEN', 'Slack'],
    ];
    console.log(`\n  Environment:`);
    for (const [env, name] of envChecks) {
      const set = !!process.env[env];
      console.log(`  ${set ? '✅' : '⬜'} ${name} (${env})`);
    }
  } catch (e) { console.error('Error:', e.message); }
}

// ========== Eval Commands ==========

async function cmdEvalRun() {
  const suite = process.argv[4] || 'command-safety';
  const validSuites = ['command-safety', 'prompt-injection', 'memory-recall'];
  if (!validSuites.includes(suite)) {
    console.log(`❌ Unknown suite: ${suite}`);
    console.log(`  Available: ${validSuites.join(', ')}`);
    return;
  }

  // Try API first (server running)
  const port = await getRunningPort();
  if (port) {
    console.log(`\n🧪 Eval: ${suite} (via API)`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/eval/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suite }),
      });
      const data = await res.json();
      console.log(`  Score: ${data.score}% (${data.passed}/${data.total})`);
      if (data.results) {
        for (const r of data.results) {
          console.log(`  ${r.pass ? '✅' : '❌'} ${r.input.slice(0, 60)} → ${r.output} ${r.pass ? '' : `(expected ${r.expected})`}`);
        }
      }
      return;
    } catch {}
  }

  // Offline mode — direct import
  console.log(`\n🧪 Eval: ${suite} (offline)`);
  try {
    const { initDb } = await import('../src/db.js');
    await initDb({});
    const ev = await import('../src/eval-lite.js');
    await ev.initEvalTables();

    let result;
    if (suite === 'command-safety') result = await ev.evalCommandSafety();
    else if (suite === 'prompt-injection') result = await ev.evalPromptInjection();
    else if (suite === 'memory-recall') result = await ev.evalMemoryRecall();

    console.log(`  Score: ${result.score}% (${result.passed}/${result.total})`);
    for (const r of result.results) {
      console.log(`  ${r.pass ? '✅' : '❌'} ${r.input.slice(0, 60)} → ${r.output} ${r.pass ? '' : `(expected ${r.expected})`}`);
    }
  } catch (e) {
    console.error('Eval failed:', e.message);
  }
}

async function cmdEvalHistory() {
  const port = await getRunningPort();
  if (!port) { console.log('❌ Runtime not running. Use: helix start'); return; }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/eval/history?limit=10`);
    const data = await res.json();
    console.log(`\n📊 Eval History (${data.history?.length || 0} runs)`);
    for (const h of (data.history || [])) {
      console.log(`  ${h.suite.padEnd(18)} ${String(h.score).padStart(3)}% (${h.passed}/${h.total})  ${h.created_at || ''}`);
    }
  } catch (e) { console.error('Error:', e.message); }
}

// ========== Trace ==========

async function cmdTraceRuns() {
  const port = await getRunningPort();
  if (!port) { console.log('❌ Runtime not running. Use: helix start'); return; }
  const limit = parseInt(getFlag('--limit') || '20');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/trace/runs?limit=${limit}`);
    const data = await res.json();
    const runs = data.runs || [];
    console.log(`\n🛰  Trace Runs (${runs.length})`);
    if (runs.length === 0) { console.log('  (no runs)'); return; }
    for (const r of runs) {
      const eval_ = r.eval_score ? (typeof r.eval_score === 'string' ? JSON.parse(r.eval_score) : r.eval_score) : null;
      const badge = eval_?.summary?.badge || '—';
      const badgeIcon = { green: '🟢', yellow: '🟡', red: '🔴', gray: '⚪' }[badge] || '⚪';
      console.log(`  ${badgeIcon} ${r.id.padEnd(34)} ${(r.agent_id || '?').padEnd(12)} ${(r.status || '?').padEnd(10)} ${r.started_at || ''}`);
    }
  } catch (e) { console.error('Error:', e.message); }
}

async function cmdTraceStats() {
  const port = await getRunningPort();
  if (!port) { console.log('❌ Runtime not running. Use: helix start'); return; }
  const hours = parseInt(getFlag('--hours') || '24');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/trace/stats?hours=${hours}`);
    const data = await res.json();
    // API contract (per src/trace-lite.js traceStats): { runs, byStatus, spans, totalTokens, totalCost, hours }
    console.log(`\n📊 Trace Stats (last ${data.hours ?? hours}h)`);
    console.log(`  runs: ${data.runs ?? 0}  spans: ${data.spans ?? 0}  tokens: ${data.totalTokens ?? 0}  cost: $${(Number(data.totalCost) || 0).toFixed(4)}`);
    const bs = data.byStatus || {};
    if (Object.keys(bs).length) {
      const parts = Object.entries(bs).map(([k, v]) => `${k}:${v}`);
      console.log(`  by status: ${parts.join('  ')}`);
    }
  } catch (e) { console.error('Error:', e.message); }
}

async function cmdTraceBackfill() {
  const port = await getRunningPort();
  if (!port) { console.log('❌ Runtime not running. Use: helix start'); return; }
  const limit = parseInt(getFlag('--limit') || '20');
  const auth = loadAuth();
  const token = auth.ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';
  if (!token) { console.log('❌ ADMIN_TOKEN not set. Run: helix login --provider admin --api-key <token>'); return; }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/trace/eval/backfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ limit }),
    });
    const data = await res.json();
    if (!res.ok) { console.log(`❌ ${data.error || res.status}`); return; }
    console.log(`\n🔄 Trace Eval Backfill`);
    console.log(`  processed: ${data.processed}  version: ${data.eval_version}`);
    for (const r of (data.runs || []).slice(0, 10)) {
      const badge = r.summary?.badge || '?';
      const icon = { green: '🟢', yellow: '🟡', red: '🔴' }[badge] || '⚪';
      console.log(`  ${icon} ${r.run_id}  agent=${r.agent_id || '?'}  avg=${r.summary?.avg_score ?? '?'}`);
    }
  } catch (e) { console.error('Error:', e.message); }
}

// ========== Helper ==========

async function getRunningPort() {
  const config = loadConfig();
  const port = config?.server?.port || 18860;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (res.ok) return port;
  } catch {}
  return null;
}

// ========== CLI Router ==========

const cmd = process.argv[2];
const subcmd = process.argv[3];

switch (cmd) {
  case 'init': await cmdInit(); break;
  case 'login': await cmdLogin(); break;
  case 'doctor': await cmdDoctor(); break;
  case 'status': await cmdStatus(); break;
  case 'start': await cmdStart(); break;
  case 'agent':
    if (subcmd === 'list') await cmdAgentList();
    else if (subcmd === 'chat') await cmdAgentChat();
    else console.log('Usage: helix agent <list|chat [agent_id]>');
    break;
  case 'repl':
    await cmdAgentChat();
    break;
  case 'memory':
    if (subcmd === 'stats') await cmdMemoryStats();
    else if (subcmd === 'recall') await cmdMemoryRecall();
    else console.log('Usage: helix memory <stats [agent_id]|recall <agent_id> <query>>');
    break;
  case 'gateway':
    if (subcmd === 'status') await cmdGatewayStatus();
    else console.log('Usage: helix gateway status');
    break;
  case 'eval':
    if (subcmd === 'run') await cmdEvalRun();
    else if (subcmd === 'history') await cmdEvalHistory();
    else console.log('Usage: helix eval <run [suite]|history>');
    break;
  case 'trace':
    if (subcmd === 'runs') await cmdTraceRuns();
    else if (subcmd === 'stats') await cmdTraceStats();
    else if (subcmd === 'backfill') await cmdTraceBackfill();
    else console.log('Usage: helix trace <runs [--limit N]|stats [--hours N]|backfill [--limit N]>');
    break;
  case 'export': await cmdExport(); break;
  case 'import': await cmdImport(); break;
  case '-v': case '--version': console.log(`helix v${VERSION}`); break;
  default:
    console.log(`
Helix Agent Framework v${VERSION}

Commands:
  helix init             初始化專案（建立 config + scaffold）
  helix login            設定 API key
  helix doctor           檢查環境是否就緒
  helix start            啟動 agent runtime
  helix status           查看 runtime 狀態
  helix agent list       列出所有 agent
  helix agent chat [id]  與 agent 對話（互動模式）
  helix repl [id]        直接進入 chat REPL（agent chat alias）
  helix memory stats [id] 查看 agent 長期記憶統計
  helix memory recall     搜尋 agent 記憶
  helix gateway status    查看通訊平台連線狀態
  helix eval run [suite]  執行評估 (command-safety|prompt-injection|memory-recall)
  helix eval history      查看評估歷史
  helix trace runs [--limit N]   列最近 trace runs（含 eval badge）
  helix trace stats [--hours N]  trace 統計（runs/spans/tokens/cost/by-status，預設 24h）
  helix trace backfill [--limit N]  觸發 eval 補跑（需 ADMIN_TOKEN）
  helix export           匯出工作區資料 (JSON)
  helix import <file>    匯入工作區資料
  helix -v               顯示版本
`);
}
