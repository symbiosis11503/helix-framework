const invoke = window.__TAURI__?.core?.invoke;

const runtimeStatus = document.getElementById('runtime-status');
const runtimeDetail = document.getElementById('runtime-detail');
const statusHint = document.getElementById('status-hint');
const refreshBtn = document.getElementById('refresh-btn');
const loadBtn = document.getElementById('load-btn');
const browserBtn = document.getElementById('browser-btn');
const copyBtn = document.getElementById('copy-btn');
const guideCopy = document.getElementById('guide-copy');
const emptyTitle = document.getElementById('empty-title');
const emptyCopy = document.getElementById('empty-copy');
const frame = document.getElementById('console-frame');
const emptyState = document.getElementById('empty-state');

const START_COMMAND = 'helix start --port 18860';
let runtimeUrl = 'http://127.0.0.1:18860/v2/';
let runtimeReady = false;

const VIEW_STATE = {
  checking: {
    badge: ['waiting', '檢查中…'],
    detail: '正在檢查本機 Helix runtime',
    hint: '先確認 127.0.0.1:18860 是否有 listener，這一步不會假裝桌面版已自帶後端。',
    emptyTitle: '正在檢查本機 Helix Runtime',
    emptyCopy: '請稍候；若你還沒啟動 runtime，接下來會看到 attach-first 的導引。',
    guide: '桌面殼正在檢查 runtime 狀態；這版不會自動 spawn 新進程。'
  },
  unavailable: {
    badge: ['error', 'Runtime 未啟動'],
    detail: '尚未連到 http://127.0.0.1:18860/api/health',
    hint: '目前是 attach-first：先手動啟動 runtime，再回來重新檢查。',
    emptyTitle: '等待本機 Helix Runtime',
    emptyCopy: '先在 terminal 執行 helix init / helix login / helix start --port 18860，桌面殼才會接上 Console。',
    guide: '這個 prototype 不自動起 runtime；請先跑 helix start --port 18860。'
  },
  ready: {
    badge: ['ok', 'Runtime 可連線'],
    detail: '已找到 http://127.0.0.1:18860/v2/',
    hint: '本機 runtime 已就緒。可直接載入內嵌 Console，或改用瀏覽器版。',
    emptyTitle: 'Runtime 已就緒',
    emptyCopy: '你可以按「載入 Console」直接在桌面殼開啟，或按「開瀏覽器版」切到系統瀏覽器。',
    guide: 'runtime 已 ready；下一步是載入 /v2/。'
  },
  loading: {
    badge: ['waiting', '載入中…'],
    detail: '正在把 /v2/ 載進桌面殼',
    hint: '若長時間沒成功，這代表 iframe 載入流程有問題，不是 runtime 一定壞掉。',
    emptyTitle: '載入 Helix Console 中',
    emptyCopy: '桌面殼已偵測到 runtime，正在載入 /v2/。',
    guide: '若卡住，可先按重新檢查，再試一次載入。'
  },
  load_failed: {
    badge: ['error', '載入失敗'],
    detail: 'Console iframe 沒成功載入；可先改開瀏覽器版確認 /v2/ 是否正常。',
    hint: '這一態代表 shell / iframe 有問題，不等於 runtime 一定掛掉。',
    emptyTitle: 'Console 載入失敗',
    emptyCopy: '建議先按「開瀏覽器版」確認 /v2/ 正常，再回來看 desktop shell。',
    guide: '可先切瀏覽器版做 truth check，再回來看 Tauri shell。'
  }
};

function renderState(stateKey, override = {}) {
  const state = { ...VIEW_STATE[stateKey], ...override };
  const [kind, title] = state.badge;
  runtimeStatus.className = `status ${kind}`;
  runtimeStatus.textContent = title;
  runtimeDetail.textContent = state.detail;
  statusHint.textContent = state.hint;
  emptyTitle.textContent = state.emptyTitle;
  emptyCopy.textContent = state.emptyCopy;
  guideCopy.textContent = state.guide;
  console.log('[helix-desktop]', { stateKey, state });
}

function setConsoleVisible(visible) {
  frame.hidden = !visible;
  emptyState.hidden = visible;
}

async function copyStartCommand() {
  try {
    await navigator.clipboard.writeText(START_COMMAND);
    copyBtn.textContent = '已複製指令';
    setTimeout(() => {
      copyBtn.textContent = '複製啟動指令';
    }, 1600);
  } catch (error) {
    console.log('[helix-desktop] copy failed', String(error));
    copyBtn.textContent = '複製失敗';
    setTimeout(() => {
      copyBtn.textContent = '複製啟動指令';
    }, 1600);
  }
}

async function openBrowserVersion() {
  if (!runtimeReady) return;
  try {
    await invoke('open_in_browser', { url: runtimeUrl });
  } catch (error) {
    console.log('[helix-desktop] open browser failed', String(error));
    renderState('load_failed', {
      detail: `開瀏覽器版失敗：${String(error)}`,
      emptyCopy: '請先確認系統的 open / xdg-open / start 可用，再重試。'
    });
    setConsoleVisible(false);
  }
}

async function checkRuntime() {
  renderState('checking');
  setConsoleVisible(false);
  loadBtn.disabled = true;
  browserBtn.disabled = true;
  runtimeReady = false;
  frame.src = 'about:blank';

  if (!invoke) {
    renderState('load_failed', {
      detail: '目前不是 Tauri webview，請用 npm run tauri:dev 啟動',
      hint: '只有在 Tauri webview 裡，這些 native actions 才會成立。',
      emptyTitle: '僅能在 Tauri 內運作',
      emptyCopy: '請不要把這頁當一般瀏覽器頁；請回 repo root 跑 npm run tauri:dev。',
      guide: '這是 native-shell prototype，不是單純靜態頁。'
    });
    return;
  }

  try {
    const result = await invoke('check_runtime');
    runtimeUrl = result.url;
    runtimeReady = result.reachable;

    if (result.reachable) {
      renderState('ready', {
        detail: `已找到 ${result.url}`
      });
      loadBtn.disabled = false;
      browserBtn.disabled = false;
    } else {
      renderState('unavailable', {
        detail: `尚未連到 ${result.url.replace('/v2/', '/api/health')}`
      });
    }
  } catch (error) {
    renderState('load_failed', {
      detail: `檢查失敗：${String(error)}`,
      emptyTitle: 'Runtime 狀態檢查失敗',
      emptyCopy: '先看 terminal log，再判斷是 Tauri shell 問題還是 runtime 檢查問題。'
    });
  }
}

function loadConsole() {
  if (!runtimeReady) return;
  renderState('loading');
  setConsoleVisible(true);
  frame.src = runtimeUrl;
}

frame.addEventListener('load', () => {
  if (!frame.hidden && runtimeReady) {
    renderState('ready', {
      detail: `已載入 ${runtimeUrl}`,
      hint: '內嵌 Console 已載入完成；若內容不對，再回頭檢查 /v2/ 自身畫面。'
    });
  }
});

frame.addEventListener('error', () => {
  renderState('load_failed');
  setConsoleVisible(false);
});

refreshBtn.addEventListener('click', checkRuntime);
loadBtn.addEventListener('click', loadConsole);
browserBtn.addEventListener('click', openBrowserVersion);
copyBtn.addEventListener('click', copyStartCommand);
window.addEventListener('DOMContentLoaded', checkRuntime);
