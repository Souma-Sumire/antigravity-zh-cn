const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const targetPluginDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'zh-cn-ui');
const scriptsDir = fs.existsSync(path.join(__dirname, 'scripts'))
  ? path.join(__dirname, 'scripts')
  : path.join(targetPluginDir, 'scripts');

try {
  console.log('1. Restoring live Antigravity window to English...');
  execFileSync(process.execPath, [path.join(scriptsDir, 'inject_live.js'), 'en'], { stdio: 'inherit' });
} catch (_) {}

try {
  console.log('2. Restoring original app.asar...');
  execFileSync(process.execPath, [path.join(scriptsDir, 'install_boot_hook.js'), '--uninstall'], { stdio: 'inherit' });
} catch (_) {}

try {
  console.log('3. Removing plugin directory:', targetPluginDir);
  const cleanupCode = `
    const fs = require('fs');
    setTimeout(() => {
      try { fs.rmSync(${JSON.stringify(targetPluginDir)}, { recursive: true, force: true }); } catch (_) {}
      process.exit(0);
    }, 300);
  `;
  const child = spawn(process.execPath, ['-e', cleanupCode], {
    cwd: os.tmpdir(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
} catch (_) {}

console.log('Uninstalled Antigravity Chinese UI patch successfully.');
