const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

function resolveDevToolsPortFile() {
  if (process.env.AGY_DEVTOOLS_PORT_FILE) {
    return process.env.AGY_DEVTOOLS_PORT_FILE;
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Antigravity', 'DevToolsActivePort');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  }
  return path.join(os.homedir(), '.config', 'Antigravity', 'DevToolsActivePort');
}

const runtimeScriptPath = path.join(__dirname, 'zh_cn_runtime.js');
const devToolsPortFile = resolveDevToolsPortFile();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 2500, agent: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('HTTP timeout'));
    });
  });
}

function evalInTarget(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') {
      return reject(
        new Error('当前 Node.js 环境未提供全局 WebSocket，实时注入需要 Node.js >= 22 或启动参数带 --experimental-websocket')
      );
    }
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error('WebSocket CDP timeout'));
    }, 4500);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression,
            returnByValue: true,
            awaitPromise: false
          }
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data && data.id === 1) {
          clearTimeout(timer);
          try { ws.close(); } catch (_) {}
          resolve(data);
        }
      } catch (e) {
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        reject(e);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

async function resolveActiveTargetList() {
  const candidates = [];
  const pushPort = (p) => {
    const n = parseInt(p, 10);
    if (Number.isInteger(n) && n > 0 && !candidates.includes(n)) {
      candidates.push(n);
    }
  };

  if (process.env.AGY_CDP_PORT) {
    pushPort(process.env.AGY_CDP_PORT);
  }
  if (fs.existsSync(devToolsPortFile)) {
    try {
      const lines = fs.readFileSync(devToolsPortFile, 'utf8').trim().split(/\r?\n/);
      pushPort(lines[0]);
    } catch (_) {}
  }
  pushPort(9222);

  for (const port of candidates) {
    try {
      const targets = await httpGetJson(port, '/json/list');
      if (Array.isArray(targets)) {
        return { port, targets };
      }
    } catch (_) {}
  }

  throw new Error(
    'DevToolsActivePort not found（Antigravity 2.33.0+ 默认关闭 CDP 调试端口；主进程 Boot Hook 已安装时重启应用即可原生生效，如需热重载请使用 --remote-debugging-port=9222 启动）'
  );
}

function isCandidateTargetUrl(rawUrl, targetType) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  if (rawUrl === 'about:blank' || rawUrl.startsWith('data:') || rawUrl.startsWith('devtools://')) {
    return false;
  }
  try {
    const u = new URL(rawUrl);
    const proto = u.protocol.toLowerCase();
    if (targetType === 'iframe') {
      return proto === 'plugin:';
    }
    if (targetType !== 'page') return false;
    if (proto === 'vscode-file:' || proto === 'vscode-webview:' || proto === 'plugin:' || proto === 'file:') {
      return true;
    }
    if (proto === 'http:' || proto === 'https:') {
      const host = u.hostname.toLowerCase();
      return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
    }
    return false;
  } catch (_) {
    return false;
  }
}

function readTranslationConfig() {
  let enableRemoteTitleTranslation = process.env.AGY_ENABLE_REMOTE_TITLE_TRANSLATION === '1';
  let language = 'zh-CN';
  try {
    const configFile = path.join(os.homedir(), '.gemini', 'antigravity', 'translation_config.json');
    if (fs.existsSync(configFile)) {
      const json = JSON.parse(fs.readFileSync(configFile, 'utf8')) || {};
      if (!enableRemoteTitleTranslation) {
        enableRemoteTitleTranslation = Boolean(json.enableRemoteTitleTranslation);
      }
      if (json.language === 'en-US' || json.language === 'zh-CN') {
        language = json.language;
      }
    }
  } catch (_) {}
  return { enableRemoteTitleTranslation, language };
}

const PREFLIGHT_EXPR = `(function(){try{var loc=globalThis.location,p=String(loc&&loc.protocol||"").toLowerCase(),isPlugin=p==="plugin:",isVscode=p==="vscode-file:"||p==="vscode-webview:",isTop=true;try{isTop=window.self===window.top;}catch(_){isTop=false;}var isHub=isPlugin||isVscode||(isTop&&Boolean(window.electronNative||window.nativeStorage||(typeof document!=="undefined"&&document.querySelector('link[href*="jetbox.css"], .agy-shell, [data-testid="sidebar-split"], [data-testid="settings-button"]'))));var i18n=window.__AGY_I18N__;return {isHub:isHub,isPlugin:isPlugin,loaded:Boolean(i18n),lang:i18n&&i18n.getLanguage?i18n.getLanguage():null};}catch(_){return {isHub:false,isPlugin:false,loaded:false,lang:null};}})()`;

