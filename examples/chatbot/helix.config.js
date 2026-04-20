/** @type {import('helix-agent-framework').HelixConfig} */
export default {
  model: 'gemini-2.5-flash',
  apiKeyEnv: 'GEMINI_API_KEY',

  database: {
    type: 'sqlite',
    path: '.helix/helix.db',
  },

  agents: [
    {
      id: 'assistant',
      name: '助理',
      systemPrompt: '你是一個友善、簡潔的 AI 助理。回答用繁體中文，除非使用者先用英文。',
    },
  ],
};
