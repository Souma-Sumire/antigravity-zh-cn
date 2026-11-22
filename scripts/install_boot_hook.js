const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function resolveDefaultResourcesDir() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Programs',
      'antigravity',
      'resources'
    );
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Antigravity.app/Contents/Resources',
      path.join(os.homedir(), 'Applications', 'Antigravity.app', 'Contents', 'Resources')
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'app.asar'))) return c;
    }
    return candidates[0];
  }
  const linuxCandidates = [
    '/usr/share/antigravity/resources',
    '/opt/antigravity/resources',
    '/usr/lib/antigravity/resources',
    path.join(os.homedir(), '.local', 'share', 'antigravity', 'resources')
  ];
  for (const c of linuxCandidates) {
    if (fs.existsSync(path.join(c, 'app.asar'))) return c;
  }
  return linuxCandidates[0];
}

const resourcesDir = process.env.AGY_RESOURCES_DIR || resolveDefaultResourcesDir();
const appDir = path.join(resourcesDir, 'app');
const asarPath = path.join(resourcesDir, 'app.asar');
const asarBakPath = path.join(resourcesDir, 'app.asar.bak');
const asarBakMetaPath = path.join(resourcesDir, 'app.asar.bak.meta.json');
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

function readAsarPackageVersion(buf, dataOffset, header) {
  try {
    const pkgEntry = header?.files?.['package.json'];
    if (!pkgEntry || pkgEntry.offset === undefined || pkgEntry.size === undefined) return '';
    const start = dataOffset + Number(pkgEntry.offset);
    const pkgJson = buf.toString('utf8', start, start + Number(pkgEntry.size));
    const pkg = JSON.parse(pkgJson);
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch (_) {
    return '';
  }
}

function computeSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function syncMacOsIntegrityAndSign(headerJsonStr) {
  if (process.platform !== 'darwin') return;
  try {
    const contentsDir = path.dirname(resourcesDir);
    const appBundleDir = path.dirname(contentsDir);
    const infoPlistPath = path.join(contentsDir, 'Info.plist');
    if (fs.existsSync(infoPlistPath) && headerJsonStr) {
      const headerHash = crypto.createHash('sha256').update(Buffer.from(headerJsonStr, 'utf8')).digest('hex');
      try {
        // 仅当 Info.plist 已包含 ElectronAsarIntegrity 时更新对应 hash
        const plistRaw = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPlistPath], {
          encoding: 'utf8'
        });
        const plistObj = JSON.parse(plistRaw);
        if (plistObj && plistObj.ElectronAsarIntegrity && plistObj.ElectronAsarIntegrity['Resources/app.asar']) {
          plistObj.ElectronAsarIntegrity['Resources/app.asar'].hash = headerHash;
          execFileSync(
            '/usr/bin/plutil',
            ['-replace', 'ElectronAsarIntegrity.Resources/app\\.asar.hash', '-string', headerHash, infoPlistPath],
            { stdio: 'ignore' }
          );
        }
      } catch (_) {}
    }
    if (appBundleDir.endsWith('.app') && fs.existsSync(appBundleDir)) {
      try {
        execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appBundleDir], { stdio: 'ignore' });
      } catch (err) {
        console.warn('   macOS codesign warning (may require sudo):', err.message);
      }
    }
  } catch (_) {}
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

function writeAllBytesSync(fd, buf) {
  let bytesWrittenTotal = 0;
  while (bytesWrittenTotal < buf.length) {
    const written = fs.writeSync(
      fd,
      buf,
      bytesWrittenTotal,
      buf.length - bytesWrittenTotal,
      bytesWrittenTotal
    );
    if (written <= 0) {
      throw new Error(`写入停滞: 已写 ${bytesWrittenTotal} / ${buf.length} 字节`);
    }
    bytesWrittenTotal += written;
  }
  return bytesWrittenTotal;
}

function writeAsarSafely(targetPath, finalBuf) {
  // 1. 优先尝试原子化临时文件重命名
  const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, finalBuf);
    fs.renameSync(tmpPath, targetPath);
    const stat = fs.statSync(targetPath);
    if (stat.size === finalBuf.length) {
      return 'atomic-rename';
    }
  } catch (_) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
  }

  // 2. 尝试 in-place 原位写入（必须循环写入确保全部字节写入完毕，失败绝不截断）
  let inPlaceError = null;
  try {
    const fd = fs.openSync(targetPath, 'r+');
    try {
      const written = writeAllBytesSync(fd, finalBuf);
      if (written === finalBuf.length) {
        fs.ftruncateSync(fd, finalBuf.length);
        fs.fsyncSync(fd);
      } else {
        throw new Error(`原位写入不完整: 写入 ${written} 字节，预期 ${finalBuf.length} 字节`);
      }
    } finally {
      fs.closeSync(fd);
    }
    const stat = fs.statSync(targetPath);
    if (stat.size === finalBuf.length) {
      return 'in-place-verified';
    }
  } catch (err) {
    inPlaceError = err;
  }

  // 3. 尝试直接截断覆盖写入
  try {
    fs.writeFileSync(targetPath, finalBuf);
    const stat = fs.statSync(targetPath);
    if (stat.size === finalBuf.length) {
      return 'direct';
    }
  } catch (err) {
    const reason = inPlaceError ? inPlaceError.message : err.message;
    throw new Error(
      `无法写入目标文件 ${targetPath}（文件正被 Antigravity 进程独占）。原因: ${reason}。请先退出 Antigravity 应用后再执行安装或更新。`
    );
  }

  return 'direct';
}

