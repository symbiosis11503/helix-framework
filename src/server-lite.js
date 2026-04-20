/**
 * Helix Server Lite — standalone agent runtime for local/SQLite mode
 * Used by `helix start` when database.type = 'sqlite'
 *
 * Provides minimal API surface:
 * - /api/health
 * - /api/readiness
 * - /api/tasks (CRUD)
 * - /api/agents/instances (spawn/list/chat)
 * - /api/memory (remember/recall)
 * - /api/workflows (list/execute)
 * - /v2/ dashboard (static files)
 */

import express from 'express';
import { createServer } from 'http';
import { initDb, query } from './db.js';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read version from package.json at module load so /api/health and startup banner
// never drift from the published tarball.
let PKG_VERSION = 'unknown';
try {
  const pkgPath = join(__dirname, '..', 'package.json');
  if (existsSync(pkgPath)) {
    PKG_VERSION = JSON.parse(readFileSync(pkgPath, 'utf8')).version || 'unknown';
  }
} catch { /* leave as unknown */ }

export async function startLiteServer(config = {}) {
  const port = config.server?.port || 18860;
  const host = config.server?.host || '127.0.0.1';
  const startTime = Date.now();

  // Init database
  await initDb(config);

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // Static files
  const staticDir = join(__dirname, '..', 'static');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
  }
  const sharedDir = join(__dirname, '..', 'static', '_shared');
  if (existsSync(sharedDir)) {
    app.use('/_shared', express.static(sharedDir));
  }

  // ========== Health ==========
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: PKG_VERSION, mode: 'lite', uptime: (Date.now() - startTime) / 1000 });
  });

  app.get('/api/readiness', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true, checks: { db: { status: 'ok' } } });
    } catch (e) {
      res.json({ ok: false, checks: { db: { status: 'error', error: e.message } } });
    }
  });

  // ========== Tasks ==========
  app.get('/api/tasks', async (req, res) => {
    try {
      const { status, owner, limit = 50 } = req.query;
      let sql = 'SELECT * FROM tasks';
      const params = [];
      const conds = [];
      if (status) { params.push(status); conds.push(`status = $${params.length}`); }
      if (owner) { params.push(owner); conds.push(`owner = $${params.length}`); }
      if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
      params.push(parseInt(limit) || 50);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const r = await query(sql, params);
      res.json({ ok: true, tasks: r.rows, count: r.rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/tasks', async (req, res) => {
    try {
      const { title, description, owner, priority = 'normal' } = req.body || {};
      if (!title) return res.status(400).json({ error: 'title required' });
      const r = await query(
        'INSERT INTO tasks (title, description, owner, priority) VALUES ($1, $2, $3, $4)',
        [title, description || '', owner || 'unassigned', priority]
      );
      res.json({ ok: true, id: r.rows[0]?.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Agents ==========
  app.get('/api/agents/instances', async (req, res) => {
    try {
      const r = await query('SELECT * FROM agent_instances ORDER BY created_at DESC LIMIT $1', [parseInt(req.query.limit) || 50]);
      res.json({ ok: true, agents: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/agents/spawn', async (req, res) => {
    try {
      const { role_id = 'assistant', name, task, system_prompt = '' } = req.body || {};
      const id = `agi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const model = config.model || 'gemini-2.5-flash';
      await query(
        'INSERT INTO agent_instances (id, role_id, name, model, system_prompt, task, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, role_id, name || role_id, model, system_prompt, task || null, 'active']
      );
      res.json({ ok: true, id, role_id, model, status: 'active' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Agent Chat (with session continuity) ==========
  const _agentSessions = new Map(); // agentId → sessionId (active session tracking)

  app.post('/api/agent/chat', async (req, res) => {
    try {
      const { agent, agent_id, message, session_id } = req.body || {};
      const agentId = agent || agent_id;
      if (!agentId || !message) return res.status(400).json({ error: 'agent and message required' });

      // Look up agent
      const r = await query('SELECT id, model, system_prompt, key_env FROM agent_instances WHERE id = $1', [agentId]);
      const inst = r.rows[0];
      if (!inst) return res.status(404).json({ error: 'agent not found' });

      const llm = await import('./llm-provider.js');
      const ss = await import('./session-store.js');
      const model = inst.model || config.model || 'gemini-2.5-flash';
      const provider = llm.detectProvider(model);
      const keyEnv = inst.key_env || config.apiKeyEnv || llm.detectKeyEnv(provider);
      const apiKey = process.env[keyEnv];
      if (!apiKey) return res.json({ ok: false, reply: `[no API key: ${keyEnv}]` });

      const systemPrompt = inst.system_prompt || 'You are a helpful AI assistant.';

      // Get or create session
      let sessId = session_id || _agentSessions.get(agentId);
      if (!sessId) {
        const sess = await ss.createSession({ agentId, systemPrompt });
        sessId = sess.id;
        _agentSessions.set(agentId, sessId);
      }

      // Persist user message
      await ss.appendMessage({ sessionId: sessId, role: 'user', content: message });

      // Build context from session history
      const ctx = await ss.buildSessionContext(sessId, { maxTokens: 6000 });

      // Inject long-term memory context if available
      let memoryContext = '';
      try {
        const mm = await import('./memory-manager.js');
        await mm.initMemoryTables();
        const memCtx = await mm.buildMemoryContext(agentId, message, { maxTokens: 2000 });
        if (memCtx.text) memoryContext = `\n\n${memCtx.text}`;
      } catch {}

      const contextMessage = ctx.text
        ? `[對話歷史]\n${ctx.text}${memoryContext}\n\n[目前問題]\n${message}`
        : memoryContext ? `${memoryContext}\n\n${message}` : message;

      try {
        const result = await llm.chat({ model, apiKey, systemPrompt, message: contextMessage });

        // Persist assistant response
        await ss.appendMessage({ sessionId: sessId, role: 'assistant', content: result.reply });

        // Auto-compress if session too large (>30K tokens)
        const sess = await ss.getSession(sessId);
        if (sess && sess.total_tokens > 30000) {
          // Extract memories before compression (so we don't lose important facts)
          try {
            const mm = await import('./memory-manager.js');
            await mm.extractFromSession(agentId, sessId);
          } catch {}

          const summarizer = ss.createLLMSummarizer({ apiKey, model });
          const compressed = await ss.compressSession(sessId, summarizer, { pruneToolOutput: true });
          if (compressed.compressed) {
            sessId = compressed.newSessionId;
            _agentSessions.set(agentId, sessId);
          }
        }

        res.json({
          ok: true, reply: result.reply, model, provider: result.provider,
          agent: agentId, session_id: sessId, usage: result.usage,
        });
      } catch (llmErr) {
        await ss.appendMessage({ sessionId: sessId, role: 'assistant', content: `[error] ${llmErr.message}`, metadata: { error: true } });
        return res.status(502).json({ ok: false, error: llmErr.message, model, provider, session_id: sessId });
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Reset agent session (start fresh)
  app.post('/api/agent/reset-session', async (req, res) => {
    try {
      const { agent, agent_id } = req.body || {};
      const agentId = agent || agent_id;
      if (!agentId) return res.status(400).json({ error: 'agent required' });
      _agentSessions.delete(agentId);
      res.json({ ok: true, message: 'session reset, next chat will start fresh' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Memory ==========
  app.post('/api/memory/remember', async (req, res) => {
    try {
      const { cc_id, category = 'observation', title, content, importance = 5 } = req.body || {};
      if (!cc_id || !content) return res.status(400).json({ error: 'cc_id and content required' });
      await query(
        'INSERT INTO personal_memory (cc_id, category, title, content, importance) VALUES ($1, $2, $3, $4, $5)',
        [cc_id, category, title || null, content, importance]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/memory/recall', async (req, res) => {
    try {
      const { cc_id, query: q, limit = 10 } = req.body || {};
      if (!cc_id) return res.status(400).json({ error: 'cc_id required' });
      let sql = 'SELECT * FROM personal_memory WHERE cc_id = $1 AND status = $2';
      const params = [cc_id, 'active'];
      if (q) {
        params.push(`%${q}%`);
        sql += ` AND (content LIKE $${params.length} OR title LIKE $${params.length})`;
      }
      params.push(parseInt(limit) || 10);
      sql += ` ORDER BY importance DESC, created_at DESC LIMIT $${params.length}`;
      const r = await query(sql, params);
      res.json({ ok: true, results: r.rows, count: r.rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Workflows ==========
  app.get('/api/workflows', async (_req, res) => {
    try {
      const r = await query('SELECT * FROM workflows ORDER BY updated_at DESC');
      res.json({ ok: true, workflows: r.rows, total: r.rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Sessions (Context OS) ==========
  app.get('/api/sessions', async (req, res) => {
    try {
      const { agent_id, status, limit = 20 } = req.query;
      if (!agent_id) return res.status(400).json({ error: 'agent_id required' });
      const sessionStore = await import('./session-store.js');
      const sessions = await sessionStore.listSessions(agent_id, { limit: parseInt(limit) || 20, status: status || null });
      res.json({ ok: true, sessions, count: sessions.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sessions', async (req, res) => {
    try {
      const { agent_id, parent_session_id, system_prompt, metadata } = req.body || {};
      if (!agent_id) return res.status(400).json({ error: 'agent_id required' });
      const sessionStore = await import('./session-store.js');
      const session = await sessionStore.createSession({ agentId: agent_id, parentSessionId: parent_session_id, systemPrompt: system_prompt, metadata });
      res.json({ ok: true, ...session });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/sessions/:id/messages', async (req, res) => {
    try {
      const sessionStore = await import('./session-store.js');
      const messages = await sessionStore.getMessages(req.params.id, { limit: parseInt(req.query.limit) || 500 });
      res.json({ ok: true, messages, count: messages.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sessions/:id/messages', async (req, res) => {
    try {
      const { role, content, tool_call_id, tool_name, metadata } = req.body || {};
      if (!role || !content) return res.status(400).json({ error: 'role and content required' });
      const sessionStore = await import('./session-store.js');
      const msg = await sessionStore.appendMessage({ sessionId: req.params.id, role, content, toolCallId: tool_call_id, toolName: tool_name, metadata });
      res.json({ ok: true, ...msg });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sessions/:id/context', async (req, res) => {
    try {
      const { max_tokens = 12000 } = req.body || {};
      const sessionStore = await import('./session-store.js');
      const ctx = await sessionStore.buildSessionContext(req.params.id, { maxTokens: max_tokens });
      res.json({ ok: true, ...ctx });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sessions/:id/compress', async (req, res) => {
    try {
      const { head_count = 2, tail_count = 4, prune_tool_output = true, use_llm = true } = req.body || {};
      const sessionStore = await import('./session-store.js');
      const summarizer = use_llm ? sessionStore.createLLMSummarizer() : async (msgs) => msgs.map(m => `[${m.role}] ${(m.content || '').slice(0, 150)}`).join('\n');
      const result = await sessionStore.compressSession(req.params.id, summarizer, {
        headCount: head_count,
        tailCount: tail_count,
        pruneToolOutput: prune_tool_output,
      });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sessions/search', async (req, res) => {
    try {
      const { agent_id, query: q, limit = 20, session_id } = req.body || {};
      if (!agent_id || !q) return res.status(400).json({ error: 'agent_id and query required' });
      const sessionStore = await import('./session-store.js');
      const results = await sessionStore.searchMessages(agent_id, q, { limit, sessionId: session_id });
      res.json({ ok: true, results, count: results.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/sessions/:agentId/stats', async (req, res) => {
    try {
      const sessionStore = await import('./session-store.js');
      const stats = await sessionStore.sessionStats(req.params.agentId);
      res.json({ ok: true, ...stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Delegation OS ==========
  app.post('/api/delegation/delegate', async (req, res) => {
    try {
      const { parent_agent_id, task, child_role, allowed_tools, blocked_tools, depth } = req.body || {};
      if (!parent_agent_id || !task) return res.status(400).json({ error: 'parent_agent_id and task required' });
      const delegation = await import('./delegation.js');
      const result = await delegation.delegate({
        parentAgentId: parent_agent_id,
        task,
        childRole: child_role,
        allowedTools: allowed_tools,
        blockedTools: blocked_tools || [],
        depth: depth || 0,
      });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/delegation/batch', async (req, res) => {
    try {
      const { parent_agent_id, tasks, depth } = req.body || {};
      if (!parent_agent_id || !tasks || !Array.isArray(tasks)) return res.status(400).json({ error: 'parent_agent_id and tasks[] required' });
      const delegation = await import('./delegation.js');
      const results = await delegation.delegateBatch({
        parentAgentId: parent_agent_id,
        tasks,
        depth: depth || 0,
      });
      res.json({ ok: true, results, count: results.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/delegation/status', async (_req, res) => {
    try {
      const delegation = await import('./delegation.js');
      res.json({ ok: true, ...delegation.getDelegationStatus() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Command Safety ==========
  app.post('/api/safety/inspect-command', async (req, res) => {
    try {
      const { command } = req.body || {};
      if (!command) return res.status(400).json({ error: 'command required' });
      const safety = await import('./command-safety.js');
      res.json({ ok: true, ...safety.inspectCommand(command) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/safety/patterns', async (_req, res) => {
    try {
      const safety = await import('./command-safety.js');
      res.json({ ok: true, patterns: safety.getPatterns(), count: safety.getPatterns().length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Tool Registry ==========
  app.get('/api/tools', async (_req, res) => {
    try {
      const registry = await import('./tool-registry.js');
      res.json({ ok: true, ...registry.snapshot() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/tools/manifest', async (req, res) => {
    try {
      const registry = await import('./tool-registry.js');
      const format = req.query.format || 'list';
      const roleId = req.query.role_id || null;
      res.json({ ok: true, tools: registry.getManifest({ roleId, format }), count: registry.count() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/tools/execute', async (req, res) => {
    try {
      const { tool, args, agent_id, role_id } = req.body || {};
      if (!tool) return res.status(400).json({ error: 'tool required' });
      const registry = await import('./tool-registry.js');
      const result = await registry.execute(tool, args || {}, { agentId: agent_id || 'api', roleId: role_id });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== MCP Client ==========
  app.get('/api/mcp/servers', async (_req, res) => {
    try {
      const mcp = await import('./mcp-client.js');
      res.json({ ok: true, ...mcp.serverStatus() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/mcp/connect', async (req, res) => {
    try {
      const { name, command, args, env, timeout } = req.body || {};
      if (!name || !command) return res.status(400).json({ error: 'name and command required' });
      const mcp = await import('./mcp-client.js');
      const result = await mcp.connectServer(name, { command, args, env, timeout });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/mcp/disconnect', async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name required' });
      const mcp = await import('./mcp-client.js');
      res.json(mcp.disconnectServer(name));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/mcp/tools', async (_req, res) => {
    try {
      const mcp = await import('./mcp-client.js');
      const tools = mcp.listAllTools();
      res.json({ ok: true, tools, count: tools.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/mcp/call', async (req, res) => {
    try {
      const { server, tool, args } = req.body || {};
      if (!server || !tool) return res.status(400).json({ error: 'server and tool required' });

      // Run through hooks
      const hooks = await import('./hooks.js');
      const hookResult = await hooks.runBeforeHooks('tool.before', {
        toolName: `mcp:${server}:${tool}`,
        args: args || {},
        agentId: req.body.agent_id || 'api',
      });
      if (!hookResult.allowed) {
        return res.status(403).json({ ok: false, error: hookResult.reason });
      }

      const mcp = await import('./mcp-client.js');
      const result = await mcp.callTool(server, tool, args || {});
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Edit Tool ==========
  app.post('/api/files/read', async (req, res) => {
    try {
      const { path: filePath, offset = 0, limit = 200 } = req.body || {};
      if (!filePath) return res.status(400).json({ error: 'path required' });
      const editTool = await import('./edit-tool.js');
      res.json(editTool.readFile(filePath, { offset, limit }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/files/edit', async (req, res) => {
    try {
      const { path: filePath, old_string, new_string, replace_all = false, dry_run = false } = req.body || {};
      if (!filePath || old_string === undefined || new_string === undefined) {
        return res.status(400).json({ error: 'path, old_string, and new_string required' });
      }
      const editTool = await import('./edit-tool.js');

      // Run through hooks before editing
      const hooks = await import('./hooks.js');
      const hookResult = await hooks.runBeforeHooks('tool.before', {
        toolName: 'code_edit',
        args: { filePath, old_string, new_string, replace_all },
        agentId: req.body.agent_id || 'api',
      });
      if (!hookResult.allowed) {
        return res.status(403).json({ ok: false, error: hookResult.reason, blocked_by: hookResult.hookId });
      }

      const result = editTool.editFile({
        filePath,
        oldString: old_string,
        newString: new_string,
        replaceAll: replace_all,
        dryRun: dry_run,
      });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Hooks ==========
  app.get('/api/hooks', async (_req, res) => {
    try {
      const hooks = await import('./hooks.js');
      res.json({ ok: true, hooks: hooks.listHooks(), ...hooks.hookCount() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/hooks/register', async (req, res) => {
    try {
      const { event, id, priority } = req.body || {};
      if (!event) return res.status(400).json({ error: 'event required' });
      // Only allow built-in hook registration via API
      const hooks = await import('./hooks.js');
      if (event === 'builtin-command-safety') {
        const hookId = hooks.registerCommandSafetyHook();
        return res.json({ ok: true, hookId, event: 'tool.before' });
      }
      if (event === 'builtin-injection-defense') {
        const hookId = hooks.registerInjectionDefenseHook();
        return res.json({ ok: true, hookId, event: 'tool.before' });
      }
      res.status(400).json({ error: 'Only built-in hooks can be registered via API. Use registerHook() in code.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Register built-in hooks at startup
  try {
    const hooks = await import('./hooks.js');
    hooks.registerCommandSafetyHook();
    hooks.registerInjectionDefenseHook();
    console.log('[helix-lite] Built-in hooks registered (command-safety, injection-defense)');
  } catch (e) {
    console.warn('[helix-lite] Hook registration failed:', e.message);
  }

  // Auto-discover skills from data/skills/ directory
  try {
    const sk = await import('./skills.js');
    const skills = sk.listSkills();
    if (skills.length > 0) {
      console.log(`[helix-lite] Skills discovered: ${skills.length} (${skills.map(s => s.name).join(', ')})`);
    }
  } catch (e) {
    // Skills directory is optional
  }

  // ========== Knowledge Governance ==========
  app.post('/api/knowledge/atoms', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      await k.initKnowledgeTables();
      const result = await k.createAtom(req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/knowledge/atoms', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      await k.initKnowledgeTables();
      const atoms = await k.listAtoms(req.query.agent_id || 'default', { topic: req.query.topic, status: req.query.status, limit: parseInt(req.query.limit || '50') });
      res.json({ ok: true, atoms });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/knowledge/atoms/:id/review', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      const result = await k.reviewAtom(req.params.id, req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/knowledge/atoms/:id/promote', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      const result = await k.promoteAtom(req.params.id);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/knowledge/search', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      const results = await k.searchAtoms(req.body.agent_id || 'default', req.body.query);
      res.json({ ok: true, atoms: results });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/knowledge/topics', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      await k.initKnowledgeTables();
      const topics = await k.listTopics(req.query.agent_id || 'default');
      res.json({ ok: true, topics });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/knowledge/lint', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      const result = await k.lintDeterministic(req.body.agent_id || 'default');
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/knowledge/compile', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      const result = await k.compile(req.body.agent_id || 'default', req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/knowledge/stats', async (req, res) => {
    try {
      const k = await import('./knowledge.js');
      await k.initKnowledgeTables();
      const stats = await k.knowledgeStats(req.query.agent_id || 'default');
      res.json({ ok: true, ...stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Workflow Engine ==========
  app.post('/api/workflow-defs', async (req, res) => {
    try {
      const wf = await import('./workflow.js');
      await wf.initWorkflowTables();
      const result = await wf.createWorkflow(req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/workflow-defs', async (req, res) => {
    try {
      const wf = await import('./workflow.js');
      await wf.initWorkflowTables();
      const list = await wf.listWorkflows({ agentId: req.query.agent_id, limit: parseInt(req.query.limit || '50') });
      res.json({ ok: true, workflows: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/workflow-defs/:id', async (req, res) => {
    try {
      const wf = await import('./workflow.js');
      const w = await wf.getWorkflow(req.params.id);
      if (!w) return res.status(404).json({ error: 'workflow not found' });
      res.json({ ok: true, ...w });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/workflow-defs/:id', async (req, res) => {
    try {
      const wf = await import('./workflow.js');
      const result = await wf.deleteWorkflow(req.params.id);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/workflow-defs/:id/run', async (req, res) => {
    try {
      const wf = await import('./workflow.js');
      const result = await wf.executeWorkflow(req.params.id, { agentId: req.body.agent_id });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/workflow-defs/:id/runs', async (req, res) => {
    try {
      const wf = await import('./workflow.js');
      const runs = await wf.listWorkflowRuns(req.params.id);
      res.json({ ok: true, runs });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== 2FA ==========
  app.post('/api/auth/2fa/setup', async (req, res) => {
    try {
      const tfa = await import('./two-factor.js');
      await tfa.initTwoFactorTables();
      const result = await tfa.setup(req.body.user_id, req.body.account_name);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/2fa/verify-setup', async (req, res) => {
    try {
      const tfa = await import('./two-factor.js');
      const result = await tfa.verifySetup(req.body.user_id, req.body.code);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/2fa/verify', async (req, res) => {
    try {
      const tfa = await import('./two-factor.js');
      const result = await tfa.verify(req.body.user_id, req.body.code);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/auth/2fa/status/:userId', async (req, res) => {
    try {
      const tfa = await import('./two-factor.js');
      await tfa.initTwoFactorTables();
      const status = await tfa.getStatus(req.params.userId);
      res.json({ ok: true, ...status });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/2fa/disable', async (req, res) => {
    try {
      const tfa = await import('./two-factor.js');
      const result = await tfa.disable(req.body.user_id);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/2fa/backup-codes', async (req, res) => {
    try {
      const tfa = await import('./two-factor.js');
      const result = await tfa.regenerateBackupCodes(req.body.user_id);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== OAuth 2.0 ==========
  app.post('/api/oauth/providers', async (req, res) => {
    try {
      const oa = await import('./oauth.js');
      await oa.initOAuthTables();
      const result = await oa.registerProvider(req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/oauth/providers', async (_req, res) => {
    try {
      const oa = await import('./oauth.js');
      await oa.initOAuthTables();
      const providers = await oa.listProviders();
      res.json({ ok: true, providers });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/oauth/authorize/:providerId', async (req, res) => {
    try {
      const oa = await import('./oauth.js');
      const result = await oa.getAuthorizationUrl(req.params.providerId, { scopes: req.query.scopes });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/oauth/callback', async (req, res) => {
    try {
      const oa = await import('./oauth.js');
      const { provider_id, code, redirect_uri, agent_id } = req.body;
      const result = await oa.exchangeCode(provider_id, { code, redirectUri: redirect_uri, agentId: agent_id });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/oauth/token', async (req, res) => {
    try {
      const oa = await import('./oauth.js');
      const { provider_id, agent_id } = req.body;
      const token = await oa.getAccessToken(provider_id, { agentId: agent_id });
      res.json({ ok: true, access_token: token ? '***' : null, available: !!token });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/oauth/tokens/:providerId', async (req, res) => {
    try {
      const oa = await import('./oauth.js');
      const tokens = await oa.listTokens(req.params.providerId);
      res.json({ ok: true, tokens });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Auth / RBAC ==========
  app.post('/api/auth/keys', async (req, res) => {
    try {
      const au = await import('./auth.js');
      await au.initAuthTables();
      const result = await au.createApiKey(req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/auth/keys', async (_req, res) => {
    try {
      const au = await import('./auth.js');
      await au.initAuthTables();
      const keys = await au.listKeys();
      res.json({ ok: true, keys });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/keys/:id/revoke', async (req, res) => {
    try {
      const au = await import('./auth.js');
      const result = await au.revokeKey(req.params.id);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/validate', async (req, res) => {
    try {
      const au = await import('./auth.js');
      const result = await au.validateKey(req.body.key);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Trace / Observability ==========
  app.get('/api/trace/runs', async (req, res) => {
    try {
      const tr = await import('./trace-lite.js');
      await tr.initTraceTables();
      const runs = await tr.listRuns({ agentId: req.query.agent_id, limit: parseInt(req.query.limit || '50'), status: req.query.status });
      res.json({ ok: true, runs });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/trace/runs/:runId', async (req, res) => {
    try {
      const tr = await import('./trace-lite.js');
      const run = await tr.getRun(req.params.runId);
      if (!run) return res.status(404).json({ error: 'run not found' });
      res.json({ ok: true, ...run });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/trace/stats', async (req, res) => {
    try {
      const tr = await import('./trace-lite.js');
      await tr.initTraceTables();
      const stats = await tr.traceStats({ agentId: req.query.agent_id, hours: parseInt(req.query.hours || '24') });
      res.json({ ok: true, ...stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // D1 Phase 2: ad-hoc backfill — re-score N completed runs without eval_score
  // Per spec docs/reports/14_*; admin-only.
  app.post('/api/admin/trace/eval/backfill', async (req, res) => {
    // Fail-closed: same policy as A 線 admin-api.js (P0 fix 2026-04-20).
    // No token configured anywhere → only allow loopback / Tailscale / private LAN.
    const expected = process.env.ADMIN_TOKEN || process.env.SBS_ADMIN_TOKEN;
    if (expected) {
      const authHdr = req.headers['authorization'] || '';
      const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';
      const got = req.headers['x-admin-token'] || bearer;
      if (got !== expected) return res.status(401).json({ error: 'admin token required (Authorization: Bearer ... or X-Admin-Token: ...)' });
    } else {
      const ip = (req.ip || req.connection?.remoteAddress || '').replace('::ffff:', '');
      const isLocal = ip === '127.0.0.1' || ip === '::1' || /^100\./.test(ip) || /^192\.168\./.test(ip) || /^10\./.test(ip);
      if (!isLocal) return res.status(401).json({ error: 'admin token not configured; remote requests denied (set ADMIN_TOKEN to enable)' });
    }
    try {
      const { backfillBatch } = await import('../scripts/nightly-trace-eval-backfill.mjs');
      const limit = parseInt(req.body?.limit || req.query?.limit || '20', 10);
      const evalVersion = req.body?.version || req.query?.version || `eval-lite@${new Date().toISOString().slice(0,10)}`;
      const tr = await import('./trace-lite.js');
      await tr.initTraceTables();
      const ev = await import('./eval-lite.js');
      await ev.initEvalTables();
      const processed = await backfillBatch({ limit, evalVersion });
      res.json({ ok: true, limit, eval_version: evalVersion, processed: processed.length, runs: processed });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // D1: attach eval score to a completed run (per spec docs/reports/14_*)
  // Admin-only — only callable from internal eval pipeline / nightly cron
  app.post('/api/trace/runs/:runId/eval', async (req, res) => {
    // Reuse same auth pattern as other admin endpoints (Bearer or X-Admin-Token)
    // Fail-closed: same policy as A 線 admin-api.js (P0 fix 2026-04-20).
    // No token configured anywhere → only allow loopback / Tailscale / private LAN.
    const expected = process.env.ADMIN_TOKEN || process.env.SBS_ADMIN_TOKEN;
    if (expected) {
      const authHdr = req.headers['authorization'] || '';
      const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';
      const got = req.headers['x-admin-token'] || bearer;
      if (got !== expected) return res.status(401).json({ error: 'admin token required (Authorization: Bearer ... or X-Admin-Token: ...)' });
    } else {
      const ip = (req.ip || req.connection?.remoteAddress || '').replace('::ffff:', '');
      const isLocal = ip === '127.0.0.1' || ip === '::1' || /^100\./.test(ip) || /^192\.168\./.test(ip) || /^10\./.test(ip);
      if (!isLocal) return res.status(401).json({ error: 'admin token not configured; remote requests denied (set ADMIN_TOKEN to enable)' });
    }
    try {
      const tr = await import('./trace-lite.js');
      await tr.initTraceTables();
      const { score, version } = req.body || {};
      if (!score || typeof score !== 'object') return res.status(400).json({ error: 'score (object) required' });
      const result = await tr.attachEvalScore(req.params.runId, score, version || `eval-lite@${new Date().toISOString().slice(0,10)}`);
      if (!result) return res.status(404).json({ error: 'run not found' });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Alerts ==========
  app.post('/api/alerts/rules', async (req, res) => {
    try {
      const al = await import('./alerts.js');
      await al.initAlertTables();
      const result = await al.createRule(req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/alerts/rules', async (_req, res) => {
    try {
      const al = await import('./alerts.js');
      await al.initAlertTables();
      const rules = await al.listRules();
      res.json({ ok: true, rules });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/alerts/evaluate', async (req, res) => {
    try {
      const al = await import('./alerts.js');
      const result = await al.evaluateRules(req.body.metrics || {});
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/alerts/history', async (req, res) => {
    try {
      const al = await import('./alerts.js');
      await al.initAlertTables();
      const history = await al.getHistory({ limit: parseInt(req.query.limit || '50') });
      res.json({ ok: true, history });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== LLM Providers ==========
  app.get('/api/llm/providers', async (_req, res) => {
    try {
      const llm = await import('./llm-provider.js');
      const providers = llm.listProviders().map(p => ({
        ...p,
        configured: p.keyEnv ? !!process.env[p.keyEnv] : true,
      }));
      res.json({ ok: true, providers });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Streaming Chat ==========
  app.post('/api/agent/chat/stream', async (req, res) => {
    try {
      const { agent, agent_id, message, model: reqModel } = req.body || {};
      const agentId = agent || agent_id || 'default';
      if (!message) return res.status(400).json({ error: 'message required' });

      const llm = await import('./llm-provider.js');
      const m = reqModel || config.model || 'gemini-2.5-flash';
      const provider = llm.detectProvider(m);
      const keyEnv = config.apiKeyEnv || llm.detectKeyEnv(provider);
      const apiKey = process.env[keyEnv];
      if (!apiKey && provider !== 'local') return res.status(400).json({ error: `No API key: ${keyEnv}` });

      // SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const result = await llm.chatStream({
        model: m, apiKey,
        systemPrompt: req.body.system_prompt || 'You are a helpful AI assistant.',
        message,
        onChunk: (chunk) => {
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        },
      });

      res.write(`data: ${JSON.stringify({ done: true, reply: result.reply, model: m, provider })}\n\n`);
      res.end();
    } catch (e) {
      if (!res.headersSent) {
        res.status(500).json({ error: e.message });
      } else {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      }
    }
  });

  // ========== Agent Reasoning ==========
  app.post('/api/agent/reason', async (req, res) => {
    try {
      const { agent_id, task, model, system_prompt, max_iterations } = req.body || {};
      if (!task) return res.status(400).json({ error: 'task required' });

      const agentId = agent_id || 'default';
      const llmMod = await import('./llm-provider.js');
      const m = model || config.model || 'gemini-2.5-flash';
      const provider = llmMod.detectProvider(m);
      const keyEnv = config.apiKeyEnv || llmMod.detectKeyEnv(provider);
      const apiKey = process.env[keyEnv];
      if (!apiKey) return res.json({ ok: false, error: `No API key: ${keyEnv}` });

      const ar = await import('./agent-reasoning.js');
      const result = await ar.reason({
        task,
        agentId,
        llm: { model: m, apiKey },
        systemPrompt: system_prompt,
        maxIterations: max_iterations || 10,
      });

      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Skills ==========
  app.get('/api/skills/categories', async (_req, res) => {
    try {
      const sk = await import('./skills.js');
      res.json({ ok: true, categories: sk.listCategories() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/skills', async (req, res) => {
    try {
      const sk = await import('./skills.js');
      const skills = sk.listSkills(req.query);
      res.json({ ok: true, count: skills.length, skills });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/skills/:slug', async (req, res) => {
    try {
      const sk = await import('./skills.js');
      const skill = sk.getSkill(req.params.slug);
      if (!skill) return res.status(404).json({ error: 'skill not found' });
      res.json({ ok: true, ...skill });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/skills/:slug/invoke', async (req, res) => {
    try {
      const sk = await import('./skills.js');
      const prompt = sk.buildSkillInvocation(req.params.slug, req.body?.instruction);
      if (!prompt) return res.status(404).json({ error: 'skill not found' });
      res.json({ ok: true, prompt });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Gateway (Messaging Platform Integration) ==========
  app.post('/api/gateway/telegram', async (req, res) => {
    try {
      const gw = await import('./gateway-adapter.js');
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' });

      const adapter = gw.createTelegramAdapter(botToken);
      const message = adapter.parseWebhook(req.body);
      if (!message) return res.json({ ok: true }); // Non-message update

      const result = await gw.processMessage('telegram', message, {
        model: config.model,
        systemPrompt: config.agents?.[0]?.systemPrompt,
      });

      if (result.ok && result.reply) {
        await adapter.sendMessage(message.chatId, result.reply);
      }

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/gateway/discord', async (req, res) => {
    try {
      // Discord interaction verification
      if (req.body.type === 1) return res.json({ type: 1 }); // PING/PONG

      const gw = await import('./gateway-adapter.js');
      const botToken = process.env.DISCORD_BOT_TOKEN;
      if (!botToken) return res.json({ ok: false, error: 'DISCORD_BOT_TOKEN not set' });

      const adapter = gw.createDiscordAdapter(botToken);
      const message = adapter.parseWebhook(req.body);
      if (!message || !message.text) return res.json({ ok: true });

      const result = await gw.processMessage('discord', message, {
        model: config.model,
        systemPrompt: config.agents?.[0]?.systemPrompt,
      });

      if (result.ok && result.reply) {
        await adapter.sendMessage(message.chatId, result.reply);
      }

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/gateway/line', async (req, res) => {
    try {
      const gw = await import('./gateway-adapter.js');
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const secret = process.env.LINE_CHANNEL_SECRET;
      if (!token) return res.json({ ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN not set' });
      const adapter = gw.createLINEAdapter(token, secret);
      if (secret) {
        const sig = req.headers['x-line-signature'];
        if (!adapter.validateSignature(JSON.stringify(req.body), sig)) {
          return res.status(403).json({ error: 'invalid signature' });
        }
      }
      const message = adapter.parseWebhook(req.body);
      if (!message) return res.json({ ok: true });
      const result = await gw.processMessage('line', message, {
        model: config.model,
        systemPrompt: config.agents?.[0]?.systemPrompt,
      });
      if (result.ok && result.reply) await adapter.sendMessage(message.chatId, result.reply);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/gateway/slack', async (req, res) => {
    try {
      if (req.body.type === 'url_verification') return res.json({ challenge: req.body.challenge });
      const gw = await import('./gateway-adapter.js');
      const botToken = process.env.SLACK_BOT_TOKEN;
      if (!botToken) return res.json({ ok: false, error: 'SLACK_BOT_TOKEN not set' });
      const adapter = gw.createSlackAdapter(botToken);
      const message = adapter.parseWebhook(req.body);
      if (!message) return res.json({ ok: true });
      const result = await gw.processMessage('slack', message, {
        model: config.model,
        systemPrompt: config.agents?.[0]?.systemPrompt,
      });
      if (result.ok && result.reply) await adapter.sendMessage(message.chatId, result.reply);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Generic webhook for any platform
  app.post('/api/gateway/webhook', async (req, res) => {
    try {
      const { platform, user_id, chat_id, text, model } = req.body || {};
      if (!platform || !text) return res.status(400).json({ error: 'platform and text required' });

      const gw = await import('./gateway-adapter.js');
      const result = await gw.processMessage(platform, {
        userId: user_id || 'anonymous',
        chatId: chat_id || 'default',
        text,
      }, { model: model || config.model, systemPrompt: config.agents?.[0]?.systemPrompt });

      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/gateway/adapters', async (_req, res) => {
    try {
      const gw = await import('./gateway-adapter.js');
      res.json({
        ok: true,
        adapters: gw.listAdapters(),
        supported: ['telegram', 'discord', 'line', 'slack', 'email', 'webhook'],
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Canonical aliases — /api/gateway/messaging/* → /api/gateway/* (A/B parity)
  // Reuse handlers instead of duplicating code
  ['telegram', 'discord', 'line', 'slack', 'webhook'].forEach(platform => {
    app.post(`/api/gateway/messaging/${platform}`, (req, res, next) => {
      req.url = `/api/gateway/${platform}`;
      app.handle(req, res, next);
    });
  });
  app.get('/api/gateway/messaging/adapters', (req, res, next) => {
    req.url = '/api/gateway/adapters';
    app.handle(req, res, next);
  });

  // ========== Memory Manager (Tiered Long-term Memory) ==========
  app.post('/api/memory/v2/remember', async (req, res) => {
    try {
      const mm = await import('./memory-manager.js');
      await mm.initMemoryTables();
      const result = await mm.remember(req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/memory/v2/recall', async (req, res) => {
    try {
      const mm = await import('./memory-manager.js');
      const { agent_id, query: q, type, limit, min_importance } = req.body;
      const results = await mm.recall(agent_id, q, { type, limit, minImportance: min_importance });
      res.json({ ok: true, memories: results });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/memory/v2/extract', async (req, res) => {
    try {
      const mm = await import('./memory-manager.js');
      await mm.initMemoryTables();
      const { agent_id, session_id } = req.body;
      const result = await mm.extractFromSession(agent_id, session_id);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/memory/v2/stats/:agentId', async (req, res) => {
    try {
      const mm = await import('./memory-manager.js');
      const stats = await mm.memoryStats(req.params.agentId);
      res.json({ ok: true, ...stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/memory/v2/context', async (req, res) => {
    try {
      const mm = await import('./memory-manager.js');
      const { agent_id, query: q, max_tokens, types } = req.body;
      const ctx = await mm.buildMemoryContext(agent_id, q, { maxTokens: max_tokens, types });
      res.json({ ok: true, ...ctx });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/memory/v2/decay', async (req, res) => {
    try {
      const mm = await import('./memory-manager.js');
      const { agent_id, decay_rate } = req.body;
      const result = await mm.decayMemories(agent_id, { decayRate: decay_rate });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Agent Autonomy ==========
  app.post('/api/autonomy/tasks', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      await au.initAutonomyTables();
      const result = await au.createLongTask(req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/autonomy/tasks/:agentId', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const tasks = await au.listLongTasks(req.params.agentId, { status: req.query.status });
      res.json({ ok: true, tasks });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/autonomy/tasks/:taskId/advance', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const result = await au.advanceTask(req.params.taskId, req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/autonomy/tasks/:taskId/pause', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const result = await au.pauseTask(req.params.taskId, req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/autonomy/tasks/:taskId/resume', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const result = await au.resumeTask(req.params.taskId);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/autonomy/tasks/:taskId/progress', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const progress = await au.getTaskProgress(req.params.taskId);
      res.json({ ok: true, ...progress });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/autonomy/optimizations', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      await au.initAutonomyTables();
      const result = await au.suggestOptimization(req.body.agent_id, req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/autonomy/optimizations/:agentId', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const list = await au.listOptimizations(req.params.agentId, { minScore: parseFloat(req.query.min_score || '0') });
      res.json({ ok: true, optimizations: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/autonomy/discovery/rules', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      await au.initAutonomyTables();
      const result = await au.addDiscoveryRule(req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/autonomy/discovery/rules/:agentId', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const rules = await au.listDiscoveryRules(req.params.agentId, { enabledOnly: req.query.enabled === 'true' });
      res.json({ ok: true, rules });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/autonomy/discovery/toggle', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const result = await au.setDiscoveryEnabled(req.body.agent_id, req.body.enabled);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/autonomy/check', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const result = await au.autonomousCheck(req.body.agent_id, req.body);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/autonomy/stats/:agentId', async (req, res) => {
    try {
      const au = await import('./agent-autonomy.js');
      const stats = await au.autonomyStats(req.params.agentId);
      res.json({ ok: true, ...stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Eval / Benchmarks ==========
  app.post('/api/eval/run', async (req, res) => {
    try {
      const ev = await import('./eval-lite.js');
      await ev.initEvalTables();
      const { suite } = req.body || {};
      if (suite === 'command-safety') {
        const result = await ev.evalCommandSafety();
        return res.json({ ok: true, ...result });
      }
      if (suite === 'memory-recall') {
        const result = await ev.evalMemoryRecall(req.body.agent_id);
        return res.json({ ok: true, ...result });
      }
      if (suite === 'prompt-injection') {
        const result = await ev.evalPromptInjection();
        return res.json({ ok: true, ...result });
      }
      res.status(400).json({ error: 'Unknown suite. Available: command-safety, memory-recall, prompt-injection' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/eval/history', async (req, res) => {
    try {
      const ev = await import('./eval-lite.js');
      await ev.initEvalTables();
      const history = await ev.getEvalHistory({ suite: req.query.suite, limit: parseInt(req.query.limit || '20') });
      res.json({ ok: true, history });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/eval/runs/:runId', async (req, res) => {
    try {
      const ev = await import('./eval-lite.js');
      const run = await ev.getEvalRun(req.params.runId);
      if (!run) return res.status(404).json({ error: 'run not found' });
      res.json({ ok: true, ...run });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/eval/regression', async (req, res) => {
    try {
      const ev = await import('./eval-lite.js');
      const { baseline_id, current_id } = req.body || {};
      if (!baseline_id || !current_id) return res.status(400).json({ error: 'baseline_id and current_id required' });
      const result = await ev.checkRegression(baseline_id, current_id);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== Cron ==========
  app.get('/api/cron', async (_req, res) => {
    try {
      const r = await query('SELECT * FROM cron_jobs ORDER BY id');
      res.json({ ok: true, jobs: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ========== API Routes Index ==========
  app.get('/api/routes', (_req, res) => {
    const routes = [];
    app._router?.stack?.forEach(layer => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
        routes.push({ method: methods[0], path: layer.route.path });
      }
    });
    routes.sort((a, b) => a.path.localeCompare(b.path));
    res.json({ ok: true, routes, count: routes.length });
  });

  // ========== Start ==========
  const server = createServer(app);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[helix-lite] ❌ Port ${port} already in use on ${host}.`);
      console.error(`[helix-lite]    Another process is bound to this port. Options:`);
      console.error(`[helix-lite]      1. Pick a different port:  helix start --port 18961`);
      console.error(`[helix-lite]      2. Find the conflicting process:  lsof -i :${port}`);
      console.error(`[helix-lite]      3. Stop the existing helix:  helix status  (then kill its PID)`);
      process.exit(1);
    }
    console.error(`[helix-lite] listen error:`, err.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`[helix-lite] Helix Agent Runtime v${PKG_VERSION} (lite mode)`);
    console.log(`[helix-lite] http://${host}:${port}`);
    console.log(`[helix-lite] Dashboard: http://${host}:${port}/v2/`);
  });

  return { app, server };
}

export default { startLiteServer };
