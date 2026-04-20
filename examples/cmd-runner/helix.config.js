/** @type {import('helix-agent-framework').HelixConfig} */
export default {
  model: 'gpt-4o-mini',
  apiKeyEnv: 'OPENAI_API_KEY',

  database: {
    type: 'sqlite',
    path: '.helix/helix.db',
  },

  agents: [
    {
      id: 'ops',
      name: '運維助手',
      systemPrompt: `你是一位本地運維助手。你可以執行 shell 指令來幫助使用者排查問題。

安全準則：
- 永遠先 inspect 指令再執行（危險指令會被 hook 自動 block）
- 危險指令（rm -rf / DROP TABLE / git push --force 等）不要提議
- 需要修改檔案時，用 edit_file 工具走 exact-match 流程，不直接跑 sed

回答格式：簡短、顯示執行結果、必要時建議下一步。`,
      tools: ['shell_exec', 'edit_file', 'read_file'],
    },
  ],

  hooks: {
    // Hook the built-in command-safety + prompt-injection defenses
    enabled: ['builtin-command-safety', 'builtin-injection-defense'],
  },

  // Risk level gating for shell_exec
  safety: {
    blockOnDanger: true,  // dangerous patterns abort execution
    warnOnRisk: true,     // risky patterns log warning but proceed
  },
};
