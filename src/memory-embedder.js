/**
 * Memory Embedder
 *
 * Primary path: local/OpenAI-compatible bge-m3 (1024 dim)
 * Fallback path: Gemini embedding API (1536 dim)
 */

const DEFAULT_TIMEOUT_MS = parseInt(process.env.MEMORY_EMBED_TIMEOUT_MS || '15000', 10);
const PRIMARY_MODEL = process.env.MEMORY_EMBED_MODEL || 'bge-m3';
const PRIMARY_BASE_URL = process.env.MEMORY_EMBED_BASE_URL || 'http://127.0.0.1:11434';
const PRIMARY_DIMENSIONS = parseInt(process.env.MEMORY_EMBED_DIM || '1024', 10);
const PRIMARY_API_KEY = process.env.MEMORY_EMBED_API_KEY || null;

const FALLBACK_MODEL = process.env.MEMORY_FALLBACK_EMBED_MODEL || 'gemini-embedding-001';
const FALLBACK_DIMENSIONS = parseInt(process.env.MEMORY_FALLBACK_EMBED_DIM || '1536', 10);
const FALLBACK_API_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_TN || null;

function timeoutSignal(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}

function withAuth(headers = {}, apiKey = null) {
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function postJson(url, body, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: timeoutSignal(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`embed request failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function embedOpenAICompatible(text, opts = {}) {
  const baseUrl = normalizeBaseUrl(opts.baseUrl || PRIMARY_BASE_URL);
  const model = opts.model || PRIMARY_MODEL;
  const dimensions = parseInt(opts.dimensions || PRIMARY_DIMENSIONS, 10);
  const apiKey = opts.apiKey ?? PRIMARY_API_KEY;
  const headers = withAuth({}, apiKey);

  const data = await postJson(`${baseUrl}/v1/embeddings`, {
    model,
    input: text,
    dimensions,
  }, { headers, timeoutMs: opts.timeoutMs });

  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('openai-compatible embedding response missing vector');
  }

  return {
    ok: true,
    embedding,
    dim: embedding.length,
    embedder: model,
    provider: 'openai_compatible',
    endpoint: `${baseUrl}/v1/embeddings`,
    degraded: false,
  };
}

export async function embedOllama(text, opts = {}) {
  const baseUrl = normalizeBaseUrl(opts.baseUrl || PRIMARY_BASE_URL);
  const model = opts.model || PRIMARY_MODEL;
  const data = await postJson(`${baseUrl}/api/embed`, {
    model,
    input: text,
  }, { timeoutMs: opts.timeoutMs });

  const embedding = data?.embeddings?.[0] || data?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('ollama embedding response missing vector');
  }

  return {
    ok: true,
    embedding,
    dim: embedding.length,
    embedder: model,
    provider: 'ollama',
    endpoint: `${baseUrl}/api/embed`,
    degraded: false,
  };
}

export async function embedGemini(text, opts = {}) {
  const apiKey = opts.apiKey || FALLBACK_API_KEY;
  if (!apiKey) throw new Error('gemini api key not configured');
  const model = opts.model || FALLBACK_MODEL;
  const dimensions = parseInt(opts.dimensions || FALLBACK_DIMENSIONS, 10);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;

  const data = await postJson(url, {
    model: `models/${model}`,
    content: { parts: [{ text: String(text).slice(0, 8192) }] },
    outputDimensionality: dimensions,
  }, {
    headers: { 'x-goog-api-key': apiKey },
    timeoutMs: opts.timeoutMs,
  });

  const embedding = data?.embedding?.values;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('gemini embedding response missing vector');
  }

  return {
    ok: true,
    embedding,
    dim: embedding.length,
    embedder: model,
    provider: 'gemini',
    endpoint: url,
    degraded: false,
  };
}

export async function embedText(text, opts = {}) {
  const mode = opts.mode || process.env.MEMORY_EMBED_MODE || 'auto';
  const normalized = String(text || '').trim();
  if (!normalized) throw new Error('text required for embedding');

  const primaryFirst = async () => {
    try {
      return await embedOpenAICompatible(normalized, opts);
    } catch (e1) {
      try {
        return await embedOllama(normalized, opts);
      } catch (e2) {
        if (opts.allowFallback === false) throw e2;
        return embedGemini(normalized, opts);
      }
    }
  };

  if (mode === 'openai_compatible') return embedOpenAICompatible(normalized, opts);
  if (mode === 'ollama') return embedOllama(normalized, opts);
  if (mode === 'gemini') return embedGemini(normalized, opts);
  return primaryFirst();
}

export function vectorLiteral(vector = []) {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  return `[${vector.join(',')}]`;
}

export default {
  embedText,
  embedOpenAICompatible,
  embedOllama,
  embedGemini,
  vectorLiteral,
};
