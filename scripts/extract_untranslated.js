#!/usr/bin/env node
/**
 * Antigravity 穷尽 UI 字符串提取与增量比对工具
 * 
 * 功能：
 * 1. 自动从 Antigravity 安装目录的 language_server.exe (嵌入 Zip) 中提取前端 Web Bundle (main.js)
 * 2. 自动从 app.asar 中提取主进程代码 (menu.js, ipcHandlers.js 等)
 * 3. 运行多维 UI 模式匹配 (React Props, DOM Attr, JSX Text, 状态提示, 对话框)
 * 4. 结合语法规则与智能降噪过滤，剔除代码标识符与样式类
 * 5. 与 zh_cn_runtime.js 的 EXACT_MAP 进行去重与归一化对比
 * 6. 输出结构化未翻译清单 (JSON) 与待填词模板
 * 7. 支持 --merge 参数一键合并翻译到 runtime 词典
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 默认路径配置
const DEFAULT_INSTALL_DIR = path.join(
  process.env.LOCALAPPDATA || 'C:\\Users\\55346\\AppData\\Local',
  'Programs',
  'Antigravity'
);

const RUNTIME_PATH = path.join(__dirname, 'zh_cn_runtime.js');

function log(msg) {
  console.log(`[extract_untranslated] ${msg}`);
}

// 1. 从 language_server.exe 内置 Zip 中提取 main.js
function extractWebBundleFromExe(exePath) {
  if (!fs.existsSync(exePath)) {
    throw new Error(`未找到文件: ${exePath}`);
  }
  log(`正在分析二进制文件: ${exePath}`);
  const buf = fs.readFileSync(exePath);

  let offset = 0;
  const PK_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

  while (offset < buf.length) {
    const sigIdx = buf.indexOf(PK_SIG, offset);
    if (sigIdx === -1) break;

    const compMethod = buf.readUInt16LE(sigIdx + 8);
    const compSize = buf.readUInt32LE(sigIdx + 18);
    const uncompSize = buf.readUInt32LE(sigIdx + 22);
    const nameLen = buf.readUInt16LE(sigIdx + 26);
    const extraLen = buf.readUInt16LE(sigIdx + 28);
    const fileName = buf.toString('utf8', sigIdx + 30, sigIdx + 30 + nameLen);

    const dataStart = sigIdx + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;

    if (compSize > 0 && dataEnd <= buf.length && fileName.includes('main.js')) {
      log(`在 Zip 资源中定位到前端核心: ${fileName} (压缩前大小: ${(uncompSize / 1024 / 1024).toFixed(2)} MB)`);
      const fileData = buf.subarray(dataStart, dataEnd);
      if (compMethod === 8) {
        return zlib.inflateRawSync(fileData).toString('utf8');
      } else if (compMethod === 0) {
        return fileData.toString('utf8');
      }
    }
    offset = sigIdx + 4;
  }
  return null;
}

// 2. 检查字符串是否属于有效 UI 文本 (降噪过滤)
function isValidUiString(str) {
  if (!str) return false;
  const s = str.trim();
  if (s.length < 2 || s.length > 180) return false;

  // 排除 URL、协议、网络地址
  if (/^(?:https?|file|ws|wss|ipc|chrome|devtools):\/\//i.test(s)) return false;
  if (/^[\w-]+:\/\//i.test(s)) return false;

  // 排除文件路径与后缀
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../') || /^[A-Za-z]:\\/.test(s)) return false;
  if (/\.(?:js|jsx|ts|tsx|json|html|css|scss|svg|png|jpg|ico|map|wasm|exe|asar|dll)$/i.test(s)) return false;

  // 排除代码标识符 (纯蛇形命名、驼峰命名、全大写枚举)
  if (/^[a-z0-9_-]+$/.test(s)) return false; // flex, items-center
  if (/^[A-Z0-9_-]+$/.test(s) && !s.includes(' ')) return false; // GET, POST, ERROR_CODE
  if (/^[a-z]+[A-Z0-9][a-zA-Z0-9]*$/.test(s)) return false; // camelCaseIdentifiers

  // 排除样式代码与特殊符号
  if (s.includes('{') || s.includes('}') || s.includes(';') || s.includes('=>') || s.includes('===')) return false;
  if (/^\d+(?:px|em|rem|vh|vw|%)?$/.test(s)) return false;
  if (/^(?:rgba?|hsla?)\(/i.test(s) || /^#[0-9a-fA-F]{3,8}$/.test(s)) return false;

  // 排除纯数字或符号
  if (/^[\d\s.,:;!?_+\-*\/()\[\]{}#%@<>=&^~$`|\\'"“”‘’]+$/.test(s)) return false;

  // 必须含有英文字母
  if (!/[a-zA-Z]/.test(s)) return false;

  return true;
}

// 3. 多维 UI 模式提取引擎
function extractCandidatesFromCode(code) {
  const candidates = new Set();

  // 模式 1: UI 对象属性
  const propRegex = /\b(?:label|title|description|tooltip|placeholder|message|header|heading|emptyText|emptyMessage|btnText|buttonText|confirmText|cancelText|tabName|actionText|helpText|hintText|subtext|prompt)\s*:\s*(["'])(.+?)\1/g;
  let m;
  while ((m = propRegex.exec(code)) !== null) {
    if (isValidUiString(m[2])) candidates.add(m[2]);
  }

  // 模式 2: DOM 属性 (aria-label, placeholder, title)
  const attrRegex = /\b(?:["']aria-label["']|["']placeholder["']|["']title["'])\s*:\s*(["'])(.+?)\1/g;
  while ((m = attrRegex.exec(code)) !== null) {
    if (isValidUiString(m[2])) candidates.add(m[2]);
  }

  // 模式 3: JSX 文本节点 > Text <
  const jsxRegex = />\s*([A-Z][A-Za-z0-9 ,'\-\.?!:;()\/]{2,80})\s*</g;
  while ((m = jsxRegex.exec(code)) !== null) {
    if (isValidUiString(m[1])) candidates.add(m[1]);
  }

  // 模式 4: React 菜单与动作数组中的显式字符串
  const menuActionRegex = /\{label:\s*(["'])(.+?)\1/g;
  while ((m = menuActionRegex.exec(code)) !== null) {
    if (isValidUiString(m[2])) candidates.add(m[2]);
  }

  return candidates;
}

// 4. 解析当前字典
function loadRuntimeDictionary(runtimePath) {
  if (!fs.existsSync(runtimePath)) {
    throw new Error(`未找到运行时字典文件: ${runtimePath}`);
  }
  const code = fs.readFileSync(runtimePath, 'utf8');
  const start = code.indexOf('const EXACT_MAP = {');
  const end = code.indexOf('\n  };', start);
  if (start === -1 || end === -1) {
    throw new Error('未能从 zh_cn_runtime.js 解析 EXACT_MAP');
  }
  const mapCode = code.slice(start + 'const EXACT_MAP = '.length, end + 4);
  const exactMap = eval('(' + mapCode + ')');
  return { exactMap, fullCode: code };
}

// 5. 主执行逻辑
function main() {
  const args = process.argv.slice(2);

  // 模式: 一键合并
  if (args[0] === '--merge') {
    const toMergePath = args[1];
    if (!toMergePath || !fs.existsSync(toMergePath)) {
      console.error('用法: node extract_untranslated.js --merge <translated_file.json>');
      process.exit(1);
    }
    mergeTranslation(toMergePath);
    return;
  }

  // 自动寻找输入源
  let codeSource = '';
  let inputPath = args[0];

  if (!inputPath) {
    const candidateExe = path.join(DEFAULT_INSTALL_DIR, 'resources', 'bin', 'language_server.exe');
    if (fs.existsSync(candidateExe)) {
      inputPath = candidateExe;
    } else {
      // 检查当前目录下是否有解包出的 main.js
      const localMain = path.join(__dirname, '..', 'scratch', 'web_2.28.0', 'main.js');
      if (fs.existsSync(localMain)) {
        inputPath = localMain;
      }
    }
  }

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('未找到 Antigravity 输入文件，请指定 language_server.exe 或 main.js 路径。');
    console.error('例如: node extract_untranslated.js "C:\\path\\to\\language_server.exe"');
    process.exit(1);
  }

  if (inputPath.endsWith('.exe')) {
    codeSource = extractWebBundleFromExe(inputPath);
    if (!codeSource) {
      console.error('未能从 exe 资源包中解压出 main.js');
      process.exit(1);
    }
  } else {
    log(`正在读取源码文件: ${inputPath}`);
    codeSource = fs.readFileSync(inputPath, 'utf8');
  }

  log(`源码提取成功，正在执行多维模式扫描与降噪过滤...`);
  const candidates = extractCandidatesFromCode(codeSource);
  log(`累计提取到潜在 UI 候选字符串: ${candidates.size} 条`);

  log(`正在加载并比对本地运行时字典: ${RUNTIME_PATH}`);
  const { exactMap } = loadRuntimeDictionary(RUNTIME_PATH);
  const currentCount = Object.keys(exactMap).length;
  log(`当前词库词条数: ${currentCount} 条`);

  const untranslated = [];
  const templateDict = {};

  for (const cand of Array.from(candidates).sort()) {
    const norm = cand.replace(/\s+/g, ' ');
    if (!exactMap[cand] && !exactMap[norm]) {
      untranslated.push(cand);
      templateDict[cand] = cand; // 待翻译模板
    }
  }

  log(`----------------------------------------`);
  log(`提取结果汇总:`);
  log(`- 扫描候选总数: ${candidates.size}`);
  log(`- 已翻译覆盖数: ${candidates.size - untranslated.length}`);
  log(`- 待翻译新增数: ${untranslated.length}`);
  log(`----------------------------------------`);

  const outReportPath = path.join(__dirname, 'untranslated_report.json');
  const outTemplatePath = path.join(__dirname, 'untranslated_template.json');

  fs.writeFileSync(outReportPath, JSON.stringify(untranslated, null, 2), 'utf8');
  fs.writeFileSync(outTemplatePath, JSON.stringify(templateDict, null, 2), 'utf8');

  log(`已输出未翻译清单: ${outReportPath}`);
  log(`已输出翻译模板文件: ${outTemplatePath}`);
  log(`翻译完成后，可运行下述命令一键合并至词库:`);
  log(`node scripts/extract_untranslated.js --merge scripts/untranslated_template.json`);
}

// 合并翻译至 zh_cn_runtime.js
function mergeTranslation(filePath) {
  const toMerge = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let runtimeCode = fs.readFileSync(RUNTIME_PATH, 'utf8');

  let addedCount = 0;
  let entriesToAdd = '';

  for (const [en, zh] of Object.entries(toMerge)) {
    if (en === zh) continue; // 未翻译的跳过
    const key = JSON.stringify(en);
    const val = JSON.stringify(zh);
    if (!runtimeCode.includes(key + ':')) {
      entriesToAdd += `    ${key}: ${val},\n`;
      addedCount++;
    }
  }

  if (addedCount > 0) {
    runtimeCode = runtimeCode.replace('const EXACT_MAP = {', 'const EXACT_MAP = {\n' + entriesToAdd);
    fs.writeFileSync(RUNTIME_PATH, runtimeCode, 'utf8');
    log(`成功将 ${addedCount} 条翻译合并至 ${RUNTIME_PATH}`);
  } else {
    log(`未发现新的有效翻译词条进行合并。`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractWebBundleFromExe,
  extractCandidatesFromCode,
  isValidUiString,
  loadRuntimeDictionary
};
