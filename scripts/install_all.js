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
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function enablePluginViaLsRpc() {
  return new Promise((resolve) => {
    const lsAddr = process.env.ANTIGRAVITY_LS_ADDRESS || 'localhost:53568';
    const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
    const [host, portStr] = lsAddr.split(':');
    const port = parseInt(portStr, 10);
    if (!port) return resolve(false);

    const payload = JSON.stringify({
      userConfig: {
        plugins: {
          'zh-cn-ui': { enabled: true }
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
        res.on('end', () => resolve(res.statusCode === 200));
      }
    );
    req.on('error', () => resolve(false));
    req.write(payload);
    req.end();
  });
}

async function main() {
  if (sourcePluginDir && path.resolve(sourcePluginDir) !== path.resolve(targetPluginDir)) {
    console.log('1. Copying plugin from', sourcePluginDir, 'to:', targetPluginDir);
    copyDirRecursive(sourcePluginDir, targetPluginDir);
  } else {
    console.log('1. Using plugin in place at:', targetPluginDir);
  }

  console.log('2. Injecting live Chinese UI into running Antigravity window...');
  try {
    execFileSync(process.execPath, [path.join(targetPluginDir, 'scripts', 'inject_live.js'), 'zh'], {
      stdio: 'inherit'
    });
  } catch (err) {
    console.warn('   Live injection warning:', err.message);
  }

  console.log('3. Installing persistent Electron boot hook into app.asar...');
  try {
    execFileSync(process.execPath, [path.join(targetPluginDir, 'scripts', 'install_boot_hook.js'), '--force'], {
      stdio: 'inherit'
    });
  } catch (err) {
    console.warn('   Boot hook warning:', err.message);
  }

  console.log('4. Enabling plugin via LanguageServer RPC...');
  const rpcOk = await enablePluginViaLsRpc();
  console.log('   RPC enable status:', rpcOk);
}

main().catch((err) => {
  console.error('Installation error:', err);
  process.exit(1);
});
