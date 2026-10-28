const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const defaultResourcesDir = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Programs',
  'antigravity',
  'resources'
);

const resourcesDir = process.env.AGY_RESOURCES_DIR || defaultResourcesDir;
const appDir = path.join(resourcesDir, 'app');
const asarPath = path.join(resourcesDir, 'app.asar');
const asarBakPath = path.join(resourcesDir, 'app.asar.bak');
const asarPendingPath = path.join(resourcesDir, 'app.asar.pending');
const HOOK_MARKER = '/*__AGY_ZH_CN_BOOT_HOOK__*/';

function computeIntegrity(buf) {
  const blockSize = 4 * 1024 * 1024;
  const blocks = [];
  for (let i = 0; i < buf.length; i += blockSize) {
    const slice = buf.subarray(i, Math.min(i + blockSize, buf.length));
    blocks.push(crypto.createHash('sha256').update(slice).digest('hex'));
  }
  if (blocks.length === 0) {
    blocks.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  }
  return {
    algorithm: 'SHA256',
    hash: crypto.createHash('sha256').update(buf).digest('hex'),
    blockSize,
    blocks
  };
}

function buildAsarHeaderBuffer(jsonStr) {
  const strBuf = Buffer.from(jsonStr, 'utf8');
  const strLen = strBuf.length;
  const alignedStrLen = Math.ceil(strLen / 4) * 4;
  const u3 = strLen;
  const u2 = 4 + alignedStrLen;
  const u1 = 4 + u2;
  const u0 = 4;

  const headerBuf = Buffer.alloc(8 + u1, 0);
  headerBuf.writeUInt32LE(u0, 0);
  headerBuf.writeUInt32LE(u1, 4);
  headerBuf.writeUInt32LE(u2, 8);
  headerBuf.writeUInt32LE(u3, 12);
  strBuf.copy(headerBuf, 16);
  return headerBuf;
}

function parseAsar(buf) {
  const u1 = buf.readUInt32LE(4);
  const u3 = buf.readUInt32LE(12);
  const dataOffset = 8 + u1;
  const headerJson = buf.toString('utf8', 16, 16 + u3);
  const header = JSON.parse(headerJson);
  return { dataOffset, u3, header };
}

