const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { asarPath, isAsarPatched, install } = require('./install_boot_hook');

try {
  if (fs.existsSync(asarPath) && !isAsarPatched(asarPath)) {
    install(false);
  }
} catch (_) {}

// 2.5 秒轻量节流防抖，避免高频并发调用
const throttleFile = path.join(os.tmpdir(), 'agy_zh_cn_session_hook_throttle.timestamp');
let shouldRun = true;
try {
  const now = Date.now();
  if (fs.existsSync(throttleFile)) {
    const last = parseInt(fs.readFileSync(throttleFile, 'utf8'), 10) || 0;
    if (now - last < 2500) {
      shouldRun = false;
    }
  }
  if (shouldRun) {
    fs.writeFileSync(throttleFile, String(now), 'utf8');
  }
} catch (_) {}

if (shouldRun) {
  try {
    const injectScript = path.join(__dirname, 'inject_live.js');
    const syncScript = path.join(__dirname, 'sync_historical_titles.js');
    const enableRemote = process.env.AGY_ENABLE_REMOTE_TITLE_TRANSLATION === '1';

    // 默认仅执行轻量实时界面注入，严禁默认扫描/改写数据库或外传会话标题
    const runnerCode = enableRemote
      ? `
        try {
          const { syncHistoricalTitles } = require(${JSON.stringify(syncScript)});
          syncHistoricalTitles().then(() => {
            try {
              const { injectLive } = require(${JSON.stringify(injectScript)});
              injectLive('apply', 3, 300).catch(() => {});
            } catch (_) {}
          }).catch(() => {});
        } catch (_) {}
      `
      : `
        try {
          const { injectLive } = require(${JSON.stringify(injectScript)});
          injectLive('apply', 3, 300).catch(() => {});
        } catch (_) {}
      `;

    const child = spawn(
      process.execPath,
      ['-e', runnerCode],
      {
        cwd: os.tmpdir(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' })
      }
    );
    child.unref();
  } catch (_) {}
}

process.stdout.write('{}\n');
