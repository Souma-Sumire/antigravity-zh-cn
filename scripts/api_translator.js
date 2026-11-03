'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const tls = require('tls');
const { URL } = require('url');

const CACHE_FILE = path.join(os.homedir(), '.gemini', 'antigravity', 'title_api_cache.json');

let memoryCache = {};
try {
  if (fs.existsSync(CACHE_FILE)) {
    memoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
} catch (_) {
  memoryCache = {};
}

function saveCache() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(memoryCache, null, 2), 'utf8');
  } catch (_) {}
}

function formatPangu(text) {
  if (!text) return text;
  return text
    .replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, '$1 $2')
    .replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, '$1 $2')
    .trim();
}

function getProxyConfig() {
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;

  if (envProxy) {
    try {
      const url = new URL(
        envProxy.startsWith('http://') || envProxy.startsWith('https://') || envProxy.startsWith('socks5://')
          ? envProxy
          : `http://${envProxy}`
      );
      if (url.protocol === 'socks5:') {
        return null;
      }
      return {
        protocol: url.protocol,
        host: url.hostname || '127.0.0.1',
        port: parseInt(url.port, 10) || 7890
      };
    } catch (_) {}
  }

  return null;
}

function requestMicrosoftTranslate(texts, proxyConfig) {
  return new Promise((resolve, reject) => {
    const isSingle = typeof texts === 'string';
    const list = isSingle ? [texts] : texts;
    const postData = JSON.stringify(list);
    const targetHost = 'edge.microsoft.com';
    const apiPath = '/translate/translatetext?to=zh-Hans';

    const handleResponse = (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (Array.isArray(json)) {
            const results = json.map((item) =>
              item && Array.isArray(item.translations) && item.translations[0] ? item.translations[0].text : ''
            );
            resolve(isSingle ? results[0] : results);
          } else {
            reject(new Error(`Microsoft API parse error: ${body.slice(0, 100)}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    };

    if (proxyConfig && proxyConfig.host && proxyConfig.port) {
      const connectReq = http.request({
        host: proxyConfig.host,
        port: proxyConfig.port,
        method: 'CONNECT',
        path: `${targetHost}:443`,
        timeout: 4000
      });

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Proxy CONNECT rejected: ${res.statusCode}`));
        }

        const tlsSocket = tls.connect(
          {
            socket,
            servername: targetHost,
            rejectUnauthorized: true
          },
          () => {
            const req = https.request(
              {
                host: targetHost,
                path: apiPath,
                method: 'POST',
                createConnection: () => tlsSocket,
                headers: {
                  Host: targetHost,
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(postData),
                  'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
                },
                timeout: 5000
              },
              handleResponse
            );

            req.on('error', reject);
            req.on('timeout', () => {
              req.destroy();
              reject(new Error('Microsoft request timeout'));
            });
            req.write(postData);
            req.end();
          }
        );

        tlsSocket.on('error', reject);
      });

      connectReq.on('error', reject);
      connectReq.on('timeout', () => {
        connectReq.destroy();
        reject(new Error('Proxy connect timeout'));
      });
      connectReq.end();
    } else {
      const req = https.request(
        {
          host: targetHost,
          path: apiPath,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
          },
          timeout: 5000
        },
        handleResponse
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Direct Microsoft request timeout'));
      });
      req.write(postData);
      req.end();
    }
  });
}

function requestGoogleTranslate(text, proxyConfig) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(text);
    const targetHost = 'clients5.google.com';
    const apiPath = `/translate_a/t?client=dict-chrome-ex&sl=auto&tl=zh-CN&q=${q}`;

    const handleResponse = (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (Array.isArray(json) && json[0] && typeof json[0][0] === 'string') {
            resolve(json[0][0]);
          } else {
            reject(new Error(`Google API parse error: ${body.slice(0, 100)}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    };

    if (proxyConfig && proxyConfig.host && proxyConfig.port) {
      const connectReq = http.request({
        host: proxyConfig.host,
        port: proxyConfig.port,
        method: 'CONNECT',
        path: `${targetHost}:443`,
        timeout: 4000
      });

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Proxy CONNECT rejected: ${res.statusCode}`));
        }

        const tlsSocket = tls.connect(
          {
            socket,
            servername: targetHost,
            rejectUnauthorized: true
          },
          () => {
            const req = https.request(
              {
                host: targetHost,
                path: apiPath,
                createConnection: () => tlsSocket,
                headers: {
                  Host: targetHost,
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 5000
              },
              handleResponse
            );

            req.on('error', reject);
            req.on('timeout', () => {
              req.destroy();
              reject(new Error('Google request timeout'));
            });
            req.end();
          }
        );

        tlsSocket.on('error', reject);
      });

      connectReq.on('error', reject);
      connectReq.on('timeout', () => {
        connectReq.destroy();
        reject(new Error('Proxy connect timeout'));
      });
      connectReq.end();
    } else {
      const req = https.request(
        {
          host: targetHost,
          path: apiPath,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 5000
        },
        handleResponse
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Direct Google request timeout'));
      });
      req.end();
    }
  });
}

