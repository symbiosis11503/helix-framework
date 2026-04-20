/**
 * MCP Client — Model Context Protocol stdio transport
 *
 * Connects to external MCP servers as subprocesses:
 * - Stdio transport (JSON-RPC over stdin/stdout)
 * - Dynamic tool discovery (tools/list)
 * - Tool execution (tools/call)
 * - Server lifecycle management (start/stop/restart)
 * - Config-based server registration
 *
 * Shared core: works with both A and B versions.
 *
 * Design reference: Hermes mcp_tool.py + Claude Code MCP transport.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// ========== MCP Server Manager ==========

const _servers = new Map(); // name → MCPServer instance

class MCPServer extends EventEmitter {
  constructor(name, config) {
    super();
    this.name = name;
    this.command = config.command;
    this.args = config.args || [];
    this.env = { ...process.env, ...(config.env || {}) };
    this.timeout = config.timeout || 30000;
    this.connectTimeout = config.connectTimeout || 15000;

    this.process = null;
    this.tools = [];
    this.status = 'stopped'; // stopped | starting | ready | error
    this._pendingRequests = new Map();
    this._requestId = 0;
    this._buffer = '';
  }

  /**
   * Start the MCP server subprocess and discover tools
   */
  async start() {
    if (this.status === 'ready') return;
    this.status = 'starting';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop();
        reject(new Error(`MCP server ${this.name} connect timeout (${this.connectTimeout}ms)`));
      }, this.connectTimeout);

      try {
        this.process = spawn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: this.env,
        });

        this.process.stdout.on('data', (data) => this._onData(data));
        this.process.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) console.warn(`[mcp:${this.name}] stderr: ${msg.slice(0, 200)}`);
        });

        this.process.on('error', (err) => {
          this.status = 'error';
          clearTimeout(timer);
          reject(new Error(`MCP server ${this.name} failed to start: ${err.message}`));
        });

        this.process.on('exit', (code) => {
          this.status = 'stopped';
          this.emit('exit', code);
          // Reject pending requests
          for (const [id, pending] of this._pendingRequests) {
            pending.reject(new Error(`MCP server ${this.name} exited with code ${code}`));
          }
          this._pendingRequests.clear();
        });

        // Initialize: send initialize request
        this._sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'helix', version: '0.3.0' },
        }).then(async (initResult) => {
          // Send initialized notification
          this._sendNotification('notifications/initialized', {});

          // Discover tools
          try {
            const toolsResult = await this._sendRequest('tools/list', {});
            this.tools = toolsResult.tools || [];
            this.status = 'ready';
            clearTimeout(timer);
            resolve({ tools: this.tools.length });
          } catch (e) {
            this.status = 'error';
            clearTimeout(timer);
            reject(new Error(`MCP server ${this.name} tools/list failed: ${e.message}`));
          }
        }).catch((e) => {
          this.status = 'error';
          clearTimeout(timer);
          reject(e);
        });

      } catch (e) {
        this.status = 'error';
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  /**
   * Stop the MCP server
   */
  stop() {
    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }
    this.status = 'stopped';
    this.tools = [];
    this._pendingRequests.clear();
  }

  /**
   * Call a tool on this MCP server
   */
  async callTool(toolName, args = {}) {
    if (this.status !== 'ready') {
      throw new Error(`MCP server ${this.name} not ready (status: ${this.status})`);
    }

    const result = await this._sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });

    return result;
  }

  // ========== JSON-RPC Transport ==========

  _sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this._requestId;
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`MCP request ${method} timeout (${this.timeout}ms)`));
      }, this.timeout);

      this._pendingRequests.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      try {
        this.process.stdin.write(msg);
      } catch (e) {
        this._pendingRequests.delete(id);
        clearTimeout(timer);
        reject(new Error(`Failed to write to MCP server ${this.name}: ${e.message}`));
      }
    });
  }

  _sendNotification(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    try {
      this.process.stdin.write(msg);
    } catch {}
  }

  _onData(data) {
    this._buffer += data.toString();
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || ''; // Keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch {
        // Not JSON, skip
      }
    }
  }

  _handleMessage(msg) {
    // Response to our request
    if (msg.id && this._pendingRequests.has(msg.id)) {
      const pending = this._pendingRequests.get(msg.id);
      this._pendingRequests.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(`MCP error: ${msg.error.message || JSON.stringify(msg.error)}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Notification from server
    if (msg.method === 'notifications/tools/list_changed') {
      // Re-discover tools
      this._sendRequest('tools/list', {}).then(result => {
        this.tools = result.tools || [];
        this.emit('tools_changed', this.tools);
      }).catch(() => {});
    }
  }
}

// ========== Public API ==========

/**
 * Connect to an MCP server
 * @param {string} name - server identifier
 * @param {object} config - { command, args, env, timeout, connectTimeout }
 */
export async function connectServer(name, config) {
  // Stop existing
  if (_servers.has(name)) {
    _servers.get(name).stop();
  }

  const server = new MCPServer(name, config);
  _servers.set(name, server);

  await server.start();
  return {
    name,
    tools: server.tools.map(t => ({ name: t.name, description: t.description })),
    toolCount: server.tools.length,
  };
}

/**
 * Connect multiple servers from config
 * @param {object} serversConfig - { name: { command, args, env } }
 */
export async function connectFromConfig(serversConfig) {
  const results = {};
  for (const [name, config] of Object.entries(serversConfig)) {
    try {
      results[name] = await connectServer(name, config);
    } catch (e) {
      results[name] = { name, error: e.message };
    }
  }
  return results;
}

/**
 * Disconnect a server
 */
export function disconnectServer(name) {
  const server = _servers.get(name);
  if (!server) return { ok: false, error: 'server not found' };
  server.stop();
  _servers.delete(name);
  return { ok: true };
}

/**
 * Disconnect all servers
 */
export function disconnectAll() {
  for (const server of _servers.values()) {
    server.stop();
  }
  _servers.clear();
}

/**
 * Call a tool on a connected MCP server
 */
export async function callTool(serverName, toolName, args = {}) {
  const server = _servers.get(serverName);
  if (!server) throw new Error(`MCP server ${serverName} not connected`);
  return server.callTool(toolName, args);
}

/**
 * List all discovered tools across all servers
 */
export function listAllTools() {
  const tools = [];
  for (const [name, server] of _servers) {
    for (const tool of server.tools) {
      tools.push({
        server: name,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
  }
  return tools;
}

/**
 * Get status of all connected servers
 */
export function serverStatus() {
  const status = {};
  for (const [name, server] of _servers) {
    status[name] = {
      status: server.status,
      toolCount: server.tools.length,
      tools: server.tools.map(t => t.name),
      command: server.command,
    };
  }
  return {
    totalServers: _servers.size,
    totalTools: listAllTools().length,
    servers: status,
  };
}

/**
 * Find which server has a tool
 */
export function findTool(toolName) {
  for (const [name, server] of _servers) {
    const tool = server.tools.find(t => t.name === toolName);
    if (tool) return { server: name, tool };
  }
  return null;
}

export default {
  connectServer, connectFromConfig, disconnectServer, disconnectAll,
  callTool, listAllTools, serverStatus, findTool,
};
