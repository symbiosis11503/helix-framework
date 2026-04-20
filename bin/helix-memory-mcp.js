#!/usr/bin/env node
/**
 * Helix Memory MCP Server
 *
 * Exposes Helix memory-manager as an MCP server for Claude Code.
 * Supports: remember, recall, semanticRecall, memoryStats, buildContext
 *
 * Usage in Claude Code settings:
 *   "helix-memory": {
 *     "command": "node",
 *     "args": ["/path/to/helix-framework/bin/helix-memory-mcp.js"],
 *     "env": { "HELIX_DB_PATH": ".helix/helix.db" }
 *   }
 */

import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { initDb } from '../src/db.js';
import * as mm from '../src/memory-manager.js';

const AGENT_ID = process.env.HELIX_AGENT_ID || 'cc1';
const DB_TYPE = process.env.HELIX_DB_TYPE || 'sqlite';
const DB_PATH = process.env.HELIX_DB_PATH || '.helix/helix.db';

// PG via SSH tunnel settings
const SSH_TUNNEL_HOST = process.env.HELIX_SSH_HOST || '';
const SSH_TUNNEL_USER = process.env.HELIX_SSH_USER || 'root';
const SSH_TUNNEL_KEY = process.env.HELIX_SSH_KEY || '';
const PG_LOCAL_PORT = parseInt(process.env.HELIX_PG_LOCAL_PORT || '15432');

let initialized = false;
let tunnelPid = null;

function startSshTunnel() {
  if (!SSH_TUNNEL_HOST) return;
  try {
    // Check if tunnel already exists
    try { execSync(`lsof -ti:${PG_LOCAL_PORT}`, { stdio: 'pipe' }); return; } catch {}
    const keyOpt = SSH_TUNNEL_KEY ? `-i ${SSH_TUNNEL_KEY}` : '';
    execSync(
      `ssh -o IdentitiesOnly=yes ${keyOpt} -o StrictHostKeyChecking=no -o ConnectTimeout=5 -L ${PG_LOCAL_PORT}:localhost:5432 -fN ${SSH_TUNNEL_USER}@${SSH_TUNNEL_HOST}`,
      { stdio: 'pipe' }
    );
    process.stderr.write(`[helix-memory-mcp] SSH tunnel established to ${SSH_TUNNEL_HOST}:5432 via localhost:${PG_LOCAL_PORT}\n`);
  } catch (e) {
    process.stderr.write(`[helix-memory-mcp] SSH tunnel failed: ${e.message}\n`);
  }
}

async function ensureInit() {
  if (initialized) return;

  if (DB_TYPE === 'pg') {
    startSshTunnel();
    await initDb({
      database: {
        type: 'pg',
        pg: {
          host: '127.0.0.1',
          port: PG_LOCAL_PORT,
          user: process.env.PG_USER || 'sbs',
          password: process.env.PG_PASSWORD,
          database: process.env.PG_DB || 'helix',
        },
      },
    });
  } else {
    await initDb({ database: { type: 'sqlite', path: DB_PATH } });
  }

  await mm.initMemoryTables();
  initialized = true;
}

// MCP JSON-RPC handler
const TOOLS = [
  {
    name: 'helix_remember',
    description: 'Store a memory in Helix long-term memory system. Use for project decisions, technical facts, conversation summaries, and anything worth recalling later. Supports episodic/semantic/procedural types with importance scoring.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The memory content to store' },
        summary: { type: 'string', description: 'Short summary (shown in search results)' },
        type: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: 'Memory type: episodic (events/conversations), semantic (facts/knowledge), procedural (how-to/rules)', default: 'semantic' },
        importance: { type: 'number', description: 'Importance score 0-1 (higher = recalled more often)', default: 0.5 },
        tags: { type: 'string', description: 'Comma-separated tags for categorization' },
      },
      required: ['content', 'summary'],
    },
  },
  {
    name: 'helix_recall',
    description: 'Search Helix long-term memory by keyword. Returns memories ranked by relevance and importance. Use when you need to recall past decisions, project context, or technical knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (keywords or natural language)' },
        type: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: 'Filter by memory type (optional)' },
        limit: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'helix_memory_context',
    description: 'Build a context block from relevant memories for a given topic. Returns a formatted text block suitable for injecting into prompts. Use at the start of complex tasks to load relevant background.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic to build context for' },
        max_tokens: { type: 'number', description: 'Max token budget for context', default: 2000 },
      },
      required: ['query'],
    },
  },
  {
    name: 'helix_memory_stats',
    description: 'Get statistics about stored memories: total count, breakdown by type, average importance, decay stats.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

async function handleToolCall(name, args) {
  await ensureInit();

  switch (name) {
    case 'helix_remember': {
      const result = await mm.remember({
        agentId: AGENT_ID,
        content: args.content,
        summary: args.summary,
        type: args.type || 'semantic',
        importance: args.importance ?? 0.5,
        tags: args.tags,
      });
      return { content: [{ type: 'text', text: `Stored memory: ${result.id}\nType: ${args.type || 'semantic'}\nImportance: ${args.importance ?? 0.5}\nSummary: ${args.summary}` }] };
    }

    case 'helix_recall': {
      const memories = await mm.recall(AGENT_ID, args.query, {
        type: args.type,
        limit: args.limit || 10,
      });
      if (!memories.length) {
        return { content: [{ type: 'text', text: `No memories found for "${args.query}"` }] };
      }
      const text = memories.map((m, i) => {
        const imp = (m.effective_importance || m.importance || 0).toFixed(2);
        return `[${i + 1}] (${m.type}, importance: ${imp}) ${m.summary || ''}\n    ${(m.content || '').slice(0, 300)}`;
      }).join('\n\n');
      return { content: [{ type: 'text', text: `Found ${memories.length} memories for "${args.query}":\n\n${text}` }] };
    }

    case 'helix_memory_context': {
      const ctx = await mm.buildMemoryContext(AGENT_ID, args.query, {
        maxTokens: args.max_tokens || 2000,
      });
      return { content: [{ type: 'text', text: ctx.text || 'No relevant memories found.' }] };
    }

    case 'helix_memory_stats': {
      const stats = await mm.memoryStats(AGENT_ID);
      const lines = [
        `Total memories: ${stats.total || 0}`,
        `By type:`,
      ];
      if (stats.by_type) {
        for (const [type, count] of Object.entries(stats.by_type)) {
          lines.push(`  ${type}: ${count}`);
        }
      }
      lines.push(`Avg importance: ${(stats.avg_importance || 0).toFixed(2)}`);
      lines.push(`Avg decay: ${(stats.avg_decay || 0).toFixed(2)}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

// JSON-RPC over stdio
function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`${msg}\n`);
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(`${msg}\n`);
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = req;

  try {
    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'helix-memory', version: '0.4.1' },
        });
        break;

      case 'initialized':
        // Notification, no response needed
        break;

      case 'tools/list':
        sendResponse(id, { tools: TOOLS });
        break;

      case 'tools/call': {
        const { name, arguments: args } = params;
        const result = await handleToolCall(name, args || {});
        sendResponse(id, result);
        break;
      }

      case 'ping':
        sendResponse(id, {});
        break;

      default:
        if (id) sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (id) sendError(id, -32000, e.message);
  }
});

process.stderr.write('[helix-memory-mcp] Server started\n');
