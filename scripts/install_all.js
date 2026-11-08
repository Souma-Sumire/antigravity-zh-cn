const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');

const targetPluginDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'zh-cn-ui');

let sourcePluginDir = null;
const candidateDirs = [
  path.join(__dirname, 'zh-cn-ui'),
  path.join(__dirname, '..'),
  targetPluginDir
];

for (const dir of candidateDirs) {
  if (fs.existsSync(path.join(dir, 'plugin.json'))) {
    sourcePluginDir = dir;
    break;
  }
}

function copyDirRecursive(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) return;
  fs.mkdirSync(dest, { recursive: true });
  const IGNORE_NAMES = new Set(['.git', 'node_modules', '.workbuddy', '.vscode', '.idea', 'scratch']);
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

function setPluginStateViaLsRpc(enabled = true) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      try { req.destroy(new Error('RPC timed out')); } catch (_) {}
      finish(false);
    }, 3500);

    const lsAddr = process.env.ANTIGRAVITY_LS_ADDRESS || 'localhost:53568';
    const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
    const [host, portStr] = lsAddr.split(':');
    const port = parseInt(portStr, 10);
    if (!port) {
      clearTimeout(timer);
      return finish(false);
    }

    const payload = JSON.stringify({
      userConfig: {
        plugins: {
          'zh-cn-ui': { enabled: Boolean(enabled) }
        }
      }
    });

    const req = http.request(
      {
        host: host || '127.0.0.1',
        port,
        path: '/exa.language_server_pb.LanguageServerService/JetboxWriteState',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrf,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 3000
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          clearTimeout(timer);
          finish(res.statusCode === 200);
        });
      }
    );

    req.on('timeout', () => {
      clearTimeout(timer);
      req.destroy(new Error('HTTP request timeout'));
      finish(false);
    });

    req.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });

    req.write(payload);
    req.end();
  });
}

function enablePluginViaLsRpc() {
  return setPluginStateViaLsRpc(true);
}

async function main() {
  if (sourcePluginDir && path.resolve(sourcePluginDir) !== path.resolve(targetPluginDir)) {
    console.log('1. Copying plugin from', sourcePluginDir, 'to:', targetPluginDir);
    copyDirRecursive(sourcePluginDir, targetPluginDir);
  } else {
    console.log('1. Using plugin in place at:', targetPluginDir);
  }

  console.log('2. Installing persistent Electron boot hook into app.asar...');
  try {
    execFileSync(process.execPath, [path.join(targetPluginDir, 'scripts', 'install_boot_hook.js'), '--force'], {
      stdio: 'inherit'
    });
  } catch (err) {
    console.warn('   Boot hook warning:', err.message);
  }

  console.log('3. Enabling plugin via LanguageServer RPC...');
  const rpcOk = await enablePluginViaLsRpc();
  console.log('   RPC enable status:', rpcOk);

  console.log('4. Checking historical conversation titles policy...');
  try {
    const { syncHistoricalTitles } = require(path.join(targetPluginDir, 'scripts', 'sync_historical_titles.js'));
    const syncRes = await syncHistoricalTitles();
    if (syncRes.skipped) {
      console.log('   Historical titles sync skipped (default safe mode: protecting user privacy & data integrity).');
    } else {
      console.log(`   Synchronized ${syncRes.count} historical conversation titles.`);
    }
  } catch (err) {
    console.warn('   Historical titles sync warning:', err.message);
  }

  console.log('5. Injecting live Chinese UI into running Antigravity window...');
  try {
    execFileSync(process.execPath, [path.join(targetPluginDir, 'scripts', 'inject_live.js'), 'zh'], {
      stdio: 'inherit'
    });
  } catch (err) {
    console.warn('   Live injection warning:', err.message);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Installation error:', err);
  process.exit(1);
});

module.exports = { copyDirRecursive, setPluginStateViaLsRpc, enablePluginViaLsRpc };
