import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

try {
  process.chdir(os.tmpdir());
} catch (_) {}

const scriptsDir = path.join(__dirname, '..', '..', 'scripts');
const runtimeScriptPath = path.join(scriptsDir, 'zh_cn_runtime.js');
const configPath = path.join(os.homedir(), '.gemini', 'antigravity', 'translation_config.json');
const cachePath = path.join(os.homedir(), '.gemini', 'antigravity', 'title_api_cache.json');
const pidFile = path.join(os.tmpdir(), 'agy_zh_cn_sidecar.pid');

try {
  if (fs.existsSync(pidFile)) {
    const oldPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isInteger(oldPid) && oldPid > 0 && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 'SIGTERM');
      } catch (_) {}
    }
  }
  fs.writeFileSync(pidFile, String(process.pid), 'utf8');
} catch (_) {}

function cleanupPidFile() {
  try {
    if (fs.existsSync(pidFile)) {
      const cur = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (cur === process.pid) {
        fs.unlinkSync(pidFile);
      }
    }
  } catch (_) {}
}

function ensureAsarBootHook() {
  try {
    const bootHook = require(path.join(scriptsDir, 'install_boot_hook.js'));
    if (
      bootHook &&
      bootHook.asarPath &&
      fs.existsSync(bootHook.asarPath) &&
      fs.statSync(bootHook.asarPath).size > 1000000 &&
      !bootHook.isAsarPatched(bootHook.asarPath)
    ) {
      bootHook.install(false);
      return true;
    }
  } catch (_) {}
  return false;
}

function getDevToolsPortFile() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Antigravity', 'DevToolsActivePort');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  }
  return path.join(os.homedir(), '.config', 'Antigravity', 'DevToolsActivePort');
}

function readDevToolsPort() {
  const portFile = getDevToolsPortFile();
  if (!fs.existsSync(portFile)) return null;
  try {
    const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    const port = parseInt(lines[0], 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch (_) {
    return null;
  }
}

function fetchMainTarget(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const targets = JSON.parse(raw);
          const page = targets.find(
            (t) =>
              t.type === 'page' &&
              t.webSocketDebuggerUrl &&
              t.url &&
              t.url !== 'about:blank' &&
              !String(t.url).startsWith('devtools://') &&
              !String(t.url).startsWith('data:')
          );
          resolve(page || null);
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2500, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function isTitleTranslateConfigEnabled() {
  if (process.env.AGY_DISABLE_REMOTE_TRANSLATE === '1' || process.env.AGY_OFFLINE === '1') {
    return false;
  }
  if (process.env.AGY_ENABLE_REMOTE_TITLE_TRANSLATION === '1') return true;
  try {
    if (fs.existsSync(configPath)) {
      const json = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return Boolean(json.enableRemoteTitleTranslation);
    }
  } catch (_) {}
  return false;
}

function saveTitleTranslateConfig(enabled) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let current = {};
    if (fs.existsSync(configPath)) {
      current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    current.enableRemoteTitleTranslation = Boolean(enabled);
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2), 'utf8');
    process.env.AGY_ENABLE_REMOTE_TITLE_TRANSLATION = enabled ? '1' : '0';
  } catch (_) {}
}

