'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const targetPluginDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'zh-cn-ui');
const scriptsDir = fs.existsSync(path.join(__dirname, 'scripts'))
  ? path.join(__dirname, 'scripts')
  : path.join(targetPluginDir, 'scripts');

async function main() {
  const summary = {
    liveWindowRestored: false,
    asarRestored: false,
    lsRpcDisabled: false,
    titlesRestored: 0,
    cleanedTempFiles: 0,
    pluginDirRemoved: false,
    errors: []
  };

  // 1. 恢复运行中窗口为英文
  console.log('1. Restoring live Antigravity window to English...');
  const injectScript = path.join(scriptsDir, 'inject_live.js');
  if (fs.existsSync(injectScript)) {
    try {
      execFileSync(process.execPath, [injectScript, 'en'], { stdio: 'inherit' });
      summary.liveWindowRestored = true;
    } catch (err) {
      console.warn('   Note: Live injection restore skipped or window not open:', err.message);
    }
  }

  // 2. 恢复原始 app.asar 引导钩子
  console.log('2. Restoring original app.asar...');
  const bootHookScript = path.join(scriptsDir, 'install_boot_hook.js');
  if (fs.existsSync(bootHookScript)) {
    try {
      execFileSync(process.execPath, [bootHookScript, '--uninstall'], { stdio: 'inherit' });
      summary.asarRestored = true;
    } catch (err) {
      const msg = `Failed to restore app.asar: ${err.message}`;
      console.error('   Error:', msg);
      summary.errors.push(msg);
    }
  }

  // 3. 向语言服务注销插件启用状态
  console.log('3. Disabling plugin state via LanguageServer RPC...');
  const installAllScript = path.join(scriptsDir, 'install_all.js');
  if (fs.existsSync(installAllScript)) {
    try {
      const { setPluginStateViaLsRpc } = require(installAllScript);
      if (typeof setPluginStateViaLsRpc === 'function') {
        const disabled = await setPluginStateViaLsRpc(false);
        summary.lsRpcDisabled = disabled;
        console.log('   RPC disable status:', disabled);
      }
    } catch (err) {
      console.warn('   Note: LanguageServer RPC disable skipped:', err.message);
    }
  }

  // 4. 精准按清单回滚历史标题改动（绝对不使用 .bak 全量覆盖数据库，保护用户新增数据）
  console.log('4. Checking and reverting historical conversation titles changes...');
  const syncScript = path.join(scriptsDir, 'sync_historical_titles.js');
  if (fs.existsSync(syncScript)) {
    try {
      const { revertHistoricalTitles } = require(syncScript);
      if (typeof revertHistoricalTitles === 'function') {
        const res = await revertHistoricalTitles();
        summary.titlesRestored = res.restored || 0;
        if (summary.titlesRestored > 0) {
          console.log(`   Accurately restored ${summary.titlesRestored} historical conversation titles without touching new sessions.`);
        } else {
          console.log('   No title changes needed reverting.');
        }
      }
    } catch (err) {
      console.warn('   Note: Title revert error:', err.message);
    }
  }

  // 清理临时文件与缓存
  const antigravityRoot = path.join(os.homedir(), '.gemini', 'antigravity');
  const filesToClean = [
    path.join(antigravityRoot, 'title_api_cache.json'),
    path.join(antigravityRoot, 'historical_titles_backup.json'),
    path.join(antigravityRoot, 'translation_config.json'),
    path.join(os.tmpdir(), 'agy_zh_cn_session_hook_throttle.timestamp')
  ];

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const asarPendingPath = path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar.pending');
  filesToClean.push(asarPendingPath);

  for (const f of filesToClean) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
        summary.cleanedTempFiles++;
      } catch (_) {}
    }
  }

  // 5. 移除全局插件目录
  console.log('5. Removing global plugin directory:', targetPluginDir);
  const isRunningFromTarget = path.resolve(__dirname) === path.resolve(targetPluginDir);
  if (isRunningFromTarget) {
    // 若当前正在目标目录执行，派生独立短进程等待当前进程退出后再清理
    const cleanupCode = `
      const fs = require('fs');
      setTimeout(() => {
        try { fs.rmSync(${JSON.stringify(targetPluginDir)}, { recursive: true, force: true }); } catch (_) {}
        process.exit(0);
      }, 500);
    `;
    const child = spawn(process.execPath, ['-e', cleanupCode], {
      cwd: os.tmpdir(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    summary.pluginDirRemoved = true;
  } else if (fs.existsSync(targetPluginDir)) {
    try {
      fs.rmSync(targetPluginDir, { recursive: true, force: true });
      summary.pluginDirRemoved = true;
    } catch (err) {
      console.warn('   Warning: Could not remove directory immediately:', err.message);
    }
  } else {
    summary.pluginDirRemoved = true;
  }

  // 输出卸载最终报告
  console.log('\n========================================');
  if (summary.errors.length === 0) {
    console.log('Antigravity Chinese UI patch uninstalled successfully.');
  } else {
    console.warn('Antigravity Chinese UI patch uninstalled with warnings/errors:');
    for (const e of summary.errors) {
      console.warn(' -', e);
    }
  }
  console.log('========================================');
}

main().catch((err) => {
  console.error('Fatal uninstall error:', err);
  process.exit(1);
});
