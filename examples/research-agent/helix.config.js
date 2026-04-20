/** @type {import('helix-agent-framework').HelixConfig} */
export default {
  model: 'claude-sonnet-4-6',
  apiKeyEnv: 'ANTHROPIC_API_KEY',

  database: {
    type: 'sqlite',
    path: '.helix/helix.db',
  },

  agents: [
    {
      id: 'researcher',
      name: '研究員',
      systemPrompt: `你是一位嚴謹的研究助理。流程：
1. 接到問題後，先列出 2-3 個子問題
2. 對每個子問題，用可用工具（web-search / recall）找資料
3. 把結果整理成結構化筆記存到長期記憶（helix_remember）
4. 綜合給使用者一個帶引用的答案

記憶分層：
- episodic：單次研究的發現（importance 0.6-0.8）
- semantic：跨研究可複用的知識點（importance 0.6-0.7）
- procedural：研究方法學（importance 0.8+）`,
    },
  ],

  skills: {
    // Built-in skills — auto-loaded from data/skills/
    enabled: ['research/web-search', 'research/summarize'],
  },

  memory: {
    // Enable long-term memory manager (memory-manager.js)
    enabled: true,
    decay: true,          // time decay on importance
    autoConsolidate: true, // merge similar episodic memories
  },
};
