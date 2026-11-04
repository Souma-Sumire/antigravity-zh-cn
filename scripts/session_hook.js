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

    const child = spawn(
      process.execPath,
      [
        '-e',
        `
        try {
          const { syncHistoricalTitles } = require(${JSON.stringify(syncScript)});
          syncHistoricalTitles().then(res => {
            try {
              const { injectLive } = require(${JSON.stringify(injectScript)});
              injectLive('apply', 3, 300).catch(() => {});
            } catch (_) {}
          }).catch(() => {});
        } catch (_) {}
      `
      ],
      {
        cwd: os.tmpdir(),
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }
    );
    child.unref();
  } catch (_) {}
}

process.stdout.write('{}\n');