function requestMyMemory(text, proxyConfig) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(text);
    const targetHost = 'api.mymemory.translated.net';
    const apiPath = `/get?q=${q}&langpair=en|zh-CN`;

    const handleResponse = (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json && json.responseData && json.responseData.translatedText) {
            resolve(json.responseData.translatedText);
          } else {
            reject(new Error(`MyMemory API error: ${body.slice(0, 100)}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    };

    if (proxyConfig && proxyConfig.host && proxyConfig.port) {
      const connectReq = http.request({
        host: proxyConfig.host,
        port: proxyConfig.port,
        method: 'CONNECT',
        path: `${targetHost}:443`,
        timeout: 4000
      });

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Proxy CONNECT rejected: ${res.statusCode}`));
        }

        const tlsSocket = tls.connect(
          {
            socket,
            servername: targetHost,
            rejectUnauthorized: true
          },
          () => {
            const req = https.request(
              {
                host: targetHost,
                path: apiPath,
                createConnection: () => tlsSocket,
                headers: {
                  Host: targetHost,
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 5000
              },
              handleResponse
            );

            req.on('error', reject);
            req.on('timeout', () => {
              req.destroy();
              reject(new Error('MyMemory request timeout'));
            });
            req.end();
          }
        );

        tlsSocket.on('error', reject);
      });

      connectReq.on('error', reject);
      connectReq.on('timeout', () => {
        connectReq.destroy();
        reject(new Error('Proxy connect timeout'));
      });
      connectReq.end();
    } else {
      const req = https.request(
        {
          host: targetHost,
          path: apiPath,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 5000
        },
        handleResponse
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Direct MyMemory timeout'));
      });
      req.end();
    }
  });
}

const PROTECTED_TERMS = [
  [/GitHub\s*Actions?/gi, 'GitHub Actions'],
  [/Readme/gi, 'README'],
  [/FFXIV/gi, 'FFXIV'],
  [/UI\/UX/gi, 'UI/UX'],
  [/Antigravity/gi, 'Antigravity']
];

function applyTermProtection(text) {
  let res = text;
  for (const [re, rep] of PROTECTED_TERMS) {
    res = res.replace(re, rep);
  }
  return res;
}

const inFlight = new Map();

async function translateWithApi(text) {
  if (!text || typeof text !== 'string') return text;
  const raw = text.trim();
  if (!raw) return raw;
  if (process.env.AGY_DISABLE_REMOTE_TRANSLATE === '1' || process.env.AGY_OFFLINE === '1') {
    return raw;
  }

  if (memoryCache[raw]) {
    return memoryCache[raw];
  }

  if (inFlight.has(raw)) {
    return inFlight.get(raw);
  }

  const task = (async () => {
    try {
      const proxy = getProxyConfig();
      let trans = '';

      // 1. 优先尝试微软 Edge 官方翻译接口（直连或走代理均可）
      try {
        trans = await requestMicrosoftTranslate(raw, null);
      } catch (_) {
        if (proxy) {
          try {
            trans = await requestMicrosoftTranslate(raw, proxy);
          } catch (_) {}
        }
      }

      // 2. 若微软翻译未成功，降级尝试 Google 官方专用翻译接口
      if (!trans || trans === raw) {
        try {
          trans = await requestGoogleTranslate(raw, proxy);
        } catch (_) {
          if (proxy) {
            try {
              trans = await requestGoogleTranslate(raw, null);
            } catch (_) {}
          }
        }
      }

      // 3. 若均未成功，降级至 MyMemory
      if (!trans || trans === raw) {
        try {
          trans = await requestMyMemory(raw, proxy);
        } catch (_) {
          if (proxy) {
            try {
              trans = await requestMyMemory(raw, null);
            } catch (_) {}
          }
        }
      }

      if (trans && trans !== raw) {
        trans = trans.replace(/[。，.]$/, '').trim();
        trans = applyTermProtection(trans);
        trans = formatPangu(trans);
        memoryCache[raw] = trans;
        saveCache();
        return trans;
      }
      return raw;
    } catch (_) {
      return raw;
    } finally {
      inFlight.delete(raw);
    }
  })();

  inFlight.set(raw, task);
  return task;
}

function getCachedTranslation(text) {
  if (!text) return null;
  const trimmed = text.trim();
  return memoryCache[trimmed] || null;
}

async function translateBatchWithApi(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return {};
  if (process.env.AGY_DISABLE_REMOTE_TRANSLATE === '1' || process.env.AGY_OFFLINE === '1') {
    const directMap = {};
    for (const t of texts) directMap[t] = t;
    return directMap;
  }

  const resultMap = {};
  const toFetch = [];

  for (const raw of texts) {
    if (!raw || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (memoryCache[trimmed]) {
      resultMap[trimmed] = memoryCache[trimmed];
    } else if (!toFetch.includes(trimmed)) {
      toFetch.push(trimmed);
    }
  }

  if (toFetch.length === 0) return resultMap;

  // 优先尝试微软批量直连翻译（每次最多 10 条）
  const batchSize = 10;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const chunk = toFetch.slice(i, i + batchSize);
    let msSuccess = false;
    try {
      const msResults = await requestMicrosoftTranslate(chunk, null);
      if (Array.isArray(msResults) && msResults.length === chunk.length) {
        chunk.forEach((orig, idx) => {
          let line = (msResults[idx] || '').replace(/[。，.]$/, '').trim();
          if (line && line !== orig) {
            line = applyTermProtection(line);
            line = formatPangu(line);
            memoryCache[orig] = line;
            resultMap[orig] = line;
          }
        });
        msSuccess = true;
      }
    } catch (_) {}

    if (!msSuccess) {
      await Promise.all(
        chunk.map(async (item) => {
          const trans = await translateWithApi(item);
          resultMap[item] = trans;
        })
      );
    }
  }

  saveCache();
  return resultMap;
}

module.exports = {
  translateWithApi,
  translateBatchWithApi,
  getCachedTranslation,
  getCacheMap: () => memoryCache,
  formatPangu,
  getProxyConfig,
  requestMicrosoftTranslate,
  requestGoogleTranslate
};
