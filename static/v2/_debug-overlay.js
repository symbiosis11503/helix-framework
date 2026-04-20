/**
 * _debug-overlay.js — Stage 4 D2 (production: truth-state + copy snapshot, persisted toggle)
 *
 * Drop-in script: include in any v2/*.html via:
 *   <script src="/v2/_debug-overlay.js"></script>
 *
 * Press "?" to toggle overlay (persisted in localStorage `_sbs_debug_visible`).
 *
 * Tracks:
 *   - hydrate state (DOMContentLoaded / load timing)
 *   - console errors (last 50)
 *   - failed network requests (last 50)
 *   - truth-state per URL (200 OK | 401 token-gated | 404 missing | 5xx server error)
 *
 * Buttons:
 *   - Copy snapshot — JSON debug bundle to clipboard (for bug reports)
 *   - Clear         — reset captured state (keeps overlay open)
 */
(() => {
  if (window.__sbsDebugOverlay) return;
  window.__sbsDebugOverlay = true;

  const LS_VIS = '_sbs_debug_visible';
  const persistedVisible = (() => { try { return localStorage.getItem(LS_VIS) === '1'; } catch { return false; } })();

  const state = {
    consoleErrors: [],
    failedRequests: [],
    truthState: new Map(), // url → { status, classification, count, last_ts }
    visible: persistedVisible,
    hydrate: { dcl: null, load: null },
  };

  function classify(status) {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'missing';
    if (status >= 500) return 'server';
    if (status === 'NET_FAIL') return 'network';
    return 'other';
  }

  function recordTruth(url, status) {
    if (!url) return;
    const key = url.replace(/\?.*$/, ''); // dedupe by path, ignore query
    const cur = state.truthState.get(key) || { status, classification: classify(status), count: 0 };
    cur.status = status;
    cur.classification = classify(status);
    cur.count = (cur.count || 0) + 1;
    cur.last_ts = Date.now();
    state.truthState.set(key, cur);
  }

  // Capture console.error
  const origError = console.error;
  console.error = function (...a) {
    state.consoleErrors.push({ ts: Date.now(), msg: a.map(x => String(x).slice(0, 200)).join(' ') });
    if (state.consoleErrors.length > 50) state.consoleErrors.shift();
    if (state.visible) render();
    return origError.apply(this, a);
  };

  // Capture every fetch (success + fail) for truth-state map
  const origFetch = window.fetch;
  window.fetch = function (...a) {
    const url = typeof a[0] === 'string' ? a[0] : (a[0]?.url || '');
    return origFetch.apply(this, a).then(r => {
      recordTruth(r.url || url, r.status);
      if (!r.ok) {
        state.failedRequests.push({ ts: Date.now(), url: r.url || url, status: r.status });
        if (state.failedRequests.length > 50) state.failedRequests.shift();
      }
      if (state.visible) render();
      return r;
    }).catch(e => {
      recordTruth(url, 'NET_FAIL');
      state.failedRequests.push({ ts: Date.now(), url, status: 'NET_FAIL', error: e.message });
      if (state.visible) render();
      throw e;
    });
  };

  // Hydrate timing
  document.addEventListener('DOMContentLoaded', () => { state.hydrate.dcl = performance.now() | 0; });
  window.addEventListener('load', () => { state.hydrate.load = performance.now() | 0; });

  // Build overlay
  const ov = document.createElement('div');
  ov.id = '_sbs_debug_overlay';
  ov.style.cssText = 'position:fixed;bottom:8px;right:8px;width:420px;max-height:70vh;overflow:auto;background:rgba(20,20,28,0.94);color:#dde;border:1px solid #444;border-radius:6px;font:12px/1.4 ui-monospace,Menlo,monospace;padding:10px;z-index:99999;display:none;box-shadow:0 4px 14px rgba(0,0,0,0.4)';

  function classColor(c) {
    return { ok: '#7c8', auth: '#fc6', missing: '#f97', server: '#f55', network: '#f55', other: '#999' }[c] || '#999';
  }

  function snapshot() {
    return {
      ts: new Date().toISOString(),
      url: location.href,
      ua: navigator.userAgent,
      hydrate: state.hydrate,
      console_errors: state.consoleErrors.slice(),
      failed_requests: state.failedRequests.slice(),
      truth_state: Object.fromEntries(state.truthState),
    };
  }

  async function copySnapshot() {
    const json = JSON.stringify(snapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      const btn = document.getElementById('_sbs_debug_copy');
      if (btn) { const orig = btn.textContent; btn.textContent = '✓ copied'; setTimeout(() => btn.textContent = orig, 1500); }
    } catch {
      // fallback: log
      console.log('[debug snapshot]\n' + json);
      alert('clipboard blocked — snapshot dumped to console');
    }
  }

  function clearState() {
    state.consoleErrors.length = 0;
    state.failedRequests.length = 0;
    state.truthState.clear();
    render();
  }

  function render() {
    const ce = state.consoleErrors;
    const fr = state.failedRequests;
    const ts = [...state.truthState.entries()].sort((a, b) => (b[1].last_ts || 0) - (a[1].last_ts || 0)).slice(0, 12);

    ov.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <strong style="color:#fb6">debug overlay</strong>
        <span style="display:flex;gap:6px">
          <button id="_sbs_debug_copy" style="background:#346;color:#fff;border:0;padding:2px 8px;border-radius:3px;cursor:pointer;font:11px ui-monospace">Copy snapshot</button>
          <button id="_sbs_debug_clear" style="background:#533;color:#fff;border:0;padding:2px 8px;border-radius:3px;cursor:pointer;font:11px ui-monospace">Clear</button>
          <span style="color:#888">press <code>?</code> to close</span>
        </span>
      </div>
      <div>URL: <code style="color:#8be">${location.pathname}</code></div>
      <div>hydrate: DCL=${state.hydrate.dcl ?? '?'}ms · load=${state.hydrate.load ?? '?'}ms</div>
      <div>console errors: <strong style="color:${ce.length ? '#f76' : '#7c8'}">${ce.length}</strong> · failed reqs: <strong style="color:${fr.length ? '#f76' : '#7c8'}">${fr.length}</strong></div>
      ${ts.length ? `
        <div style="margin-top:8px"><strong>truth-state (recent ${ts.length}):</strong>
          <table style="width:100%;border-collapse:collapse;margin-top:3px;font-size:11px">
            ${ts.map(([url, info]) => `<tr>
              <td style="color:${classColor(info.classification)};padding:1px 4px;width:50px">${info.status}</td>
              <td style="color:#888;padding:1px 4px;width:42px">${info.classification}</td>
              <td style="color:#aab;padding:1px 4px"><code>${url.replace(/^https?:\/\/[^/]+/, '').slice(0, 48)}</code></td>
              <td style="color:#666;padding:1px 4px;text-align:right">×${info.count}</td>
            </tr>`).join('')}
          </table>
        </div>` : ''}
      ${ce.length ? `<div style="margin-top:8px"><strong>last 5 console.error:</strong><ul style="padding-left:14px;margin:4px 0">${ce.slice(-5).map(e => `<li>${e.msg.replace(/</g, '&lt;')}</li>`).join('')}</ul></div>` : ''}
      ${fr.length ? `<div style="margin-top:6px"><strong>last 5 failed:</strong><ul style="padding-left:14px;margin:4px 0">${fr.slice(-5).map(r => `<li>${r.status} <code>${(r.url || '').slice(0, 50)}</code></li>`).join('')}</ul></div>` : ''}
      <div style="margin-top:8px;color:#888">UA: ${navigator.userAgent.slice(0, 90)}…</div>
    `;

    document.getElementById('_sbs_debug_copy')?.addEventListener('click', copySnapshot);
    document.getElementById('_sbs_debug_clear')?.addEventListener('click', clearState);
  }

  function setVisible(v) {
    state.visible = v;
    ov.style.display = v ? 'block' : 'none';
    try { localStorage.setItem(LS_VIS, v ? '1' : '0'); } catch {}
    if (v) render();
  }

  document.addEventListener('keydown', e => {
    if (e.key === '?' && !e.target.matches('input,textarea,[contenteditable=true]')) {
      setVisible(!state.visible);
    }
  });

  if (document.body) {
    document.body.appendChild(ov);
    if (persistedVisible) setVisible(true);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(ov);
      if (persistedVisible) setVisible(true);
    });
  }
})();
