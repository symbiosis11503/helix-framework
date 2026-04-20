# Core Guide

Deep dive into Helix's 19 shared-core modules.

## Architecture Overview

```
┌─────────────────────────────────────────┐
│              Your Application            │
├─────────────────────────────────────────┤
│  API Layer (server-lite.js / Express)    │
├──────┬──────┬──────┬──────┬─────────────┤
│Cogni-│Memo- │Exec- │Cont- │  Product    │
│tion  │ry    │ution │rol   │             │
├──────┼──────┼──────┼──────┼─────────────┤
│reason│session│work- │auth  │  trace-lite │
│tools │memory │flow  │2fa   │  skills     │
│skills│know-  │deleg-│oauth │  gateway    │
│llm   │ledge  │auton-│hooks │             │
│      │       │omy   │safety│             │
├──────┴──────┴──────┴──────┴─────────────┤
│           db.js (PG / SQLite)            │
└─────────────────────────────────────────┘
```

## 1. LLM Provider (`llm-provider.js`)

Connect to any LLM with a single function call.

```javascript
import { chat, chatStream, chatJSON } from './src/llm-provider.js';

// Basic chat
const result = await chat({
  model: 'gemini-2.5-flash',
  apiKey: process.env.GEMINI_API_KEY,
  systemPrompt: 'You are a helpful assistant.',
  message: 'What is Node.js?',
});

// Streaming
await chatStream({
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: 'You are a poet.',
  message: 'Write a haiku',
  onChunk: (text) => process.stdout.write(text),
});

// Structured JSON output
const data = await chatJSON({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  systemPrompt: 'Extract entities.',
  message: 'Apple released iPhone 16 in September 2024.',
  options: { jsonSchema: { products: [], companies: [], dates: [] } },
});
console.log(data.structured); // { products: [...], ... }
```

## 2. Session Store (`session-store.js`)

Per-message conversation persistence with compression.

```javascript
import * as ss from './src/session-store.js';

// Create session
const { id } = await ss.createSession({ agentId: 'my-agent' });

// Add messages
await ss.appendMessage({ sessionId: id, role: 'user', content: 'Hello' });
await ss.appendMessage({ sessionId: id, role: 'assistant', content: 'Hi there!' });

// Build context for next LLM call
const ctx = await ss.buildSessionContext(id, { maxTokens: 8000 });

// Search across conversations
const results = await ss.searchMessages('my-agent', 'deployment issue');

// Auto-compress when too large
const summarizer = ss.createLLMSummarizer({ apiKey, model });
await ss.compressSession(id, summarizer);
```

## 3. Memory Manager (`memory-manager.js`)

Three-tier long-term memory with decay.

```javascript
import * as mm from './src/memory-manager.js';

// Remember something
await mm.remember({
  agentId: 'my-agent',
  type: 'episodic',     // or 'semantic', 'procedural'
  content: 'User prefers dark mode and concise answers',
  summary: 'UI preference',
  importance: 0.8,
  tags: ['preference', 'ui'],
});

// Recall relevant memories
const memories = await mm.recall('my-agent', 'user preferences');

// Build memory context for LLM prompt
const ctx = await mm.buildMemoryContext('my-agent', 'current query', { maxTokens: 2000 });

// Auto-extract from conversation
await mm.extractFromSession('my-agent', sessionId);

// Decay old memories
await mm.decayMemories('my-agent', { decayRate: 0.02 });
```

## 4. Knowledge (`knowledge.js`)

Atom-based knowledge governance pipeline.

```javascript
import * as k from './src/knowledge.js';

// Create atoms
await k.createAtom({
  agentId: 'my-agent',
  content: 'PostgreSQL supports JSONB for document storage',
  topic: 'database',
  tags: ['pg', 'json'],
  reliabilityTier: 1,  // 1=verified, 2=unverified, 3=disputed
});

// Promote pipeline: draft → reviewed → promoted
await k.reviewAtom(atomId, { reviewedBy: 'human' });
await k.promoteAtom(atomId);

// Two-layer lint
const lint1 = await k.lintDeterministic('my-agent'); // duplicates, empty, missing topic
const lint2 = await k.lintSemantic('my-agent', { summarizeFn }); // contradictions, outdated

// Compile to report
await k.compile('my-agent', { topic: 'database', title: 'DB Knowledge Report' });
```

## 5. Agent Reasoning (`agent-reasoning.js`)

Plan-Act-Observe loop for complex tasks.

```javascript
import { reason } from './src/agent-reasoning.js';

const result = await reason({
  task: 'Analyze the project structure and find potential security issues',
  agentId: 'security-auditor',
  llm: { model: 'gemini-2.5-flash', apiKey },
  maxIterations: 10,
  onStep: (step) => console.log(`Step ${step.iteration}: ${step.action}`),
});

console.log(result.result);    // Final answer
console.log(result.iterations); // How many steps
console.log(result.steps);     // Full trace
```

## 6. Tool Registry (`tool-registry.js`)

Dynamic tool management with capability binding.

