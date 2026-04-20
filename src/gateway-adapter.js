/**
 * Gateway Adapter — Unified messaging platform integration
 *
 * Provides a standard interface for connecting external messaging platforms
 * (Telegram, Discord, LINE, Slack, etc.) to Helix agent chat.
 *
 * Flow: Platform webhook → Gateway adapter → Agent chat (with session) → Reply to platform
 *
 * Shared core: works with both A and B versions.
 */

import * as sessionStore from './session-store.js';
import { createHmac } from 'crypto';

// ========== Adapter Registry ==========

const _adapters = new Map(); // platform → adapter instance

/**
 * Register a platform adapter
 * @param {string} platform - 'telegram' | 'discord' | 'line' | 'slack' | 'email'
 * @param {object} adapter - { sendMessage, parseWebhook, validateSignature? }
 */
export function registerAdapter(platform, adapter) {
  _adapters.set(platform, adapter);
  return { ok: true, platform };
}

/**
 * Get registered adapter
 */
export function getAdapter(platform) {
  return _adapters.get(platform) || null;
}

/**
 * List all registered adapters
 */
export function listAdapters() {
  return [..._adapters.keys()];
}

// ========== Unified Message Processing ==========

/**
 * Process an incoming message from any platform
 * @param {string} platform - which platform
 * @param {object} message - { userId, chatId, text, metadata? }
 * @param {object} opts - { agentId, model, apiKey }
 * @returns {{ ok, reply, session_id, platform }}
 */
export async function processMessage(platform, message, opts = {}) {
  const { userId, chatId, text } = message;
  const agentId = opts.agentId || `${platform}-${chatId}`;

  if (!text || !text.trim()) {
    return { ok: false, error: 'empty message' };
  }

  // Get or create session for this chat
  const sessionKey = `${platform}:${chatId}`;
  let sessId = _chatSessions.get(sessionKey);

  if (!sessId) {
    const sess = await sessionStore.createSession({
      agentId,
      metadata: { platform, chatId, userId },
    });
    sessId = sess.id;
    _chatSessions.set(sessionKey, sessId);
  }

  // Persist user message
  await sessionStore.appendMessage({
    sessionId: sessId,
    role: 'user',
    content: text,
    metadata: { platform, userId, chatId },
  });

  // Build context from session
  const ctx = await sessionStore.buildSessionContext(sessId, { maxTokens: 6000 });
  const contextMessage = ctx.text ? `[對話歷史]\n${ctx.text}\n\n[目前問題]\n${text}` : text;

  // Call LLM
  try {
    const llm = await import('./llm-provider.js');
    const model = opts.model || 'gemini-2.5-flash';
    const provider = llm.detectProvider(model);
    const apiKey = opts.apiKey || process.env[llm.detectKeyEnv(provider)];

    if (!apiKey) {
      return { ok: false, error: `No API key for ${provider}` };
    }

    const result = await llm.chat({
      model,
      apiKey,
      systemPrompt: opts.systemPrompt || 'You are a helpful AI assistant. Reply concisely.',
      message: contextMessage,
    });

    // Persist assistant reply
    await sessionStore.appendMessage({
      sessionId: sessId,
      role: 'assistant',
      content: result.reply,
      metadata: { platform, model: result.model },
    });

    // Auto-compress if needed
    const sess = await sessionStore.getSession(sessId);
    if (sess && sess.total_tokens > 20000) {
      const summarizer = sessionStore.createLLMSummarizer({ apiKey, model });
      const compressed = await sessionStore.compressSession(sessId, summarizer);
      if (compressed.compressed) {
        sessId = compressed.newSessionId;
        _chatSessions.set(sessionKey, sessId);
      }
    }

    return {
      ok: true,
      reply: result.reply,
      session_id: sessId,
      platform,
      provider: result.provider,
    };
  } catch (e) {
    await sessionStore.appendMessage({
      sessionId: sessId,
      role: 'assistant',
      content: `[error] ${e.message}`,
      metadata: { error: true },
    });
    return { ok: false, error: e.message, session_id: sessId };
  }
}

// Session tracking per chat
const _chatSessions = new Map(); // "platform:chatId" → sessionId

// ========== Telegram Adapter ==========

