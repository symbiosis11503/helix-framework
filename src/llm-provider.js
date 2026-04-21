/**
 * LLM Provider — Multi-provider chat completion
 *
 * Supports: Gemini, Claude (Anthropic), OpenAI
 * Auto-detects provider from model name or key_env.
 *
 * Shared core: works with both A and B versions.
 */

/**
 * Call an LLM with a message
 * @param {object} opts
 * @param {string} opts.model - model name (e.g. 'gemini-2.5-flash', 'claude-sonnet-4-6', 'gpt-4o')
 * @param {string} opts.apiKey - API key
 * @param {string} opts.systemPrompt - system instruction
 * @param {string} opts.message - user message
 * @param {object} [opts.options] - { maxTokens, temperature, responseFormat, jsonSchema }
 * @param {string} [opts.options.responseFormat] - 'text' (default) | 'json'
 * @param {object} [opts.options.jsonSchema] - JSON schema for structured output validation
 * @returns {{ ok, reply, model, provider, usage?, structured? }}
 */
export async function chat({ model, apiKey, systemPrompt, message, options = {} }) {
  const provider = detectProvider(model);

  // If JSON mode requested, inject format instruction into system prompt
  let effectiveSystemPrompt = systemPrompt;
  if (options.responseFormat === 'json') {
    const schemaHint = options.jsonSchema
      ? `\n\nRespond with valid JSON matching this schema:\n${JSON.stringify(options.jsonSchema, null, 2)}`
      : '\n\nRespond with valid JSON only. No markdown, no explanation.';
    effectiveSystemPrompt = (systemPrompt || '') + schemaHint;
  }

  let result;
  switch (provider) {
    case 'gemini':
      result = await callGemini({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options });
      break;
    case 'anthropic':
      result = await callAnthropic({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options });
      break;
    case 'openai':
      result = await callOpenAI({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options });
      break;
    case 'kimi':
      result = await callOpenAICompat({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options, baseUrl: 'https://api.moonshot.cn/v1', provider: 'kimi' });
      break;
    case 'mistral':
      result = await callOpenAICompat({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options, baseUrl: 'https://api.mistral.ai/v1', provider: 'mistral' });
      break;
    case 'deepseek':
      result = await callOpenAICompat({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options, baseUrl: 'https://api.deepseek.com/v1', provider: 'deepseek' });
      break;
    case 'groq':
      result = await callOpenAICompat({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options, baseUrl: 'https://api.groq.com/openai/v1', provider: 'groq' });
      break;
    case 'qwen':
      result = await callOpenAICompat({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', provider: 'qwen' });
      break;
    case 'openrouter':
      result = await callOpenAICompat({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options, baseUrl: 'https://openrouter.ai/api/v1', provider: 'openrouter' });
      break;
    case 'local':
      result = await callOpenAICompat({ model: model.replace('ollama/', ''), apiKey: 'ollama', systemPrompt: effectiveSystemPrompt, message, options, baseUrl: process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1', provider: 'local' });
      break;
    case 'oauth-gpt': {
      const baseUrl = process.env.OAUTH_GPT_BRIDGE_URL;
      if (!baseUrl) throw new Error('oauth-gpt: OAUTH_GPT_BRIDGE_URL not set');
      result = await callOpenAICompat({
        model: model.replace(/^oauth-gpt\//, ''),
        apiKey: apiKey || process.env.OAUTH_GPT_BRIDGE_TOKEN || '',
        systemPrompt: effectiveSystemPrompt, message, options,
        baseUrl, provider: 'oauth-gpt',
      });
      break;
    }
    default:
      result = await callGemini({ model, apiKey, systemPrompt: effectiveSystemPrompt, message, options });
  }

  // Parse and validate structured output if JSON mode
  if (options.responseFormat === 'json' && result.reply) {
    try {
      const jsonMatch = result.reply.match(/[\[{][\s\S]*[\]}]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        result.structured = parsed;
        result.reply = jsonMatch[0]; // Clean reply to just JSON
      }
    } catch {
      // Reply wasn't valid JSON — leave as-is, caller can handle
    }
  }

  return result;
}

/**
 * Detect provider from model name
 */
export function detectProvider(model) {
  if (!model) return 'gemini';
  const m = model.toLowerCase();
  if (m.startsWith('oauth-gpt/') || m === 'oauth-gpt') return 'oauth-gpt';
  if (m.includes('gemini') || m.includes('gemma')) return 'gemini';
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.includes('gpt') || m.includes('o1-') || m.includes('o3') || m.includes('o4')) return 'openai';
  if (m.includes('moonshot') || m.includes('kimi')) return 'kimi';
  if (m.includes('mistral') || m.includes('mixtral') || m.includes('codestral')) return 'mistral';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('ollama/') || m.startsWith('local/')) return 'local';
  if (m.includes('openrouter/')) return 'openrouter';
  if (m.includes('groq')) return 'groq';
  if (m.includes('qwen') || m.includes('tongyi')) return 'qwen';
  return 'gemini';
}

/**
 * Detect API key env var from provider
 */
export function detectKeyEnv(provider) {
  switch (provider) {
    case 'gemini': return 'GEMINI_API_KEY';
    case 'anthropic': return 'ANTHROPIC_API_KEY';
    case 'openai': return 'OPENAI_API_KEY';
    case 'kimi': return 'KIMI_API_KEY';
    case 'mistral': return 'MISTRAL_API_KEY';
    case 'deepseek': return 'DEEPSEEK_API_KEY';
    case 'groq': return 'GROQ_API_KEY';
    case 'qwen': return 'QWEN_API_KEY';
    case 'openrouter': return 'OPENROUTER_API_KEY';
    case 'local': return '';
    case 'oauth-gpt': return 'OAUTH_GPT_BRIDGE_TOKEN';
    default: return 'GEMINI_API_KEY';
  }
}

/**
 * List all supported providers
 */
export function listProviders() {
  return [
    { id: 'gemini', name: 'Google Gemini', keyEnv: 'GEMINI_API_KEY', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
    { id: 'anthropic', name: 'Anthropic Claude', keyEnv: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-6', 'claude-opus-4-6'] },
    { id: 'openai', name: 'OpenAI', keyEnv: 'OPENAI_API_KEY', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
    { id: 'kimi', name: 'Moonshot Kimi', keyEnv: 'KIMI_API_KEY', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
    { id: 'mistral', name: 'Mistral AI', keyEnv: 'MISTRAL_API_KEY', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'] },
    { id: 'deepseek', name: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'] },
    { id: 'groq', name: 'Groq', keyEnv: 'GROQ_API_KEY', models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'] },
    { id: 'qwen', name: 'Alibaba Qwen', keyEnv: 'QWEN_API_KEY', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'] },
    { id: 'openrouter', name: 'OpenRouter', keyEnv: 'OPENROUTER_API_KEY', models: ['(any model via OpenRouter)'] },
    { id: 'local', name: 'Local (Ollama/vLLM)', keyEnv: '', models: ['(any local model)'] },
    { id: 'oauth-gpt', name: 'OAuth GPT Bridge', keyEnv: 'OAUTH_GPT_BRIDGE_TOKEN', models: ['oauth-gpt/<model>'] },
  ];
}

// ========== Provider Implementations ==========

async function callGemini({ model, apiKey, systemPrompt, message, options }) {
  const payload = {
    contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${message}` }] }],
  };
  if (options.maxTokens) payload.generationConfig = { maxOutputTokens: options.maxTokens };
  if (options.temperature !== undefined) {
    payload.generationConfig = { ...payload.generationConfig, temperature: options.temperature };
  }
  if (options.responseFormat === 'json') {
    payload.generationConfig = { ...payload.generationConfig, responseMimeType: 'application/json' };
  }

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data?.usageMetadata;

  return { ok: true, reply, model, provider: 'gemini', usage };
}

async function callAnthropic({ model, apiKey, systemPrompt, message, options }) {
  const payload = {
    model,
    max_tokens: options.maxTokens || 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
  };
  if (options.temperature !== undefined) payload.temperature = options.temperature;

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data?.content?.[0]?.text || '';
  const usage = data?.usage;

  return { ok: true, reply, model, provider: 'anthropic', usage };
}

async function callOpenAI({ model, apiKey, systemPrompt, message, options }) {
  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ],
  };
  if (options.maxTokens) payload.max_tokens = options.maxTokens;
  if (options.temperature !== undefined) payload.temperature = options.temperature;
  if (options.responseFormat === 'json') payload.response_format = { type: 'json_object' };

  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage;

  return { ok: true, reply, model, provider: 'openai', usage };
}

/**
 * Generic OpenAI-compatible API caller
 * Works with: Kimi, Mistral, DeepSeek, Groq, Qwen, OpenRouter, Ollama, vLLM
 */
async function callOpenAICompat({ model, apiKey, systemPrompt, message, options, baseUrl, provider }) {
  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ],
  };
  if (options.maxTokens) payload.max_tokens = options.maxTokens;
  if (options.temperature !== undefined) payload.temperature = options.temperature;
  if (options.responseFormat === 'json') payload.response_format = { type: 'json_object' };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey !== 'ollama') headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`${provider} ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage;

  return { ok: true, reply, model, provider, usage };
}

// ========== Utility ==========

async function fetchWithTimeout(url, opts, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience: chat with JSON structured output
 * @param {object} opts - same as chat(), plus jsonSchema
 * @returns {{ ok, reply, model, provider, structured }}
 */
export async function chatJSON(opts) {
  return chat({ ...opts, options: { ...opts.options, responseFormat: 'json' } });
}

/**
 * Streaming chat — returns async generator yielding text chunks
 * Works with OpenAI-compatible APIs (OpenAI, Kimi, Mistral, DeepSeek, Groq, Qwen, OpenRouter, Ollama)
 * Also supports Anthropic and Gemini streaming
 *
 * @param {object} opts - same as chat()
 * @param {function} [opts.onChunk] - optional callback(chunk: string) for each text piece
 * @yields {string} text chunks
 * @returns {{ ok, reply, model, provider, usage? }}
 */
export async function chatStream({ model, apiKey, systemPrompt, message, options = {}, onChunk = null }) {
  const provider = detectProvider(model);

  // Build provider-specific streaming request
  let url, headers, body;

  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${message}` }] }],
      generationConfig: { maxOutputTokens: options.maxTokens || 4096, temperature: options.temperature ?? 0.7 },
    });
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    body = JSON.stringify({
      model, max_tokens: options.maxTokens || 1024, stream: true,
      system: systemPrompt, messages: [{ role: 'user', content: message }],
    });
  } else {
    // OpenAI-compatible (OpenAI, Kimi, Mistral, DeepSeek, Groq, Qwen, OpenRouter, local)
    const baseUrls = {
      openai: 'https://api.openai.com/v1',
      kimi: 'https://api.moonshot.cn/v1',
      mistral: 'https://api.mistral.ai/v1',
      deepseek: 'https://api.deepseek.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      local: process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1',
      'oauth-gpt': process.env.OAUTH_GPT_BRIDGE_URL || '',
    };
    const base = baseUrls[provider] || baseUrls.openai;
    if (provider === 'oauth-gpt' && !base) throw new Error('oauth-gpt: OAUTH_GPT_BRIDGE_URL not set');
    url = `${base}/chat/completions`;
    headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey !== 'ollama') headers['Authorization'] = `Bearer ${apiKey}`;
    body = JSON.stringify({
      model: model.replace('ollama/', '').replace(/^oauth-gpt\//, ''), stream: true,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
      max_tokens: options.maxTokens || 4096,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120000);

  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`${provider} stream ${res.status}: ${err.slice(0, 200)}`);
    }

    let fullReply = '';

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          let chunk = '';

          if (provider === 'gemini') {
            chunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          } else if (provider === 'anthropic') {
            if (parsed.type === 'content_block_delta') {
              chunk = parsed.delta?.text || '';
            }
          } else {
            chunk = parsed?.choices?.[0]?.delta?.content || '';
          }

          if (chunk) {
            fullReply += chunk;
            if (onChunk) onChunk(chunk);
          }
        } catch {}
      }
    }

    return { ok: true, reply: fullReply, model, provider, streamed: true };
  } finally {
    clearTimeout(timer);
  }
}

export default { chat, chatJSON, chatStream, detectProvider, detectKeyEnv, listProviders };