```javascript
import * as tr from './src/tool-registry.js';

// Register a tool
tr.register('weather', {
  description: 'Get weather for a city',
  parameters: { city: { type: 'string', required: true } },
  handler: async ({ city }) => {
    const res = await fetch(`https://wttr.in/${city}?format=j1`);
    return res.json();
  },
});

// Bind capabilities
tr.bindCapabilities('weather', ['read', 'web']);

// Execute with full pipeline (hooks → validate → execute → after hooks)
const result = await tr.execute('weather', { city: 'Taipei' });
```

## 7. Skills (`skills.js`)

Auto-discovered SKILL.md procedural knowledge.

```javascript
import * as sk from './src/skills.js';

// List skills
const skills = sk.listSkills();
const categories = sk.listCategories();

// Get full skill
const skill = sk.getSkill('research/web-search');

// Build invocation prompt
const prompt = sk.buildSkillInvocation('research/web-search', 'Find AI agent frameworks');
// → Ready to inject into LLM context
```

## 8. Delegation (`delegation.js`)

Isolated child agent execution.

```javascript
import { delegate, delegateBatch } from './src/delegation.js';

// Single delegation
const result = await delegate({
  parentAgentId: 'main',
  task: 'Summarize this document',
  blockedTools: ['deploy', 'delete'],
  timeoutMs: 60000,
});

// Parallel batch
const results = await delegateBatch({
  parentAgentId: 'main',
  tasks: ['Task A', 'Task B', 'Task C'],
});
```

## 9. Workflow (`workflow.js`)

DAG-based task orchestration.

```javascript
import * as wf from './src/workflow.js';

const { id } = await wf.createWorkflow({
  name: 'Research Pipeline',
  steps: [
    { id: 'search', name: 'Search', action: 'tool:web-search' },
    { id: 'analyze', name: 'Analyze', action: 'reason', depends_on: ['search'] },
    { id: 'report', name: 'Report', action: 'tool:summarize', depends_on: ['analyze'] },
  ],
});

const run = await wf.executeWorkflow(id, {
  executeFn: async (step, ctx) => { /* execute step */ },
});
```

## 10. Security

### Command Safety (`command-safety.js`)
```javascript
import { isSafe, inspectCommand } from './src/command-safety.js';

isSafe('ls -la');           // { safe: true }
isSafe('rm -rf /');         // { safe: false, level: 'block', ... }
inspectCommand('DROP TABLE users'); // { level: 'block', category: 'database', ... }
```

### Auth (`auth.js`) + 2FA (`two-factor.js`)
```javascript
import * as auth from './src/auth.js';
import * as tfa from './src/two-factor.js';

// Create API key
const { key } = await auth.createApiKey({ name: 'my-app', role: 'operator' });

// Validate
const result = await auth.validateKey(key);

// Setup 2FA
const { qrUri, backupCodes } = await tfa.setup('user1');
// User scans QR → enters code
await tfa.verifySetup('user1', '123456');
// On login
await tfa.verify('user1', '654321');
```

## 11. Gateway (`gateway-adapter.js`)

Connect to messaging platforms.

```javascript
import { createTelegramAdapter, processMessage } from './src/gateway-adapter.js';

const telegram = createTelegramAdapter(process.env.TELEGRAM_BOT_TOKEN);
// In webhook handler:
const msg = telegram.parseWebhook(webhookBody);
const result = await processMessage('telegram', msg, { model: 'gemini-2.5-flash' });
await telegram.sendMessage(msg.chatId, result.reply);
```

## 12. Observability (`trace-lite.js`)

Run/Span/Metrics tracing.

```javascript
import * as tr from './src/trace-lite.js';

const run = await tr.startRun({ agentId: 'my-agent' });
const span = await tr.startSpan({ runId: run.id, spanType: 'tool', name: 'web-search' });
// ... do work ...
await tr.endSpan(span.id, { status: 'ok', durationMs: 150 });
await tr.recordMetrics(span.id, { provider: 'gemini', promptTokens: 500, completionTokens: 200 });
await tr.endRun(run.id);

// Query
const stats = await tr.traceStats({ hours: 24 });
```

## 13. Evaluation (`eval-lite.js`)

Built-in benchmark runner with regression gates.

```javascript
import * as ev from './src/eval-lite.js';

await ev.initEvalTables();

// Run built-in suites
const cs = await ev.evalCommandSafety();       // 11 cases
const pi = await ev.evalPromptInjection();     // 12 cases
const mr = await ev.evalMemoryRecall('test');  // 3 cases (needs DB)

console.log(cs.score, pi.score); // 100, 100

// Custom benchmark
const result = await ev.runBenchmark({
  suite: 'my-suite',
  cases: [
    { input: 'hello', expected: 'greeting' },
    { input: 'bye', expected: 'farewell' },
  ],
  executeFn: async (input) => classify(input),
  scoreFn: (output, expected) => ({ pass: output === expected, score: output === expected ? 1 : 0 }),
});

// Regression gate (block if score drops >5%)
const gate = await ev.checkRegression(baselineRunId, currentRunId);
if (gate.regression) throw new Error(`Score dropped by ${gate.delta}%`);

// History
const history = await ev.getEvalHistory({ suite: 'command-safety', limit: 10 });
```
