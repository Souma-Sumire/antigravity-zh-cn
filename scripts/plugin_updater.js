'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');
const { execFile } = require('child_process');

const DEFAULT_REPO_OWNER = 'Souma-Sumire';
const DEFAULT_REPO_NAME = 'antigravity-zh-cn';
const DEFAULT_BRANCH = 'main';
const DEFAULT_PLUGIN_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'zh-cn-ui');
const IGNORE_NAMES = new Set(['.git', 'node_modules', '.workbuddy', '.vscode', '.idea', 'scratch']);

function normalizeVersion(ver) {
  return String(ver || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function getLocalVersion(pluginDir = DEFAULT_PLUGIN_DIR) {
  const candidates = [
    path.join(pluginDir, 'plugin.json'),
    path.join(pluginDir, 'package.json')
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data && typeof data.version === 'string' && data.version.trim()) {
          return normalizeVersion(data.version);
        }
      }
    } catch (_) {}
  }
  return '0.0.0';
}

function getProxyConfig() {
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;

  if (!envProxy) return null;
  try {
    const parsed = new URL(
      envProxy.startsWith('http://') || envProxy.startsWith('https://') || envProxy.startsWith('socks5://')
        ? envProxy
        : `http://${envProxy}`
    );
    if (parsed.protocol === 'socks5:') return null;
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parseInt(parsed.port, 10) || 7897
    };
  } catch (_) {
    return null;
  }
}

function requestWithElectronNet(targetUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    let electronNet = null;
    try {
      const electron = require('electron');
      electronNet = electron && electron.net;
    } catch (_) {}

    if (!electronNet || typeof electronNet.request !== 'function') {
      return reject(new Error('Electron net module unavailable'));
    }

    let settled = false;
    const finish = (err, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(buf);
    };

    const req = electronNet.request({
      method: 'GET',
      url: targetUrl,
      redirect: 'follow'
    });
    req.setHeader('User-Agent', 'antigravity-zh-cn-updater');
    req.setHeader('Cache-Control', 'no-cache');

    const timer = setTimeout(() => {
      try { req.abort(); } catch (_) {}
      finish(new Error('请求超时'));
    }, timeoutMs);

    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.on('data', () => {});
        res.on('end', () => finish(new Error(`HTTP ${res.statusCode}`)));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => finish(null, Buffer.concat(chunks)));
      res.on('error', (err) => finish(err));
    });

    req.on('error', (err) => finish(err));
    req.end();
  });
}

function requestWithNodeHttps(targetUrl, timeoutMs, proxyConfig, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const port = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80);
    const reqPath = parsed.pathname + parsed.search;

    let settled = false;
    const finish = (err, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(buf);
    };

    const timer = setTimeout(() => {
      finish(new Error('请求超时'));
    }, timeoutMs);

    const handleRes = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) {
          return finish(new Error('重定向次数过多'));
        }
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        res.resume();
        clearTimeout(timer);
        settled = true;
        requestWithNodeHttps(nextUrl, timeoutMs, proxyConfig, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return finish(new Error(`HTTP ${res.statusCode}`));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => finish(null, Buffer.concat(chunks)));
      res.on('error', (err) => finish(err));
    };

    const sendDirect = (customSocket) => {
      const mod = isHttps ? https : http;
      const reqOptions = {
        hostname: parsed.hostname,
        port,
        path: reqPath,
        method: 'GET',
        headers: {
          Host: parsed.host,
          'User-Agent': 'antigravity-zh-cn-updater',
          'Cache-Control': 'no-cache'
        }
      };
      if (customSocket) {
        reqOptions.createConnection = () => customSocket;
      }
      const req = mod.request(reqOptions, handleRes);
      req.on('error', (err) => finish(err));
      req.end();
    };

    if (proxyConfig && isHttps) {
      const connectReq = http.request({
        host: proxyConfig.host,
        port: proxyConfig.port,
        method: 'CONNECT',
        path: `${parsed.hostname}:${port}`
      });
      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          return finish(new Error(`代理连接被拒绝: ${res.statusCode}`));
        }
        const tlsSocket = tls.connect({
          socket,
          servername: parsed.hostname,
          rejectUnauthorized: true
        }, () => sendDirect(tlsSocket));
        tlsSocket.on('error', (err) => finish(err));
      });
      connectReq.on('error', (err) => finish(err));
      connectReq.end();
    } else {
      sendDirect(null);
    }
  });
}

