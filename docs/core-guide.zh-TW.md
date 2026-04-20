# 核心模組導覽

[English](./core-guide.md)

Helix 19 個 shared-core 模組的深入介紹。程式碼範例維持英文（直接貼到你的專案可用），說明文字為繁中。

## 架構概覽

```
┌─────────────────────────────────────────┐
│              你的應用                    │
├─────────────────────────────────────────┤
│  API Layer (server-lite.js / Express)    │
├──────┬──────┬──────┬──────┬─────────────┤
│認知  │記憶  │執行  │控制  │  產品層     │
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

一個函式呼叫連接任何 LLM。

```javascript
import { chat, chatStream, chatJSON } from './src/llm-provider.js';

// 基本對話
const result = await chat({
  model: 'gemini-2.5-flash',
  apiKey: process.env.GEMINI_API_KEY,
  systemPrompt: 'You are a helpful assistant.',
  message: 'What is Node.js?',
});

// 串流
await chatStream({
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: 'You are a poet.',
  message: 'Write a haiku',
  onChunk: (text) => process.stdout.write(text),
});

// 結構化 JSON 輸出
const data = await chatJSON({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  systemPrompt: 'Extract entities.',
  message: 'Apple released iPhone 16 in September 2024.',
  options: { jsonSchema: { products: [], companies: [], dates: [] } },
});
console.log(data.structured);
```

## 2. Session Store (`session-store.js`)

逐訊息對話持久化 + 自動壓縮。

```javascript
import * as ss from './src/session-store.js';

const { id } = await ss.createSession({ agentId: 'my-agent' });
await ss.appendMessage({ sessionId: id, role: 'user', content: 'Hello' });
await ss.appendMessage({ sessionId: id, role: 'assistant', content: 'Hi there!' });

// 建構下次 LLM 呼叫用的 context
const ctx = await ss.buildSessionContext(id, { maxTokens: 8000 });

// 跨對話搜尋
const results = await ss.searchMessages('my-agent', 'deployment issue');

// 長對話自動壓縮
const summarizer = ss.createLLMSummarizer({ apiKey, model });
await ss.compressSession(id, summarizer);
```

## 3. Memory Manager (`memory-manager.js`)

三層長期記憶 + 衰減。

```javascript
import * as mm from './src/memory-manager.js';

// 記住一件事
await mm.remember({
  agentId: 'my-agent',
  type: 'episodic',     // 'episodic' | 'semantic' | 'procedural'
  content: 'User prefers dark mode and concise answers',
  summary: 'UI preference',
  importance: 0.8,
  tags: ['preference', 'ui'],
});

// 召回相關記憶
const memories = await mm.recall('my-agent', 'user preferences');

// 自動從 session 抽取
await mm.extractFromSession('my-agent', sessionId);

// 時間衰減
await mm.decayMemories('my-agent', { decayRate: 0.02 });
```

## 4. Knowledge (`knowledge.js`)

Atom 原子式知識治理管線。

```javascript
import * as k from './src/knowledge.js';

// 建立 atom
await k.createAtom({
  agentId: 'my-agent',
  content: 'PostgreSQL supports JSONB for document storage',
  topic: 'database',
  tags: ['pg', 'json'],
  reliabilityTier: 1,  // 1=已驗證 / 2=未驗證 / 3=有爭議
});

// 提升管線：draft → reviewed → promoted
await k.reviewAtom(atomId, { reviewedBy: 'human' });
await k.promoteAtom(atomId);

// 兩層 lint
const lint1 = await k.lintDeterministic('my-agent'); // 重複 / 空 / 缺 topic
const lint2 = await k.lintSemantic('my-agent', { summarizeFn }); // 矛盾 / 過時
```

## 5. Agent Reasoning (`agent-reasoning.js`)

Plan-Act-Observe 迴圈處理複雜任務。

```javascript
import { reason } from './src/agent-reasoning.js';

const result = await reason({
  task: 'Analyze the project structure and find potential security issues',
  agentId: 'security-auditor',
  llm: { model: 'gemini-2.5-flash', apiKey },
  maxIterations: 10,
  onStep: (step) => console.log(`Step ${step.iteration}: ${step.action}`),
});

console.log(result.result);     // 最終答案
console.log(result.iterations); // 步驟數
console.log(result.steps);      // 完整 trace
```

## 6. Tool Registry (`tool-registry.js`)

動態工具管理 + capability 綁定。

```javascript
import * as tr from './src/tool-registry.js';