function buildInjectionScript() {
  if (!fs.existsSync(runtimeScriptPath)) return '';
  let prefix = '';
  try {
    if (fs.existsSync(cachePath)) {
      const safeJson = JSON.stringify(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
      prefix += `try{window.__AGY_TITLE_CACHE__=Object.assign(window.__AGY_TITLE_CACHE__||{},${safeJson});}catch(_){}\n`;
    }
  } catch (_) {}
  const enabled = isTitleTranslateConfigEnabled();
  const runtimeCode = fs.readFileSync(runtimeScriptPath, 'utf8');
  return `${prefix}${runtimeCode}\n;try{window.__AGY_I18N__&&window.__AGY_I18N__.syncConfigFromMain(${enabled});}catch(_){}`;
}

function loadPluginUpdater() {
  const updaterPath = path.join(scriptsDir, 'plugin_updater.js');
  if (!fs.existsSync(updaterPath)) return null;
  try {
    delete require.cache[require.resolve(updaterPath)];
    return require(updaterPath);
  } catch (_) {
    return null;
  }
}

class ZhCnSidecarBridge {
  constructor() {
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.activePort = null;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.updateActionInFlight = false;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket not open'));
      }
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        return reject(err);
      }
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 8000);
    });
  }

  evaluate(expression) {
    return this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
  }

  async injectIfNeeded(force = false) {
    const code = buildInjectionScript();
    if (!code) return;
    const expr = force
      ? code
      : `try{if(!window.__AGY_I18N__){${code}}}catch(_){}`;
    await this.evaluate(expr).catch(() => {});
    try {
      const { injectLive } = require(path.join(scriptsDir, 'inject_live.js'));
      if (typeof injectLive === 'function') {
        injectLive('apply', 1, 200).catch(() => {});
      }
    } catch (_) {}
  }

  async handleConsoleMessage(text) {
    if (typeof text !== 'string') return;
    if (
      !text.startsWith('__AGY_CONFIG_SYNC__:') &&
      !text.startsWith('__AGY_UPDATE_ACTION__:') &&
      !text.startsWith('__AGY_TITLE_CACHE_PUT__:')
    ) {
      return;
    }

    // 若主进程 boot hook 已处于激活状态，交由主进程处理，避免重复响应
    try {
      const checkRes = await this.evaluate('Boolean(window.__AGY_MAIN_BOOT_HOOK_ACTIVE__)');
      if (checkRes && checkRes.result && checkRes.result.value === true) {
        return;
      }
    } catch (_) {}

    if (text.startsWith('__AGY_CONFIG_SYNC__:')) {
      try {
        const data = JSON.parse(text.slice('__AGY_CONFIG_SYNC__:'.length));
        if (typeof data.enableRemoteTitleTranslation !== 'undefined') {
          const nextEnabled = Boolean(data.enableRemoteTitleTranslation);
          saveTitleTranslateConfig(nextEnabled);
          if (nextEnabled) {
            try {
              const { syncHistoricalTitles } = require(path.join(scriptsDir, 'sync_historical_titles.js'));
              const { getCacheMap } = require(path.join(scriptsDir, 'api_translator.js'));
              Promise.resolve(syncHistoricalTitles()).then(() => {
                const cacheJson = JSON.stringify(getCacheMap() || {});
                this.evaluate(`try{window.__AGY_I18N__&&window.__AGY_I18N__.updateTitleCache&&window.__AGY_I18N__.updateTitleCache(${cacheJson});}catch(_){}`).catch(() => {});
              }).catch(() => {});
            } catch (_) {}
          }
        }
      } catch (_) {}
      return;
    }

    if (text.startsWith('__AGY_TITLE_CACHE_PUT__:')) {
      try {
        const data = JSON.parse(text.slice('__AGY_TITLE_CACHE_PUT__:'.length));
        const orig = data && typeof data.original === 'string' ? data.original.trim() : '';
        let trans = data && typeof data.translated === 'string' ? data.translated.trim() : '';
        if (orig && trans) {
          const root = path.join(os.homedir(), '.gemini', 'antigravity');
          try {
            const { resolveSkillOverrideForTitle } = require(path.join(scriptsDir, 'sync_historical_titles.js'));
            const override = await resolveSkillOverrideForTitle(root, orig);
            if (override && override !== trans) {
              trans = override;
              this.evaluate(`try{window.__AGY_I18N__&&window.__AGY_I18N__.updateTitleCache&&window.__AGY_I18N__.updateTitleCache(${JSON.stringify({ [orig]: trans })});}catch(_){}`).catch(() => {});
            }
          } catch (_) {}
          try {
            const { setCachedTranslation } = require(path.join(scriptsDir, 'api_translator.js'));
            setCachedTranslation(orig, trans);
          } catch (_) {}
        }
      } catch (_) {}
      return;
    }

    if (text.startsWith('__AGY_UPDATE_ACTION__:')) {
      let reqData = {};
      try {
        reqData = JSON.parse(text.slice('__AGY_UPDATE_ACTION__:'.length)) || {};
      } catch (_) {
        return;
      }
      const action = reqData.action;
      const requestId = reqData.requestId || '';
      const sendEvent = (payload) => {
        this.evaluate(
          `try{window.__AGY_I18N__&&window.__AGY_I18N__.handleUpdateEvent&&window.__AGY_I18N__.handleUpdateEvent(${JSON.stringify(payload)});}catch(_){}`
        ).catch(() => {});
      };

      if (this.updateActionInFlight) {
        sendEvent({
          type: action === 'update' ? 'updated' : 'check',
          requestId,
          ok: false,
          error: '已有更新任务正在进行中'
        });
        return;
      }

      const updater = loadPluginUpdater();
      if (!updater) {
        sendEvent({
          type: action === 'update' ? 'updated' : 'check',
          requestId,
          ok: false,
          error: '未找到更新模块 plugin_updater.js'
        });
        return;
      }

      this.updateActionInFlight = true;
      try {
        if (action === 'check') {
          const res = await updater.checkForUpdates();
          sendEvent(Object.assign({ type: 'check', requestId }, res));
        } else if (action === 'update') {
          const res = await updater.performUpdate();
          if (res && res.ok) {
            ensureAsarBootHook();
            await this.injectIfNeeded(true);
          }
          sendEvent(Object.assign({ type: 'updated', requestId }, res));
        }
      } catch (err) {
        sendEvent({
          type: action === 'update' ? 'updated' : 'check',
          requestId,
          ok: false,
          error: err && err.message ? err.message : '操作失败'
        });
      } finally {
        this.updateActionInFlight = false;
      }
    }
  }

  async connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      ensureAsarBootHook();
      const port = readDevToolsPort();
      if (!port) {
        this.isConnecting = false;
        this.scheduleReconnect(2000);
        return;
      }

      const target = await fetchMainTarget(port);
      if (!target || !target.webSocketDebuggerUrl) {
        this.isConnecting = false;
        this.scheduleReconnect(2000);
        return;
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.activePort === port) {
        this.isConnecting = false;
        return;
      }

      this.closeSocket();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      this.ws = ws;
      this.activePort = port;

      ws.onopen = async () => {
        this.isConnecting = false;
        try {
          await this.send('Runtime.enable');
          await this.send('Page.enable');
          const code = buildInjectionScript();
          if (code) {
            await this.send('Page.addScriptToEvaluateOnNewDocument', {
              source: `try{if(!window.__AGY_I18N__){${code}}}catch(_){}`
            }).catch(() => {});
          }
          await this.injectIfNeeded(false);
        } catch (_) {}
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message || 'CDP Error'));
            else resolve(msg.result);
            return;
          }

          if (
            msg.method === 'Page.frameNavigated' ||
            msg.method === 'Page.loadEventFired' ||
            msg.method === 'Page.navigatedWithinDocument'
          ) {
            this.injectIfNeeded(false);
          }

          if (msg.method === 'Runtime.consoleAPICalled' && msg.params && Array.isArray(msg.params.args)) {
            const firstArg = msg.params.args[0];
            if (firstArg && typeof firstArg.value === 'string') {
              this.handleConsoleMessage(firstArg.value);
            }
          }
        } catch (_) {}
      };

      ws.onclose = () => {
        this.isConnecting = false;
        this.closeSocket();
        this.scheduleReconnect(1200);
      };

      ws.onerror = () => {
        this.isConnecting = false;
        this.closeSocket();
        this.scheduleReconnect(1200);
      };
    } catch (_) {
      this.isConnecting = false;
      this.scheduleReconnect(2000);
    }
  }

  scheduleReconnect(ms) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connect();
      }
    }, ms);
  }

  closeSocket() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    for (const { reject } of this.pending.values()) {
      try {
        reject(new Error('Socket closed'));
      } catch (_) {}
    }
    this.pending.clear();
  }

  start() {
    ensureAsarBootHook();
    this.connect();
    setInterval(() => {
      ensureAsarBootHook();
      if (!this.isConnecting && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        this.connect();
      }
    }, 5000);
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.closeSocket();
  }
}

const bridge = new ZhCnSidecarBridge();
bridge.start();

process.on('SIGINT', () => {
  cleanupPidFile();
  bridge.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupPidFile();
  bridge.stop();
  process.exit(0);
});

process.on('exit', () => {
  cleanupPidFile();
});