export function createTelegramAdapter(botToken) {
  const BASE = `https://api.telegram.org/bot${botToken}`;

  return {
    platform: 'telegram',

    /**
     * Parse Telegram webhook update
     */
    parseWebhook(body) {
      const msg = body.message || body.edited_message;
      if (!msg || !msg.text) return null;
      return {
        userId: String(msg.from?.id || ''),
        chatId: String(msg.chat?.id || ''),
        text: msg.text,
        metadata: {
          messageId: msg.message_id,
          firstName: msg.from?.first_name,
          username: msg.from?.username,
          chatType: msg.chat?.type,
        },
      };
    },

    /**
     * Send reply to Telegram chat
     */
    async sendMessage(chatId, text) {
      const res = await fetch(`${BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4096), // Telegram limit
          parse_mode: 'Markdown',
        }),
      });
      return res.json();
    },

    /**
     * Set webhook URL
     */
    async setWebhook(url) {
      const res = await fetch(`${BASE}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      return res.json();
    },

    /**
     * Get bot info
     */
    async getMe() {
      const res = await fetch(`${BASE}/getMe`);
      return res.json();
    },
  };
}

// ========== Discord Adapter ==========

export function createDiscordAdapter(botToken) {
  const BASE = 'https://discord.com/api/v10';

  return {
    platform: 'discord',

    parseWebhook(body) {
      // Discord uses interaction-based webhooks
      if (body.type === 1) return null; // PING
      const data = body.data;
      return {
        userId: body.member?.user?.id || body.user?.id || '',
        chatId: body.channel_id || '',
        text: data?.options?.[0]?.value || data?.content || '',
        metadata: {
          interactionId: body.id,
          guildId: body.guild_id,
          token: body.token,
        },
      };
    },

    async sendMessage(channelId, text) {
      const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bot ${botToken}`,
        },
        body: JSON.stringify({ content: text.slice(0, 2000) }),
      });
      return res.json();
    },
  };
}

// ========== LINE Adapter ==========

export function createLINEAdapter(channelAccessToken, channelSecret) {
  const BASE = 'https://api.line.me/v2/bot';

  return {
    platform: 'line',

    /**
     * Parse LINE webhook event
     */
    parseWebhook(body) {
      const events = body.events || [];
      const msgEvent = events.find(e => e.type === 'message' && e.message?.type === 'text');
      if (!msgEvent) return null;
      return {
        userId: msgEvent.source?.userId || '',
        chatId: msgEvent.replyToken || '',
        text: msgEvent.message.text,
        metadata: {
          messageId: msgEvent.message.id,
          source: msgEvent.source,
        },
      };
    },

    /**
     * Reply to a LINE message (using replyToken)
     */
    async sendMessage(replyToken, text) {
      const res = await fetch(`${BASE}/message/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({
          replyToken,
          messages: [{ type: 'text', text }],
        }),
      });
      return res.json();
    },

    /**
     * Push a message to a LINE user (no replyToken needed)
     */
    async pushMessage(userId, text) {
      const res = await fetch(`${BASE}/message/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: 'text', text }],
        }),
      });
      return res.json();
    },

    /**
     * Validate X-Line-Signature (HMAC-SHA256)
     */
    validateSignature(body, signature) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const digest = createHmac('sha256', channelSecret)
        .update(bodyStr)
        .digest('base64');
      return digest === signature;
    },
  };
}

// ========== Slack Adapter ==========

export function createSlackAdapter(botToken, signingSecret) {
  const BASE = 'https://slack.com/api';

  return {
    platform: 'slack',

    /**
     * Parse Slack webhook event
     */
    parseWebhook(body) {
      // URL verification challenge
      if (body.type === 'url_verification') {
        return { _challenge: body.challenge };
      }

      if (body.type !== 'event_callback') return null;

      const event = body.event;
      if (!event || event.type !== 'message') return null;
      // Ignore bot messages
      if (event.subtype === 'bot_message' || event.bot_id) return null;

      return {
        userId: event.user || '',
        chatId: event.channel || '',
        text: event.text || '',
        metadata: {
          ts: event.ts,
          team: body.team_id,
        },
      };
    },

    /**
     * Send message to a Slack channel
     */
    async sendMessage(channel, text) {
      const res = await fetch(`${BASE}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`,
        },
        body: JSON.stringify({ channel, text }),
      });
      return res.json();
    },

    /**
     * Validate Slack request signature (v0 HMAC-SHA256)
     */
    validateSignature(body, timestamp, signature) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const sigBasestring = `v0:${timestamp}:${bodyStr}`;
      const digest = 'v0=' + createHmac('sha256', signingSecret)
        .update(sigBasestring)
        .digest('hex');
      return digest === signature;
    },
  };
}

export default {
  registerAdapter, getAdapter, listAdapters,
  processMessage,
  createTelegramAdapter, createDiscordAdapter, createLINEAdapter, createSlackAdapter,
};