function isAsarPatched(targetAsarPath = asarPath) {
  let fd = null;
  try {
    if (!fs.existsSync(targetAsarPath)) return false;
    fd = fs.openSync(targetAsarPath, 'r');
    const prefix = Buffer.alloc(16);
    if (fs.readSync(fd, prefix, 0, 16, 0) < 16) return false;
    const u1 = prefix.readUInt32LE(4);
    const u3 = prefix.readUInt32LE(12);
    const dataOffset = 8 + u1;
    const headerBuf = Buffer.alloc(u3);
    if (fs.readSync(fd, headerBuf, 0, u3, 16) < u3) return false;
    const header = JSON.parse(headerBuf.toString('utf8'));
    const mainEntry = header?.files?.dist?.files?.['main.js'];
    if (!mainEntry) return false;
    const mainStart = dataOffset + Number(mainEntry.offset);
    const probeLen = Math.min(128, Number(mainEntry.size));
    const probeBuf = Buffer.alloc(probeLen);
    fs.readSync(fd, probeBuf, 0, probeLen, mainStart);
    return probeBuf.toString('utf8').includes(HOOK_MARKER);
  } catch (_) {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function writeAsarSafely(targetPath, finalBuf) {
  try {
    const fd = fs.openSync(targetPath, 'r+');
    try {
      fs.writeSync(fd, finalBuf, 0, finalBuf.length, 0);
      fs.ftruncateSync(fd, finalBuf.length);
    } finally {
      fs.closeSync(fd);
    }
    return 'in-place';
  } catch (_) {}

  try {
    fs.writeFileSync(targetPath, finalBuf);
    return 'direct';
  } catch (_) {}

  fs.writeFileSync(asarPendingPath, finalBuf);
  const watcherCode = `
    const fs = require('fs');
    const src = ${JSON.stringify(asarPendingPath)};
    const dst = ${JSON.stringify(targetPath)};
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (!fs.existsSync(src) || tries > 1800) {
        clearInterval(timer);
        process.exit(0);
      }
      try {
        const buf = fs.readFileSync(src);
        const fd = fs.openSync(dst, 'r+');
        try {
          fs.writeSync(fd, buf, 0, buf.length, 0);
          fs.ftruncateSync(fd, buf.length);
        } finally {
          fs.closeSync(fd);
        }
        fs.unlinkSync(src);
        clearInterval(timer);
        process.exit(0);
      } catch (_) {
        try {
          fs.copyFileSync(src, dst);
          fs.unlinkSync(src);
          clearInterval(timer);
          process.exit(0);
        } catch (_) {}
      }
    }, 500);
  `;
  const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' });
  const child = spawn(process.execPath, ['-e', watcherCode], {
    cwd: os.tmpdir(),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env
  });
  child.unref();
  return 'deferred-on-close';
}

function uninstall() {
  if (fs.existsSync(appDir)) {
    try {
      fs.rmSync(appDir, { recursive: true, force: true });
    } catch (_) {}
  }
  if (fs.existsSync(asarBakPath)) {
    writeAsarSafely(asarPath, fs.readFileSync(asarBakPath));
    console.log('Restored original app.asar from backup:', asarBakPath);
  } else {
    console.log('No app.asar.bak found at:', asarBakPath);
  }
}

function install(force = false) {
  if (!fs.existsSync(asarPath)) {
    console.error('app.asar not found at:', asarPath);
    process.exit(1);
  }

  if (fs.existsSync(appDir)) {
    try {
      fs.rmSync(appDir, { recursive: true, force: true });
    } catch (_) {}
  }

  const fallbackHookPath = path.join(__dirname, 'main_boot_hook.js');
  const loaderLine =
    `${HOOK_MARKER}try{const fs=require("fs"),path=require("path"),os=require("os");` +
    `const p1=path.join(os.homedir(),".gemini","config","plugins","zh-cn-ui","scripts","main_boot_hook.js");` +
    `const p2=${JSON.stringify(fallbackHookPath)};` +
    `if(fs.existsSync(p1))require(p1);else if(fs.existsSync(p2))require(p2);}catch(_){}\n`;

  const currentBuf = fs.readFileSync(asarPath);
  const { dataOffset, header } = parseAsar(currentBuf);
  const mainEntry = header.files.dist.files['main.js'];
  const mainStart = dataOffset + Number(mainEntry.offset);
  const currentMainCode = currentBuf.toString('utf8', mainStart, mainStart + mainEntry.size);
  const alreadyHooked = currentMainCode.includes(HOOK_MARKER);

  if (alreadyHooked && !force && currentMainCode.startsWith(loaderLine)) {
    console.log('app.asar is already patched and up to date.');
    return 'already-patched';
  }

  let payloadBuf;
  let cleanMainCode;

  if (!alreadyHooked) {
    try {
      fs.writeFileSync(asarBakPath, currentBuf);
      console.log('Backed up clean official app.asar to:', asarBakPath);
    } catch (_) {}
    payloadBuf = currentBuf.subarray(dataOffset);
    cleanMainCode = currentMainCode;
  } else {
    // 已打过补丁时，直接截断上次追加在末尾的 patchedMainBuf 并剥离首行 loaderLine，绝不依赖可能跨版本的旧备份
    const basePayloadLen = Number(mainEntry.offset);
    payloadBuf = currentBuf.subarray(dataOffset, dataOffset + basePayloadLen);
    cleanMainCode = currentMainCode.slice(currentMainCode.indexOf('\n') + 1);
  }

  const patchedMainBuf = Buffer.from(loaderLine + cleanMainCode, 'utf8');
  const newMainOffset = payloadBuf.length;

  mainEntry.size = patchedMainBuf.length;
  mainEntry.offset = String(newMainOffset);
  mainEntry.integrity = computeIntegrity(patchedMainBuf);

  const newHeaderJson = JSON.stringify(header);
  const newHeaderBuf = buildAsarHeaderBuffer(newHeaderJson);
  const finalAsarBuf = Buffer.concat([newHeaderBuf, payloadBuf, patchedMainBuf]);

  const mode = writeAsarSafely(asarPath, finalAsarBuf);
  console.log(
    `Patched app.asar (${mode}, header dataOffset: ${dataOffset} -> ${newHeaderBuf.length}, main.js size: ${patchedMainBuf.length})`
  );
  return mode;
}

module.exports = {
  asarPath,
  isAsarPatched,
  install,
  uninstall
};

if (require.main === module) {
  if (process.argv.includes('--uninstall')) {
    uninstall();
  } else {
    install(process.argv.includes('--force'));
  }
}
