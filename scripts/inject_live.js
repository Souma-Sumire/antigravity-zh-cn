const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const runtimeScriptPath = path.join(__dirname, 'zh_cn_runtime.js');
const devToolsPortFile = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Antigravity',
  'DevToolsActivePort'
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 2500 }, (res) => {
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
      clearTimeout(timer);
      try {
        const data = JSON.parse(String(event.data));
        ws.close();
        resolve(data);
      } catch (e) {
        ws.close();
        reject(e);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

async function injectOnce(action = 'apply') {
  if (!fs.existsSync(devToolsPortFile)) {
    throw new Error('DevToolsActivePort not found');
  }

  const lines = fs.readFileSync(devToolsPortFile, 'utf8').trim().split(/\r?\n/);
  const port = parseInt(lines[0], 10);
  if (!port || isNaN(port)) {
    throw new Error('Invalid port in DevToolsActivePort');
  }

  const runtimeCode = fs.readFileSync(runtimeScriptPath, 'utf8');
  let expr = runtimeCode + '\n;window.__AGY_I18N__ && (window.__AGY_I18N__.apply(), window.__AGY_I18N__.getStats());';
  if (action === 'toggle') {
    expr = runtimeCode + '\n;window.__AGY_I18N__ && (window.__AGY_I18N__.toggle(), window.__AGY_I18N__.getStats());';
  } else if (action === 'en') {
    expr = runtimeCode + '\n;window.__AGY_I18N__ && (window.__AGY_I18N__.setLanguage("en-US"), window.__AGY_I18N__.getStats());';
  } else if (action === 'zh') {
    expr = runtimeCode + '\n;window.__AGY_I18N__ && (window.__AGY_I18N__.setLanguage("zh-CN"), window.__AGY_I18N__.getStats());';
  }

  const targets = await httpGetJson(port, '/json/list');
  const pages = targets.filter(
    (t) =>
      t.type === 'page' &&
      t.webSocketDebuggerUrl &&
      t.url &&
      t.url !== 'about:blank' &&
      !String(t.url).startsWith('devtools://') &&
      !String(t.url).startsWith('data:')
  );

  if (pages.length === 0) {
    throw new Error('No active renderer page targets ready');
  }

  const results = [];
  for (const page of pages) {
    try {
      const res = await evalInTarget(page.webSocketDebuggerUrl, expr);
      if (res && res.result && res.result.exceptionDetails) {
        console.error('Exception in target:', page.url, res.result.exceptionDetails.text);
      } else {
        const val = res && res.result && res.result.result ? res.result.result.value : null;
        results.push({ title: page.title || page.url, stats: val });
      }
    } catch (_) {}
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
