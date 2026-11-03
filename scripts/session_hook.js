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
        syncHistoricalTitles().catch(() => {}).finally(() => {
          try {
            const { injectLive } = require(${JSON.stringify(injectScript)});
            injectLive('apply', 3, 300).catch(() => {});
          } catch (_) {}
        });
      } catch (_) {
        try {
          const { injectLive } = require(${JSON.stringify(injectScript)});
          injectLive('apply', 3, 300).catch(() => {});
        } catch (_) {}
      }
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

process.stdout.write('{}\n');