async function fetchBuffer(targetUrl, timeoutMs = 12000) {
  const proxyConfig = getProxyConfig();
  try {
    return await requestWithElectronNet(targetUrl, timeoutMs);
  } catch (electronErr) {
    if (electronErr && electronErr.message === 'Electron net module unavailable') {
      return await requestWithNodeHttps(targetUrl, timeoutMs, proxyConfig);
    }
    // Electron 网络栈未配置系统代理但用户设置了环境变量代理时，回退至 Node 代理隧道
    if (proxyConfig) {
      return await requestWithNodeHttps(targetUrl, timeoutMs, proxyConfig);
    }
    throw electronErr;
  }
}

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || stdout || err.message || '').trim();
        reject(new Error(detail || err.message));
      } else {
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    });
  });
}

function copyDirRecursive(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (IGNORE_NAMES.has(entry.name) || entry.name.endsWith('.tmp') || entry.name.endsWith('.log')) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function findPluginRoot(extractDir) {
  if (fs.existsSync(path.join(extractDir, 'plugin.json'))) {
    return extractDir;
  }
  for (const entry of fs.readdirSync(extractDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const candidate = path.join(extractDir, entry.name);
      if (fs.existsSync(path.join(candidate, 'plugin.json'))) {
        return candidate;
      }
    }
  }
  return null;
}

function getFileHash(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return '';
  }
}

async function checkForUpdates(options = {}) {
  const pluginDir = options.pluginDir || DEFAULT_PLUGIN_DIR;
  const owner = options.owner || DEFAULT_REPO_OWNER;
  const repo = options.repo || DEFAULT_REPO_NAME;
  const branch = options.branch || DEFAULT_BRANCH;
  const currentVersion = getLocalVersion(pluginDir);

  const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/plugin.json?t=${Date.now()}`;
  try {
    const buf = await fetchBuffer(manifestUrl, options.timeoutMs || 10000);
    const remoteManifest = JSON.parse(buf.toString('utf8'));
    const latestVersion = normalizeVersion(remoteManifest && remoteManifest.version);
    if (!latestVersion) {
      return {
        ok: false,
        currentVersion,
        error: '远端版本信息无效'
      };
    }
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0
    };
  } catch (err) {
    return {
      ok: false,
      currentVersion,
      error: err && err.message ? err.message : '网络请求失败'
    };
  }
}

async function performUpdate(options = {}) {
  const pluginDir = options.pluginDir || DEFAULT_PLUGIN_DIR;
  const owner = options.owner || DEFAULT_REPO_OWNER;
  const repo = options.repo || DEFAULT_REPO_NAME;
  const branch = options.branch || DEFAULT_BRANCH;

  const bootHookPath = path.join(pluginDir, 'scripts', 'main_boot_hook.js');
  const prevBootHookHash = getFileHash(bootHookPath);
  const isGitRepo = fs.existsSync(path.join(pluginDir, '.git'));

  try {
    if (isGitRepo) {
      await execFileAsync('git', ['-C', pluginDir, 'pull', '--ff-only'], { timeout: 30000 });
    } else {
      const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
      const zipBuf = await fetchBuffer(zipUrl, options.timeoutMs || 30000);
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tempZip = path.join(os.tmpdir(), `agy-zh-cn-update-${stamp}.zip`);
      const extractDir = path.join(os.tmpdir(), `agy-zh-cn-extract-${stamp}`);

      try {
        fs.writeFileSync(tempZip, zipBuf);
        fs.mkdirSync(extractDir, { recursive: true });

        if (process.platform === 'win32') {
          const psCmd = `Expand-Archive -LiteralPath '${tempZip.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`;
          await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { timeout: 30000 });
        } else {
          await execFileAsync('unzip', ['-o', '-q', tempZip, '-d', extractDir], { timeout: 30000 });
        }

        const sourceRoot = findPluginRoot(extractDir);
        if (!sourceRoot) {
          throw new Error('更新包结构异常，未找到 plugin.json');
        }

        copyDirRecursive(sourceRoot, pluginDir);
      } finally {
        try { fs.rmSync(tempZip, { force: true }); } catch (_) {}
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}
      }
    }

    const updatedVersion = getLocalVersion(pluginDir);
    const nextBootHookHash = getFileHash(bootHookPath);
    const restartRequired = Boolean(prevBootHookHash && nextBootHookHash && prevBootHookHash !== nextBootHookHash);

    return {
      ok: true,
      version: updatedVersion,
      restartRequired
    };
  } catch (err) {
    return {
      ok: false,
      version: getLocalVersion(pluginDir),
      error: err && err.message ? err.message : '更新失败'
    };
  }
}

module.exports = {
  DEFAULT_PLUGIN_DIR,
  compareVersions,
  getLocalVersion,
  checkForUpdates,
  performUpdate
};