tr.register('weather', {
  description: 'Get weather for a city',
  parameters: { city: { type: 'string', required: true } },
  handler: async ({ city }) => {
    const res = await fetch(`https://wttr.in/${city}?format=j1`);
    return res.json();
  },
});

tr.bindCapabilities('weather', ['read', 'web']);

// 走完整 pipeline：hooks → validate → execute → after hooks
const result = await tr.execute('weather', { city: 'Taipei' });
```

## 7. Skills (`skills.js`)

SKILL.md 自動發現 + 程序性知識。

```javascript
import * as sk from './src/skills.js';

const skills = sk.listSkills();
const skill = sk.getSkill('research/web-search');

// 建構 LLM invocation prompt
const prompt = sk.buildSkillInvocation('research/web-search', 'Find AI agent frameworks');
```

## 8. Delegation (`delegation.js`)

隔離子 agent 執行。

```javascript
import { delegate, delegateBatch } from './src/delegation.js';

// 單次委派
const result = await delegate({
  parentAgentId: 'main',
  task: 'Summarize this document',
  blockedTools: ['deploy', 'delete'],
  timeoutMs: 60000,
});

// 平行批次
const results = await delegateBatch({
  parentAgentId: 'main',
  tasks: ['Task A', 'Task B', 'Task C'],
});
```

## 9. Workflow (`workflow.js`)

DAG 任務編排引擎。

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
  executeFn: async (step, ctx) => { /* 執行 step */ },
});
```

## 10. 安全

### 指令安全 (`command-safety.js`)
```javascript
import { isSafe, inspectCommand } from './src/command-safety.js';

isSafe('ls -la');                    // { safe: true }
isSafe('rm -rf /');                  // { safe: false, level: 'block', ... }
inspectCommand('DROP TABLE users');  // { level: 'block', category: 'database' }
```

### 認證 (`auth.js`) + 2FA (`two-factor.js`)
```javascript
import * as auth from './src/auth.js';
import * as tfa from './src/two-factor.js';

const { key } = await auth.createApiKey({ name: 'my-app', role: 'operator' });
const result = await auth.validateKey(key);

const { qrUri, backupCodes } = await tfa.setup('user1');
await tfa.verifySetup('user1', '123456');
await tfa.verify('user1', '654321');
```

## 11. Gateway (`gateway-adapter.js`)

連接訊息平台（Telegram / Discord / LINE / Slack）。

```javascript
import { createTelegramAdapter, processMessage } from './src/gateway-adapter.js';

const telegram = createTelegramAdapter(process.env.TELEGRAM_BOT_TOKEN);
const msg = telegram.parseWebhook(webhookBody);
const result = await processMessage('telegram', msg, { model: 'gemini-2.5-flash' });
await telegram.sendMessage(msg.chatId, result.reply);
```

## 12. 可觀測性 (`trace-lite.js`)

Run / Span / Metrics 追蹤。

```javascript
import * as tr from './src/trace-lite.js';

const run = await tr.startRun({ agentId: 'my-agent' });
const span = await tr.startSpan({ runId: run.id, spanType: 'tool', name: 'web-search' });
await tr.endSpan(span.id, { status: 'ok', durationMs: 150 });
await tr.recordMetrics(span.id, { provider: 'gemini', promptTokens: 500, completionTokens: 200 });
await tr.endRun(run.id);

const stats = await tr.traceStats({ hours: 24 });
```

## 13. Eval (`eval-lite.js`)

內建 benchmark 執行器 + 迴歸閘門。

```javascript
import * as ev from './src/eval-lite.js';

await ev.initEvalTables();

// 內建 suite
const cs = await ev.evalCommandSafety();        // 11 cases
const pi = await ev.evalPromptInjection();      // 12 cases
const mr = await ev.evalMemoryRecall('test');   // 3 cases

// 自訂 benchmark
const result = await ev.runBenchmark({
  suite: 'my-suite',
  cases: [ { input: 'hello', expected: 'greeting' } ],
  executeFn: async (input) => classify(input),
  scoreFn: (output, expected) => ({ pass: output === expected, score: output === expected ? 1 : 0 }),
});

// 迴歸閘門（分數掉 >5% 就 block）
const gate = await ev.checkRegression(baselineRunId, currentRunId);
if (gate.regression) throw new Error(`Score dropped by ${gate.delta}%`);
```