function uninstall() {
  if (fs.existsSync(appDir)) {
    const markerFile = path.join(appDir, '__agy_zh_cn_hook__');
    if (fs.existsSync(markerFile)) {
      try {
        fs.rmSync(appDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  if (!fs.existsSync(asarPath)) {
    console.log('app.asar not found, skip restore.');
    return;
  }

  const isPatched = isAsarPatched(asarPath);
  if (!isPatched) {
    console.log('app.asar is currently not patched.');
    for (const f of [asarBakPath, asarBakMetaPath]) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    }
    return;
  }

  let restored = false;
  let restoredHeaderJson = '';
  if (fs.existsSync(asarBakPath)) {
    try {
      const bakBuf = fs.readFileSync(asarBakPath);
      if (!isAsarPatched(asarBakPath)) {
        const curBuf = fs.readFileSync(asarPath);
        const curParsed = parseAsar(curBuf);
        const bakParsed = parseAsar(bakBuf);
        const curVer = readAsarPackageVersion(curBuf, curParsed.dataOffset, curParsed.header);
        const bakVer = readAsarPackageVersion(bakBuf, bakParsed.dataOffset, bakParsed.header);
        const versionSafe = !curVer || !bakVer || curVer === bakVer;
        if (versionSafe) {
          writeAsarSafely(asarPath, bakBuf);
          restoredHeaderJson = JSON.stringify(bakParsed.header);
          console.log('Restored original app.asar from verified backup:', asarBakPath);
          restored = true;
        } else {
          console.warn(
            `Skip stale backup (${bakVer} != current ${curVer}) to prevent client downgrade; using dynamic unhook instead.`
          );
        }
      }
    } catch (_) {}
  }

  if (!restored) {
    try {
      const currentBuf = fs.readFileSync(asarPath);
      const { dataOffset, header } = parseAsar(currentBuf);
      const mainEntry = header.files.dist.files['main.js'];
      const mainStart = dataOffset + Number(mainEntry.offset);
      const currentMainCode = currentBuf.toString('utf8', mainStart, mainStart + mainEntry.size);

      const cleanMainCode = currentMainCode.includes('\n')
        ? currentMainCode.slice(currentMainCode.indexOf('\n') + 1)
        : currentMainCode.replace(HOOK_MARKER, '');
      const cleanMainBuf = Buffer.from(cleanMainCode, 'utf8');

      const basePayloadLen = Number(mainEntry.offset);
      const payloadBuf = currentBuf.subarray(dataOffset, dataOffset + basePayloadLen);

      mainEntry.size = cleanMainBuf.length;
      mainEntry.offset = String(payloadBuf.length);
      mainEntry.integrity = computeIntegrity(cleanMainBuf);

      const newHeaderJson = JSON.stringify(header);
      const newHeaderBuf = buildAsarHeaderBuffer(newHeaderJson);
      const restoredBuf = Buffer.concat([newHeaderBuf, payloadBuf, cleanMainBuf]);

      writeAsarSafely(asarPath, restoredBuf);
      restoredHeaderJson = newHeaderJson;
      console.log('Dynamically unhooked and restored clean app.asar.');
      restored = true;
    } catch (err) {
      console.error('Failed to dynamically restore app.asar:', err.message);
    }
  }

  if (restored && restoredHeaderJson) {
    syncMacOsIntegrityAndSign(restoredHeaderJson);
  }

  for (const f of [asarBakPath, asarBakMetaPath]) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }
}

function install(force = false) {
  if (!fs.existsSync(asarPath)) {
    console.error('app.asar not found at:', asarPath);
    process.exit(1);
  }

  if (fs.existsSync(appDir)) {
    const markerFile = path.join(appDir, '__agy_zh_cn_hook__');
    if (fs.existsSync(markerFile)) {
      try {
        fs.rmSync(appDir, { recursive: true, force: true });
      } catch (_) {}
    } else {
      console.warn('Notice: resources/app directory exists.');
    }
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
      const cleanVersion = readAsarPackageVersion(currentBuf, dataOffset, header);
      fs.writeFileSync(
        asarBakMetaPath,
        JSON.stringify(
          {
            version: cleanVersion,
            cleanSha256: computeSha256(currentBuf),
            backedUpAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf8'
      );
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
  syncMacOsIntegrityAndSign(newHeaderJson);
  console.log(
    `Patched app.asar (${mode}, header dataOffset: ${dataOffset} -> ${newHeaderBuf.length}, main.js size: ${patchedMainBuf.length})`
  );
  return mode;
}

module.exports = {
  resourcesDir,
  asarPath,
  asarBakPath,
  asarPendingPath,
  isAsarPatched,
  install,
  uninstall,
  parseAsar,
  readAsarPackageVersion,
  buildAsarHeaderBuffer,
  computeIntegrity
};

if (require.main === module) {
  if (process.argv.includes('--uninstall')) {
    uninstall();
  } else {
    install(process.argv.includes('--force'));
  }
}