async function injectOnce(action = 'apply') {
  const { targets } = await resolveActiveTargetList();

  let titleCacheJson = '';
  let titleCacheCode = '';
  try {
    const cacheFile = path.join(os.homedir(), '.gemini', 'antigravity', 'title_api_cache.json');
    if (fs.existsSync(cacheFile)) {
      const cacheStr = fs.readFileSync(cacheFile, 'utf8');
      titleCacheJson = JSON.stringify(JSON.parse(cacheStr));
      titleCacheCode = `try{window.__AGY_TITLE_CACHE__=Object.assign(window.__AGY_TITLE_CACHE__||{},${titleCacheJson});}catch(_){}\n`;
    }
  } catch (_) {}

  const cfg = readTranslationConfig();
  const titleTransEnabled = cfg.enableRemoteTitleTranslation;
  const configuredLang = cfg.language;
  const pages = targets.filter(
    (t) => t.webSocketDebuggerUrl && isCandidateTargetUrl(t.url, t.type)
  );

  if (pages.length === 0) {
    throw new Error('No active renderer page targets ready');
  }

  let runtimeCodeCache = null;
  const getFullRuntimeCode = (deferInitApply, initLang) => {
    if (runtimeCodeCache === null) {
      runtimeCodeCache = fs.readFileSync(runtimeScriptPath, 'utf8');
    }
    const flags =
      `try{window.__AGY_INITIAL_LANG__=${JSON.stringify(initLang)};` +
      (deferInitApply ? 'window.__AGY_DEFER_INIT_APPLY__=true;' : '') +
      `window.localStorage.setItem("__agy_enable_remote_title_trans__",${JSON.stringify(titleTransEnabled ? '1' : '0')});}catch(_){}\n`;
    return flags + titleCacheCode + runtimeCodeCache;
  };

  const results = [];
  let eligibleCount = 0;

  for (const page of pages) {
    try {
      const preRes = await evalInTarget(page.webSocketDebuggerUrl, PREFLIGHT_EXPR);
      const preflight = preRes && preRes.result && preRes.result.result ? preRes.result.result.value : null;
      if (!preflight || !preflight.isHub) {
        continue;
      }
      eligibleCount++;

      let expr = '';
      if (action === 'ensure') {
        if (preflight.loaded) {
          if (preflight.isPlugin && preflight.lang !== configuredLang) {
            expr = `window.__AGY_I18N__ && (window.__AGY_I18N__.setLanguage(${JSON.stringify(configuredLang)}, { silent: true }), window.__AGY_I18N__.getStats());`;
          } else {
            expr = `window.__AGY_I18N__ && window.__AGY_I18N__.getStats();`;
          }
        } else {
          expr = getFullRuntimeCode(false, configuredLang) + `\n;window.__AGY_I18N__ && window.__AGY_I18N__.getStats();`;
        }
      } else if (action === 'sync-titles') {
        if (!preflight.loaded) {
          continue;
        }
        if (titleCacheJson && !preflight.isPlugin) {
          expr = `window.__AGY_I18N__ && (window.__AGY_I18N__.updateTitleCache(${titleCacheJson}), window.__AGY_I18N__.getStats());`;
        } else {
          expr = `window.__AGY_I18N__ && window.__AGY_I18N__.getStats();`;
        }
      } else {
        const initLang = action === 'en' ? 'en-US' : action === 'zh' ? 'zh-CN' : configuredLang;
        const runtimeCode = getFullRuntimeCode(true, initLang);
        const syncCfgExpr = `window.__AGY_I18N__&&window.__AGY_I18N__.syncConfigFromMain(${titleTransEnabled}),`;
        const silentArg = preflight.isPlugin ? ', { silent: true }' : '';
        if (action === 'toggle') {
          expr = runtimeCode + `\n;window.__AGY_I18N__ && (${syncCfgExpr} window.__AGY_I18N__.toggle(), window.__AGY_I18N__.getStats());`;
        } else if (action === 'en') {
          expr = runtimeCode + `\n;window.__AGY_I18N__ && (${syncCfgExpr} window.__AGY_I18N__.setLanguage("en-US"${silentArg}), window.__AGY_I18N__.getStats());`;
        } else if (action === 'zh') {
          expr = runtimeCode + `\n;window.__AGY_I18N__ && (${syncCfgExpr} window.__AGY_I18N__.setLanguage("zh-CN"${silentArg}), window.__AGY_I18N__.getStats());`;
        } else {
          expr = runtimeCode + `\n;window.__AGY_I18N__ && (${syncCfgExpr} window.__AGY_I18N__.apply(), window.__AGY_I18N__.getStats());`;
        }
      }

      const res = await evalInTarget(page.webSocketDebuggerUrl, expr);
      if (res && res.result && res.result.exceptionDetails) {
        console.error('Exception in target:', page.url, res.result.exceptionDetails.text);
      } else {
        const val = res && res.result && res.result.result ? res.result.result.value : null;
        results.push({ title: page.title || page.url, stats: val });
      }
    } catch (_) {}
  }

  if (action === 'sync-titles') {
    return results;
  }
  if (eligibleCount === 0) {
    throw new Error('No eligible Antigravity renderer targets ready');
  }
  if (results.length === 0) {
    throw new Error('All targets failed evaluation');
  }
  return results;
}

async function injectLive(action = 'apply', maxRetries = 8, delayMs = 450) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const results = await injectOnce(action);
      return results;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(delayMs);
      }
    }
  }
  throw lastErr || new Error('Live injection failed');
}

module.exports = {
  injectOnce,
  injectLive,
  devToolsPortFile
};

if (require.main === module) {
  const action = process.argv[2] || 'apply';
  const maxRetries = process.argv.includes('--nowait') ? 0 : 8;
  injectLive(action, maxRetries, 450)
    .then((results) => {
      for (const r of results) {
        console.log('Injected into target:', r.title, JSON.stringify(r.stats));
      }
    })
    .catch((err) => {
      console.error('Live injection failed:', err.message || err);
      process.exit(1);
    });
}
