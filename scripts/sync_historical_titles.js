'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { translateWithApi, translateBatchWithApi, formatPangu } = require('./api_translator');

function getSqliteModule() {
  try {
    return require('node:sqlite');
  } catch (_) {
    return null;
  }
}

async function syncHistoricalTitles() {
  const root = path.join(os.homedir(), '.gemini', 'antigravity');
  const annotationsDir = path.join(root, 'annotations');
  const dbPath = path.join(root, 'conversation_summaries.db');

  const pendingPbtxtFiles = [];
  const pendingDbRows = [];
  const titlesToTranslate = new Set();

  function isTitleNeedingTranslation(title) {
    if (!title || typeof title !== 'string') return false;
    const s = title.trim();
    if (!s || s.length < 3) return false;
    return /[a-zA-Z]{3,}/.test(s) && !/^(?:UI|UX|FFXIV|Git|PR)$/.test(s);
  }

  // 1. 扫描 SQLite 本地会话摘要数据库
  const sqlite = getSqliteModule();
  if (sqlite && fs.existsSync(dbPath)) {
    try {
      const db = new sqlite.DatabaseSync(dbPath);
      const rows = db.prepare("SELECT conversation_id, title FROM conversation_summaries WHERE title != ''").all();
      for (const r of rows) {
        const orig = (r.title || '').trim();
        if (isTitleNeedingTranslation(orig)) {
          titlesToTranslate.add(orig);
          pendingDbRows.push({ conversation_id: r.conversation_id, title: orig });
        }
      }
      db.close();
    } catch (_) {}
  }

  // 2. 扫描 annotations/*.pbtxt 文本文件
  if (fs.existsSync(annotationsDir)) {
    const files = fs.readdirSync(annotationsDir).filter((f) => f.endsWith('.pbtxt'));
    for (const file of files) {
      const fullPath = path.join(annotationsDir, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const match = content.match(/title:\s*"([^"]+)"/);
        if (!match) continue;

        const originalTitle = match[1].trim();
        if (!isTitleNeedingTranslation(originalTitle)) continue;

        pendingPbtxtFiles.push({
          file,
          fullPath,
          content,
          originalTitle
        });
        titlesToTranslate.add(originalTitle);
      } catch (_) {}
    }
  }

  if (titlesToTranslate.size === 0) {
    return { success: true, count: 0, items: [] };
  }

  // 3. 一次性批量并发翻译所有待处理标题
  const transMap = await translateBatchWithApi(Array.from(titlesToTranslate));
  const updatedItems = [];

  // 4. 写回 SQLite 数据库
  if (sqlite && pendingDbRows.length > 0 && fs.existsSync(dbPath)) {
    try {
      const bakPath = dbPath + '.bak';
      if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(dbPath, bakPath);
      }

      const db = new sqlite.DatabaseSync(dbPath);
      const updateStmt = db.prepare("UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?");

      db.exec("BEGIN TRANSACTION");
      for (const row of pendingDbRows) {
        const trans = transMap[row.title];
        if (trans && trans !== row.title) {
          updateStmt.run(trans, row.conversation_id);
          updatedItems.push({
            type: 'db',
            id: row.conversation_id,
            original: row.title,
            translated: trans
          });
        }
      }
      db.exec("COMMIT");
      db.close();
    } catch (_) {}
  }

  // 5. 写回 annotations/*.pbtxt 文件
  for (const item of pendingPbtxtFiles) {
    const { file, fullPath, content, originalTitle } = item;
    const translatedTitle = transMap[originalTitle];
    if (!translatedTitle || translatedTitle === originalTitle) continue;

    try {
      const bakPath = fullPath + '.bak';
      if (!fs.existsSync(bakPath)) {
        fs.writeFileSync(bakPath, content, 'utf8');
      }

      const newContent = content.replace(`title:"${originalTitle}"`, `title:"${translatedTitle}"`);
      fs.writeFileSync(fullPath, newContent, 'utf8');

      updatedItems.push({
        type: 'pbtxt',
        file,
        original: originalTitle,
        translated: translatedTitle
      });
    } catch (_) {}
  }

  return {
    success: true,
    count: updatedItems.length,
    items: updatedItems
  };
}

module.exports = {
  syncHistoricalTitles
};

if (require.main === module) {
  (async () => {
    console.log('正在调用翻译引擎 API 扫描并同步历史会话标题...');
    const res = await syncHistoricalTitles();
    console.log(`处理完成，共汉化 ${res.count} 个历史会话标题：`);
    for (const item of res.items) {
      console.log(`  - [${item.original}] -> [${item.translated}]`);
    }
  })();
}
