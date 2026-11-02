'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

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

function requestMyMemory(text, useProxy = true) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(text);
    const apiPath = `/get?q=${q}&langpair=en|zh-CN`;
    const proxyPort = 7897;

    const onResponse = (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json && json.responseData && json.responseData.translatedText) {
            resolve(json.responseData.translatedText);
          } else {
            reject(new Error(`API Error: ${body.slice(0, 100)}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    };

    if (useProxy) {
      const connectReq = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'CONNECT',
          path: 'api.mymemory.translated.net:443',
          timeout: 4500
        },
        () => {}
      );

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Proxy CONNECT rejected: ${res.statusCode}`));
        }
        const tlsReq = https.request(
          {
            host: 'api.mymemory.translated.net',
            socket,
            path: apiPath,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 5000
          },
          onResponse
        );
        tlsReq.on('error', reject);
        tlsReq.on('timeout', () => {
          tlsReq.destroy();
          reject(new Error('TLS request timeout'));
        });
        tlsReq.end();
      });

      connectReq.on('error', reject);
      connectReq.on('timeout', () => {
        connectReq.destroy();
        reject(new Error('Proxy connection timeout'));
      });
      connectReq.end();
    } else {
      const directReq = https.request(
        {
          host: 'api.mymemory.translated.net',
          path: apiPath,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 5000
        },
        onResponse
      );
      directReq.on('error', reject);
      directReq.on('timeout', () => {
        directReq.destroy();
        reject(new Error('Direct request timeout'));
      });
      directReq.end();
    }
  });
}

const PROTECTED_TERMS = [
  [/GitHub\s*Actions?/gi, 'GitHub Actions'],
  [/Readme/gi, 'README'],
  [/FFXIV/gi, 'FFXIV'],
  [/UI\/UX/gi, 'UI/UX']
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

  // 检查缓存
  if (memoryCache[raw]) {
    return memoryCache[raw];
  }

  // 合并并发重复请求
  if (inFlight.has(raw)) {
    return inFlight.get(raw);
  }

  const task = (async () => {
    try {
      // 优先尝试代理访问，若代理不可用则自动直连重试
      let trans = '';
      try {
        trans = await requestMyMemory(raw, true);
      } catch (_) {
        trans = await requestMyMemory(raw, false);
      }

      if (trans && trans !== raw) {
        // 去除尾部句号等无意义标点、应用技术专有名词保护并整理盘古之白
        trans = trans.replace(/[。，.]$/, '').trim();
        trans = applyTermProtection(trans);
        trans = formatPangu(trans);
        memoryCache[raw] = trans;
        saveCache();
        return trans;
      }
      return raw;
    } catch (e) {
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

  const chunks = [];
  let currentChunk = [];
  let currentChars = 0;

  for (const item of toFetch) {
    if (currentChunk.length >= 10 || (currentChars + item.length > 500 && currentChunk.length > 0)) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }
    currentChunk.push(item);
    currentChars += item.length;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      if (chunk.length === 1) {
        const trans = await translateWithApi(chunk[0]);
        resultMap[chunk[0]] = trans;
        return;
      }

      try {
        const combined = chunk.join('\n');
        let translatedRaw = '';
        try {
          translatedRaw = await requestMyMemory(combined, true);
        } catch (_) {
          translatedRaw = await requestMyMemory(combined, false);
        }

        const lines = (translatedRaw || '').split('\n').map((l) => l.trim());

        if (lines.length === chunk.length) {
          chunk.forEach((orig, idx) => {
            let line = lines[idx].replace(/[。，.]$/, '').trim();
            line = applyTermProtection(line);
            line = formatPangu(line);
            memoryCache[orig] = line;
            resultMap[orig] = line;
          });
        } else {
          const fallbacks = await Promise.all(chunk.map((item) => translateWithApi(item)));
          chunk.forEach((orig, idx) => {
            resultMap[orig] = fallbacks[idx];
          });
        }
      } catch (_) {
        const fallbacks = await Promise.all(chunk.map((item) => translateWithApi(item)));
        chunk.forEach((orig, idx) => {
          resultMap[orig] = fallbacks[idx];
        });
      }
    })
  );

  saveCache();
  return resultMap;
}

module.exports = {
  translateWithApi,
  translateBatchWithApi,
  getCachedTranslation,
  getCacheMap: () => memoryCache,
  formatPangu
};
