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
  console.log('3. Restoring historical conversation titles and annotations backup...');
  const antigravityRoot = path.join(os.homedir(), '.gemini', 'antigravity');

  // 恢复 SQLite 数据库备份
  const dbPath = path.join(antigravityRoot, 'conversation_summaries.db');
  const dbBakPath = path.join(antigravityRoot, 'conversation_summaries.db.bak');
  if (fs.existsSync(dbBakPath)) {
    try {
      fs.copyFileSync(dbBakPath, dbPath);
      fs.unlinkSync(dbBakPath);
      console.log('Restored conversation_summaries.db from backup.');
    } catch (_) {}
  }

  // 恢复 annotations/*.pbtxt 备份
  const annotationsDir = path.join(antigravityRoot, 'annotations');
  if (fs.existsSync(annotationsDir)) {
    try {
      const files = fs.readdirSync(annotationsDir);
      for (const file of files) {
        if (file.endsWith('.pbtxt.bak')) {
          const bakFile = path.join(annotationsDir, file);
          const targetPbtxt = path.join(annotationsDir, file.slice(0, -4));
          fs.copyFileSync(bakFile, targetPbtxt);
          fs.unlinkSync(bakFile);
        }
      }
      console.log('Restored annotations .pbtxt files from backup.');
    } catch (_) {}
  }

  // 清理备份清单与标题缓存
  const manifestPath = path.join(antigravityRoot, 'historical_titles_backup.json');
  if (fs.existsSync(manifestPath)) {
    try { fs.unlinkSync(manifestPath); } catch (_) {}
  }
  const titleCacheFile = path.join(antigravityRoot, 'title_api_cache.json');
  if (fs.existsSync(titleCacheFile)) {
    try { fs.unlinkSync(titleCacheFile); } catch (_) {}
  }
} catch (_) {}

try {
  console.log('4. Removing plugin directory:', targetPluginDir);
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
