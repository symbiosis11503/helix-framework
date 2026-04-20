/**
 * Agent Runtime Loop — gives spawned agents a persistent worker loop
 *
 * Each active agent with cron_interval gets:
 * 1. Check A2A inbox for messages
 * 2. Check assigned tasks
 * 3. Execute pending work via LLM
 * 4. Update heartbeat
 * 5. Session persistence (Context OS integration)
 * 6. Sleep until next tick
 */

import * as sessionStore from './session-store.js';

let _activeLoops = new Map(); // agentId → { timer, lastTick, sessionId }

export function startAgentLoop(agentId, intervalMs = 60000) {
  if (_activeLoops.has(agentId)) return { started: false, reason: 'already running' };

  const tick = async () => {
    try {
      const spawn = await import('./agent-spawn.js');
      const pool = spawn.getPool();

      // Check agent still active
      const agent = await pool.query('SELECT id, status, role_id, system_prompt FROM agent_instances WHERE id = $1', [agentId]);
      if (!agent.rows[0] || agent.rows[0].status !== 'active') {
        stopAgentLoop(agentId);
        return;
      }

      // Update heartbeat
      await spawn.agentHeartbeat(agentId);

      // Ensure active session exists (Context OS)
      const loopState = _activeLoops.get(agentId);
      if (!loopState.sessionId) {
        const sess = await sessionStore.createSession({
          agentId,
          systemPrompt: agent.rows[0].system_prompt || null,
          metadata: { loop: true, started: new Date().toISOString() },
        });
        loopState.sessionId = sess.id;
      }

      // Check for assigned tasks
      const tasks = await pool.query(
        `SELECT id, title, description FROM tasks
         WHERE owner = $1 AND status = 'pending'
         ORDER BY (priority='critical') DESC, (priority='high') DESC, created_at ASC
         LIMIT 1`,
        [agentId]
      );

      if (tasks.rows[0]) {
        const task = tasks.rows[0];
        // Mark in progress
        await pool.query("UPDATE tasks SET status='in_progress', started_at=now() WHERE id=$1", [task.id]);

        const prompt = `你有一個待辦任務：\n標題：${task.title}\n描述：${task.description || '(無描述)'}\n\n請執行並回報結果。`;

        // Persist user message to session
        await sessionStore.appendMessage({ sessionId: loopState.sessionId, role: 'user', content: prompt, metadata: { task_id: task.id } });

        // Execute via agent chat
        try {
          const result = await spawn.chat(agentId, prompt);
          const reply = (result.reply || '').slice(0, 2000);

          // Persist assistant response
          await sessionStore.appendMessage({ sessionId: loopState.sessionId, role: 'assistant', content: reply, metadata: { task_id: task.id } });

          await pool.query("UPDATE tasks SET status='done', completed_at=now(), result=$1 WHERE id=$2",
            [JSON.stringify({ reply }), task.id]);
          loopState.lastTaskAt = Date.now();
        } catch (e) {
          await sessionStore.appendMessage({ sessionId: loopState.sessionId, role: 'assistant', content: `[error] ${e.message}`, metadata: { task_id: task.id, error: true } });
          await pool.query("UPDATE tasks SET status='failed', error=$1, completed_at=now() WHERE id=$2",
            [e.message, task.id]);
        }
      }

      // Check A2A inbox
      const a2a = await pool.query(
        `SELECT id, subject, body FROM a2a_messages
         WHERE to_agent_id = $1 AND status = 'sent'
         ORDER BY created_at ASC LIMIT 1`,
        [agentId]
      );

      if (a2a.rows[0]) {
        const msg = a2a.rows[0];
        await pool.query("UPDATE a2a_messages SET status = 'claimed' WHERE id = $1", [msg.id]);

        const prompt = `你收到一則 A2A 訊息：\n主旨：${msg.subject}\n內容：${JSON.stringify(msg.body).slice(0, 500)}\n\n請回覆。`;

        // Persist to session
        await sessionStore.appendMessage({ sessionId: loopState.sessionId, role: 'user', content: prompt, metadata: { a2a_id: msg.id } });

        try {
          const result = await spawn.chat(agentId, prompt);
          const reply = (result.reply || '').slice(0, 1000);

          await sessionStore.appendMessage({ sessionId: loopState.sessionId, role: 'assistant', content: reply, metadata: { a2a_id: msg.id } });

          // Auto-reply via A2A
          const a2aProto = await import('./a2a-protocol.js');
          const svc = a2aProto.createA2AService({ query: pool.query.bind(pool) });
          await svc.reply({ original_message_id: msg.id, from_agent_id: agentId, body: { reply } });

          await pool.query("UPDATE a2a_messages SET status = 'processed' WHERE id = $1", [msg.id]);
        } catch (e) {
          await sessionStore.appendMessage({ sessionId: loopState.sessionId, role: 'assistant', content: `[a2a error] ${e.message}`, metadata: { a2a_id: msg.id, error: true } });
          await pool.query("UPDATE a2a_messages SET status = 'failed' WHERE id = $1", [msg.id]);
        }
      }

      // Check if session needs compression (token budget check)
      try {
        const sess = await sessionStore.getSession(loopState.sessionId);
        if (sess && sess.total_tokens > 50000) {
          // Extract memories before compression
          try {
            const mm = await import('./memory-manager.js');
            await mm.extractFromSession(agentId, loopState.sessionId);
          } catch {}

          // Compress session — use LLM summarizer (falls back to simple if no API key)
          const summarizer = sessionStore.createLLMSummarizer();
          const result = await sessionStore.compressSession(loopState.sessionId, summarizer, { pruneToolOutput: true });
          if (result.compressed) {
            loopState.sessionId = result.newSessionId;
            console.log(`[agent-loop] ${agentId} session compressed → ${result.newSessionId} (pruned ${result.prunedMessages} msgs)`);
          }
        }
      } catch (e) {
        console.warn(`[agent-loop] ${agentId} compression check failed:`, e.message);
      }

      // Autonomy checks — timeout recovery + discovery rules
      try {
        const au = await import('./agent-autonomy.js');
        const idleMs = Date.now() - (loopState.lastTaskAt || loopState.lastTick);
        const idleMinutes = Math.floor(idleMs / 60000);
        const check = await au.autonomousCheck(agentId, { idleMinutes });

        // Handle timed-out long tasks
        for (const t of check.timedOutTasks) {
          console.log(`[agent-loop] ${agentId} long-task ${t.id} timed out → paused`);
        }

        // Log triggered discovery rules (agent decides what to do)
        for (const rule of check.triggeredRules) {
          await au.triggerDiscovery(rule.id);
          console.log(`[agent-loop] ${agentId} discovery triggered: ${rule.name} → ${rule.action}`);
          // Queue as a task suggestion (agent can pick it up next tick)
          await sessionStore.appendMessage({
            sessionId: loopState.sessionId,
            role: 'system',
            content: `[discovery] ${rule.name}: ${rule.action}`,
            metadata: { discovery_rule_id: rule.id, autonomous: true },
          });
        }
      } catch {}

      loopState.lastTick = Date.now();
    } catch (e) {
      console.error(`[agent-loop] ${agentId} tick error:`, e.message);
    }
  };

  const timer = setInterval(tick, intervalMs);
  _activeLoops.set(agentId, { timer, lastTick: Date.now(), intervalMs, sessionId: null });

  // First tick immediately
  tick().catch(() => {});

  console.log(`[agent-loop] started ${agentId} interval=${intervalMs}ms`);
  return { started: true, agentId, intervalMs };
}

export function stopAgentLoop(agentId) {
  const loop = _activeLoops.get(agentId);
  if (!loop) return { stopped: false, reason: 'not running' };
  clearInterval(loop.timer);
  _activeLoops.delete(agentId);
  console.log(`[agent-loop] stopped ${agentId}`);
  return { stopped: true };
}

export function listActiveLoops() {
  const result = [];
  for (const [id, loop] of _activeLoops) {
    result.push({ agentId: id, intervalMs: loop.intervalMs, lastTick: new Date(loop.lastTick).toISOString() });
  }
  return result;
}

export default { startAgentLoop, stopAgentLoop, listActiveLoops };
